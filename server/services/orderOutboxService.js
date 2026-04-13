import OutboxEvent from '../models/OutboxEvent.js'
import { enqueueOrderInventoryReservationJob } from './orderInventoryQueueService.js'
import { processOrderStatusTransition } from './orderStatusProcessingService.js'
import { sendBillingStatusEmail, sendDemoBookingEmail, sendRegistrationOtpEmail } from './emailService.js'
import { logger } from '../utils/logger.js'

const OUTBOX_WORKER_ENABLED = String(process.env.ORDER_OUTBOX_WORKER_ENABLED || 'true') === 'true'
const OUTBOX_WORKER_INTERVAL_MS = Math.max(500, Number(process.env.ORDER_OUTBOX_WORKER_INTERVAL_MS || 1000))
const OUTBOX_WORKER_BATCH_SIZE = Math.max(1, Math.min(50, Number(process.env.ORDER_OUTBOX_WORKER_BATCH_SIZE || 20)))
const OUTBOX_RETRY_BASE_MS = Math.max(1000, Number(process.env.ORDER_OUTBOX_RETRY_BASE_MS || 3000))
const OUTBOX_RETRY_MAX_MS = Math.max(5000, Number(process.env.ORDER_OUTBOX_RETRY_MAX_MS || 120000))
const OUTBOX_LOCK_TIMEOUT_MS = Math.max(10_000, Number(process.env.ORDER_OUTBOX_LOCK_TIMEOUT_MS || 120_000))
const ASYNC_EMAIL_MAX_RETRIES = Math.max(3, Math.min(Number(process.env.ASYNC_EMAIL_MAX_RETRIES || 10), 50))

const ORDER_OUTBOX_TYPES = ['ORDER_CREATED', 'ORDER_STATUS_CHANGED']
const EMAIL_OUTBOX_TYPES = ['EMAIL_REGISTRATION_OTP', 'EMAIL_DEMO_BOOKING', 'EMAIL_BILLING_STATUS']

let outboxTimer = null
let outboxSummaryTimer = null
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

  const eventKey = `ORDER_CREATED:${normalizedOrderId}`

  await OutboxEvent.findOneAndUpdate(
    { type: 'ORDER_CREATED', eventKey },
    {
      $setOnInsert: {
        type: 'ORDER_CREATED',
        eventKey,
        payload: {
          orderId: normalizedOrderId,
          restaurantId: normalizedRestaurantId,
          policy: String(policy || 'soft'),
          idempotencyPrefix: String(idempotencyPrefix || 'order'),
        },
        status: 'pending',
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
      session,
      setDefaultsOnInsert: true,
    },
  )
}

export async function createOrderStatusChangedOutboxEvent({
  orderId,
  restaurantId,
  fromStatus,
  toStatus,
  transitionToken = '',
  inventoryCycle = 0,
  completedAt = null,
  session,
}) {
  const normalizedOrderId = String(orderId || '').trim()
  const normalizedRestaurantId = String(restaurantId || '').trim()
  const normalizedFromStatus = String(fromStatus || '').trim()
  const normalizedToStatus = String(toStatus || '').trim()

  if (!normalizedOrderId || !normalizedRestaurantId || !normalizedToStatus) {
    throw new Error('order_status_outbox_invalid_payload')
  }

  const eventKey = `ORDER_STATUS_CHANGED:${normalizedOrderId}:${normalizedFromStatus}:${normalizedToStatus}:${String(transitionToken || '0')}`

  await OutboxEvent.findOneAndUpdate(
    { type: 'ORDER_STATUS_CHANGED', eventKey },
    {
      $setOnInsert: {
        type: 'ORDER_STATUS_CHANGED',
        eventKey,
        payload: {
          orderId: normalizedOrderId,
          restaurantId: normalizedRestaurantId,
          fromStatus: normalizedFromStatus,
          toStatus: normalizedToStatus,
          transitionToken: String(transitionToken || ''),
          inventoryCycle: Number(inventoryCycle || 0),
          completedAt: completedAt ? new Date(completedAt).toISOString() : null,
        },
        status: 'pending',
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
      session,
      setDefaultsOnInsert: true,
    },
  )
}

async function upsertOutboxEvent({ type, eventKey, payload, session = null, maxRetries = 8 }) {
  await OutboxEvent.findOneAndUpdate(
    { type, eventKey },
    {
      $setOnInsert: {
        type,
        eventKey,
        payload,
        status: 'pending',
        maxRetries,
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
      session,
      setDefaultsOnInsert: true,
    },
  )
}

export async function enqueueRegistrationOtpEmailJob({ to, code, expiryMinutes, eventKey, session = null }) {
  const normalizedTo = String(to || '').trim().toLowerCase()
  const normalizedCode = String(code || '').trim()
  const normalizedExpiry = Math.max(1, Number(expiryMinutes || 10))
  const normalizedEventKey = String(eventKey || `EMAIL_REGISTRATION_OTP:${normalizedTo}:${Date.now()}`).trim()

  if (!normalizedTo || !normalizedCode) {
    throw new Error('email_registration_otp_invalid_payload')
  }

  await upsertOutboxEvent({
    type: 'EMAIL_REGISTRATION_OTP',
    eventKey: normalizedEventKey,
    payload: {
      to: normalizedTo,
      code: normalizedCode,
      expiryMinutes: normalizedExpiry,
    },
    session,
    maxRetries: ASYNC_EMAIL_MAX_RETRIES,
  })
}

export async function enqueueDemoBookingEmailJob({
  fullName,
  phoneNumber,
  restaurantName,
  state,
  city,
  email,
  note,
  eventKey,
  session = null,
}) {
  const normalizedEventKey = String(eventKey || `EMAIL_DEMO_BOOKING:${String(email || '').trim().toLowerCase()}:${Date.now()}`).trim()

  await upsertOutboxEvent({
    type: 'EMAIL_DEMO_BOOKING',
    eventKey: normalizedEventKey,
    payload: {
      fullName: String(fullName || '').trim(),
      phoneNumber: String(phoneNumber || '').trim(),
      restaurantName: String(restaurantName || '').trim(),
      state: String(state || '').trim(),
      city: String(city || '').trim(),
      email: String(email || '').trim().toLowerCase(),
      note: String(note || '').trim(),
    },
    session,
    maxRetries: ASYNC_EMAIL_MAX_RETRIES,
  })
}

export async function enqueueBillingStatusEmailJob({
  to,
  name,
  status,
  planType,
  graceEndsAt,
  currentPeriodEnd,
  eventKey,
  session = null,
}) {
  const normalizedTo = String(to || '').trim().toLowerCase()
  const normalizedEventKey = String(eventKey || `EMAIL_BILLING_STATUS:${normalizedTo}:${String(status || '')}:${Date.now()}`).trim()
  if (!normalizedTo) {
    throw new Error('email_billing_status_invalid_payload')
  }

  await upsertOutboxEvent({
    type: 'EMAIL_BILLING_STATUS',
    eventKey: normalizedEventKey,
    payload: {
      to: normalizedTo,
      name: String(name || '').trim(),
      status: String(status || '').trim(),
      planType: String(planType || '').trim(),
      graceEndsAt: graceEndsAt || null,
      currentPeriodEnd: currentPeriodEnd || null,
    },
    session,
    maxRetries: ASYNC_EMAIL_MAX_RETRIES,
  })
}

async function claimNextEvent(workerId) {
  const now = new Date()
  const staleLockThreshold = new Date(now.getTime() - OUTBOX_LOCK_TIMEOUT_MS)

  return OutboxEvent.findOneAndUpdate(
    {
      type: { $in: [...ORDER_OUTBOX_TYPES, ...EMAIL_OUTBOX_TYPES] },
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
      returnDocument: 'after',
    },
  ).lean()
}

async function processEvent(event, workerId) {
  const payload = event?.payload || {}

  if (event?.type === 'ORDER_CREATED') {
    await enqueueOrderInventoryReservationJob({
      restaurantId: payload.restaurantId,
      orderId: payload.orderId,
      policy: String(payload.policy || 'soft'),
      idempotencyPrefix: String(payload.idempotencyPrefix || 'order'),
    })
  } else if (event?.type === 'ORDER_STATUS_CHANGED') {
    await processOrderStatusTransition({
      restaurantId: payload.restaurantId,
      orderId: payload.orderId,
      fromStatus: payload.fromStatus,
      toStatus: payload.toStatus,
      inventoryCycle: payload.inventoryCycle,
      completedAt: payload.completedAt,
    })
  } else if (event?.type === 'EMAIL_REGISTRATION_OTP') {
    await sendRegistrationOtpEmail({
      to: payload.to,
      code: payload.code,
      expiryMinutes: payload.expiryMinutes,
    })
  } else if (event?.type === 'EMAIL_DEMO_BOOKING') {
    await sendDemoBookingEmail({
      fullName: payload.fullName,
      phoneNumber: payload.phoneNumber,
      restaurantName: payload.restaurantName,
      state: payload.state,
      city: payload.city,
      email: payload.email,
      note: payload.note,
    })
  } else if (event?.type === 'EMAIL_BILLING_STATUS') {
    await sendBillingStatusEmail({
      to: payload.to,
      name: payload.name,
      status: payload.status,
      planType: payload.planType,
      graceEndsAt: payload.graceEndsAt,
      currentPeriodEnd: payload.currentPeriodEnd,
    })
  }

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
  const status = hasRetriesLeft ? 'retry' : 'failed'

  await OutboxEvent.updateOne(
    { _id: event._id, workerId },
    {
      $set: {
        status,
        nextRunAt: hasRetriesLeft ? new Date(Date.now() + backoffMs(retries)) : new Date(),
        processedAt: hasRetriesLeft ? null : new Date(),
        lastError: String(error?.message || 'outbox_processing_failed').slice(0, 1900),
      },
    },
  )

  if (!hasRetriesLeft) {
    logger.error('outbox_event_terminal_failure', {
      outboxEventId: String(event?._id || ''),
      orderId: String(event?.payload?.orderId || ''),
      retries,
      maxRetries,
      message: String(error?.message || 'outbox_processing_failed'),
    })
  }
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

  outboxSummaryTimer = setInterval(async () => {
    try {
      const failedCount = await OutboxEvent.countDocuments({
        type: { $in: [...ORDER_OUTBOX_TYPES, ...EMAIL_OUTBOX_TYPES] },
        status: 'failed',
      })
      logger.info('order_outbox_failed_summary', { failedCount })
    } catch (summaryError) {
      logger.warn('order_outbox_failed_summary_error', {
        message: String(summaryError?.message || 'outbox_failed_summary_error'),
      })
    }
  }, 60_000)
  outboxSummaryTimer.unref?.()
}

export function stopOrderOutboxWorker() {
  if (!outboxTimer) return
  clearInterval(outboxTimer)
  outboxTimer = null
  if (outboxSummaryTimer) {
    clearInterval(outboxSummaryTimer)
    outboxSummaryTimer = null
  }
  logger.info('order_outbox_worker_stopped')
}
