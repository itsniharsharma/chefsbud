import mongoose from 'mongoose'
import Order from '../models/Order.js'
import OrderInventoryJob from '../models/OrderInventoryJob.js'
import { reserveStockForOrder } from './inventoryV2Service.js'
import { logger } from '../utils/logger.js'

const ORDER_INVENTORY_ASYNC_ENABLED = String(process.env.ORDER_INVENTORY_ASYNC_ENABLED || 'false') === 'true'
const ORDER_INVENTORY_WORKER_ENABLED = String(process.env.ORDER_INVENTORY_WORKER_ENABLED || 'true') === 'true'
const ORDER_INVENTORY_WORKER_INTERVAL_MS = Math.max(500, Number(process.env.ORDER_INVENTORY_WORKER_INTERVAL_MS || 1500))
const ORDER_INVENTORY_WORKER_CONCURRENCY = Math.max(1, Math.min(5, Number(process.env.ORDER_INVENTORY_WORKER_CONCURRENCY || 2)))
const ORDER_INVENTORY_WORKER_MAX_ATTEMPTS = Math.max(1, Math.min(20, Number(process.env.ORDER_INVENTORY_WORKER_MAX_ATTEMPTS || 5)))
const ORDER_INVENTORY_RETRY_BASE_MS = Math.max(1000, Number(process.env.ORDER_INVENTORY_RETRY_BASE_MS || 2500))
const ORDER_INVENTORY_RETRY_MAX_MS = Math.max(5000, Number(process.env.ORDER_INVENTORY_RETRY_MAX_MS || 60000))
const ORDER_INVENTORY_LOCK_TIMEOUT_MS = Math.max(10_000, Number(process.env.ORDER_INVENTORY_LOCK_TIMEOUT_MS || 90_000))

let workerTimer = null
let workerRunning = false

function toObjectIdString(value) {
  return String(value || '').trim()
}

function buildWorkerId() {
  return `pid:${process.pid}:${Math.random().toString(36).slice(2, 10)}`
}

function backoffMs(attempt) {
  const power = Math.max(0, Number(attempt || 1) - 1)
  return Math.min(ORDER_INVENTORY_RETRY_MAX_MS, ORDER_INVENTORY_RETRY_BASE_MS * 2 ** power)
}

export function isOrderInventoryAsyncEnabled() {
  return ORDER_INVENTORY_ASYNC_ENABLED
}

export async function enqueueOrderInventoryReservationJob({
  restaurantId,
  orderId,
  policy = 'soft',
  idempotencyPrefix = 'order',
}) {
  const tenantId = toObjectIdString(restaurantId)
  const normalizedOrderId = toObjectIdString(orderId)
  if (!tenantId || !normalizedOrderId) {
    return null
  }

  const now = new Date()
  const jobKey = `reserve_order_inventory:${normalizedOrderId}`

  await OrderInventoryJob.updateOne(
    { jobKey },
    {
      $setOnInsert: {
        restaurantId: tenantId,
        orderId: normalizedOrderId,
        jobType: 'reserve_order_inventory',
        jobKey,
        status: 'queued',
        attempts: 0,
        maxAttempts: ORDER_INVENTORY_WORKER_MAX_ATTEMPTS,
        nextRunAt: now,
        payload: {
          policy,
          idempotencyPrefix,
        },
      },
    },
    { upsert: true },
  )

  return jobKey
}

async function claimNextJob(workerId) {
  const now = new Date()
  const staleLockThreshold = new Date(now.getTime() - ORDER_INVENTORY_LOCK_TIMEOUT_MS)
  return OrderInventoryJob.findOneAndUpdate(
    {
      jobType: 'reserve_order_inventory',
      $or: [
        {
          status: { $in: ['queued', 'retry'] },
          nextRunAt: { $lte: now },
        },
        {
          status: 'processing',
          lockedAt: { $lte: staleLockThreshold },
        },
      ],
    },
    {
      $set: {
        status: 'processing',
        lockedAt: now,
        workerId,
      },
      $inc: { attempts: 1 },
    },
    {
      sort: { nextRunAt: 1, createdAt: 1 },
      new: true,
    },
  ).lean()
}

async function processReservationJob(job, workerId) {
  const order = await Order.findOne({ _id: job.orderId, restaurantId: job.restaurantId, isArchived: false })
    .select('_id restaurantId items')
    .lean()

  if (!order) {
    await OrderInventoryJob.updateOne(
      { _id: job._id, workerId },
      {
        $set: {
          status: 'dead',
          lastError: 'order_not_found_or_archived',
          completedAt: new Date(),
        },
      },
    )
    return
  }

  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      await reserveStockForOrder({
        restaurantId: order.restaurantId,
        order,
        createdBy: null,
        policy: String(job?.payload?.policy || 'soft'),
        idempotencyPrefix: String(job?.payload?.idempotencyPrefix || 'order'),
        session,
      })
    })
  } finally {
    session.endSession()
  }

  await OrderInventoryJob.updateOne(
    { _id: job._id, workerId },
    {
      $set: {
        status: 'completed',
        completedAt: new Date(),
        lastError: '',
      },
    },
  )
}

async function markJobFailure(job, workerId, error) {
  const attempts = Number(job?.attempts || 1)
  const maxAttempts = Number(job?.maxAttempts || ORDER_INVENTORY_WORKER_MAX_ATTEMPTS)
  const hasAttemptsLeft = attempts < maxAttempts

  const nextState = hasAttemptsLeft ? 'retry' : 'dead'
  const nextRunAt = hasAttemptsLeft ? new Date(Date.now() + backoffMs(attempts)) : new Date()

  await OrderInventoryJob.updateOne(
    { _id: job._id, workerId },
    {
      $set: {
        status: nextState,
        nextRunAt,
        completedAt: hasAttemptsLeft ? null : new Date(),
        lastError: String(error?.message || 'order_inventory_job_failed').slice(0, 1900),
      },
    },
  )
}

async function processNextJob(workerId) {
  const job = await claimNextJob(workerId)
  if (!job) return false

  const startedAt = Date.now()
  try {
    await processReservationJob(job, workerId)
    logger.info('order_inventory_job_completed', {
      orderId: String(job.orderId || ''),
      attempts: Number(job.attempts || 0),
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    await markJobFailure(job, workerId, error)
    logger.warn('order_inventory_job_failed', {
      orderId: String(job.orderId || ''),
      attempts: Number(job.attempts || 0),
      durationMs: Date.now() - startedAt,
      error: error?.message || 'order_inventory_job_failed',
    })
  }

  return true
}

async function runWorkerTick() {
  if (workerRunning) return
  workerRunning = true

  const workerId = buildWorkerId()
  try {
    for (let i = 0; i < ORDER_INVENTORY_WORKER_CONCURRENCY; i += 1) {
      const processed = await processNextJob(workerId)
      if (!processed) break
    }
  } finally {
    workerRunning = false
  }
}

export function startOrderInventoryWorker() {
  if (!ORDER_INVENTORY_WORKER_ENABLED) {
    logger.info('order_inventory_worker_disabled')
    return
  }

  if (workerTimer) {
    return
  }

  workerTimer = setInterval(() => {
    void runWorkerTick()
  }, ORDER_INVENTORY_WORKER_INTERVAL_MS)
  workerTimer.unref?.()

  void runWorkerTick()
  logger.info('order_inventory_worker_started', {
    intervalMs: ORDER_INVENTORY_WORKER_INTERVAL_MS,
    concurrency: ORDER_INVENTORY_WORKER_CONCURRENCY,
    asyncEnabled: ORDER_INVENTORY_ASYNC_ENABLED,
  })
}

export function stopOrderInventoryWorker() {
  if (!workerTimer) return
  clearInterval(workerTimer)
  workerTimer = null
  logger.info('order_inventory_worker_stopped')
}
