import OutboxEvent from '../models/OutboxEvent.js'
import { enqueueOrderInventoryReservationJob } from './orderInventoryQueueService.js'
import { logger } from '../utils/logger.js'

const OUTBOX_WORKER_ENABLED = String(process.env.ORDER_OUTBOX_WORKER_ENABLED || 'true') === 'true'
const OUTBOX_WORKER_INTERVAL_MS = Math.max(500, Number(process.env.ORDER_OUTBOX_WORKER_INTERVAL_MS || 1000))
const OUTBOX_WORKER_BATCH_SIZE = Math.max(1, Math.min(50, Number(process.env.ORDER_OUTBOX_WORKER_BATCH_SIZE || 20)))
const OUTBOX_RETRY_BASE_MS = Math.max(1000, Number(process.env.ORDER_OUTBOX_RETRY_BASE_MS || 3000))
const OUTBOX_RETRY_MAX_MS = Math.max(5000, Number(process.env.ORDER_OUTBOX_RETRY_MAX_MS || 120000))
const OUTBOX_LOCK_TIMEOUT_MS = Math.max(10_000, Number(process.env.ORDER_OUTBOX_LOCK_TIMEOUT_MS || 120_000))

let outboxTimer = null
let outboxRunning = false

function buildWorkerId() {
  return `outbox:${process.pid}:${Math.random().toString(36).slice(2, 10)}`
}

function backoffMs(retries) {
  const power = Math.max(0, Number(retries || 1) - 1)
  return Math.min(OUTBOX_RETRY_MAX_MS, OUTBOX_RETRY_BASE_MS * 2 ** power)
}

export async function createOrderCreatedOutboxEvent({
  orderId,
  restaurantId,
  policy = 'soft',
  idempotencyPrefix = 'order',
  session,
}) {
  const normalizedOrderId = String(orderId || '').trim()
  const normalizedRestaurantId = String(restaurantId || '').trim()
  if (!normalizedOrderId || !normalizedRestaurantId) {
    throw new Error('order_outbox_invalid_payload')
  }

  await OutboxEvent.create(
    [
      {
        type: 'ORDER_CREATED',
        eventKey: `ORDER_CREATED:${normalizedOrderId}`,
        payload: {
          orderId: normalizedOrderId,
          restaurantId: normalizedRestaurantId,
          policy: String(policy || 'soft'),
          idempotencyPrefix: String(idempotencyPrefix || 'order'),
        },
        status: 'pending',
      },
    ],
    { session },
  )
}

async function claimNextEvent(workerId) {
  const now = new Date()
  const staleLockThreshold = new Date(now.getTime() - OUTBOX_LOCK_TIMEOUT_MS)

  return OutboxEvent.findOneAndUpdate(
    {
      type: 'ORDER_CREATED',
      $or: [
        {
          status: { $in: ['pending', 'retry'] },
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
      $inc: { retries: 1 },
    },
    {
      sort: { nextRunAt: 1, createdAt: 1 },
      new: true,
    },
  ).lean()
}

async function processEvent(event, workerId) {
  const payload = event?.payload || {}
  await enqueueOrderInventoryReservationJob({
    restaurantId: payload.restaurantId,
    orderId: payload.orderId,
    policy: String(payload.policy || 'soft'),
    idempotencyPrefix: String(payload.idempotencyPrefix || 'order'),
  })

  await OutboxEvent.updateOne(
    { _id: event._id, workerId },
    {
      $set: {
        status: 'processed',
        processedAt: new Date(),
        lastError: '',
      },
    },
  )
}

async function markEventFailure(event, workerId, error) {
  const retries = Number(event?.retries || 1)
  const maxRetries = Number(event?.maxRetries || 8)
  const hasRetriesLeft = retries < maxRetries

  await OutboxEvent.updateOne(
    { _id: event._id, workerId },
    {
      $set: {
        status: hasRetriesLeft ? 'retry' : 'failed',
        nextRunAt: hasRetriesLeft ? new Date(Date.now() + backoffMs(retries)) : new Date(),
        processedAt: hasRetriesLeft ? null : new Date(),
        lastError: String(error?.message || 'outbox_processing_failed').slice(0, 1900),
      },
    },
  )
}

async function processNextEvent(workerId) {
  const event = await claimNextEvent(workerId)
  if (!event) return false

  const startedAt = Date.now()
  try {
    await processEvent(event, workerId)
    logger.info('outbox_event_processed', {
      outboxEventId: String(event._id || ''),
      orderId: String(event?.payload?.orderId || ''),
      retries: Number(event?.retries || 0),
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    await markEventFailure(event, workerId, error)
    logger.warn('outbox_event_processing_failed', {
      outboxEventId: String(event._id || ''),
      orderId: String(event?.payload?.orderId || ''),
      retries: Number(event?.retries || 0),
      durationMs: Date.now() - startedAt,
      message: String(error?.message || 'outbox_processing_failed'),
    })
  }

  return true
}

async function runOutboxTick() {
  if (outboxRunning) return
  outboxRunning = true

  const workerId = buildWorkerId()
  try {
    for (let i = 0; i < OUTBOX_WORKER_BATCH_SIZE; i += 1) {
      const processed = await processNextEvent(workerId)
      if (!processed) break
    }
  } finally {
    outboxRunning = false
  }
}

export function startOrderOutboxWorker() {
  if (!OUTBOX_WORKER_ENABLED) {
    logger.info('order_outbox_worker_disabled')
    return
  }

  if (outboxTimer) {
    return
  }

  outboxTimer = setInterval(() => {
    void runOutboxTick()
  }, OUTBOX_WORKER_INTERVAL_MS)
  outboxTimer.unref?.()

  void runOutboxTick()
  logger.info('order_outbox_worker_started', {
    intervalMs: OUTBOX_WORKER_INTERVAL_MS,
    batchSize: OUTBOX_WORKER_BATCH_SIZE,
  })
}

export function stopOrderOutboxWorker() {
  if (!outboxTimer) return
  clearInterval(outboxTimer)
  outboxTimer = null
  logger.info('order_outbox_worker_stopped')
}
