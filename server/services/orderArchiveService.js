import Order from '../models/Order.js'
import { withRedis } from '../config/redis.js'
import { logger } from '../utils/logger.js'
import { buildTenantArchiveKey, isS3ArchiveConfigured, uploadArchiveJsonGzip } from './s3ArchiveService.js'

const DEFAULT_BATCH_SIZE = 500
const ARCHIVE_LOCK_TTL_SECONDS = Math.max(30, Number(process.env.ORDER_ARCHIVE_LOCK_TTL_SECONDS || 15 * 60))
const archiveRunLocks = new Map()

function getArchiveDelayMs() {
  const hours = Number(process.env.ORDER_ARCHIVE_DELAY_HOURS || 6)
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 6
  return safeHours * 60 * 60 * 1000
}

function shouldPurgeAfterArchive() {
  const value = String(process.env.ORDER_ARCHIVE_PURGE_AFTER_UPLOAD || 'true').trim().toLowerCase()
  return value !== 'false'
}

function getBatchSize() {
  const size = Number(process.env.ORDER_ARCHIVE_BATCH_SIZE || DEFAULT_BATCH_SIZE)
  return Number.isFinite(size) && size > 0 ? Math.min(size, 2000) : DEFAULT_BATCH_SIZE
}

function buildArchivePayload(restaurantId, orders) {
  return {
    schemaVersion: 1,
    restaurantId: String(restaurantId),
    exportedAt: new Date().toISOString(),
    orderCount: orders.length,
    orders: orders.map((order) => ({
      _id: String(order._id),
      restaurantId: String(order.restaurantId),
      tableNumber: order.tableNumber,
      items: order.items,
      subtotalAmount: order.subtotalAmount,
      discountTotal: order.discountTotal,
      appliedOffers: order.appliedOffers,
      couponCode: order.couponCode,
      totalAmount: order.totalAmount,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      completedAt: order.completedAt,
      deletedByOwnerAt: order.deletedByOwnerAt,
    })),
  }
}

function cleanupArchiveRunLocks() {
  const current = Date.now()
  for (const [key, expiresAt] of archiveRunLocks.entries()) {
    if (expiresAt <= current) {
      archiveRunLocks.delete(key)
    }
  }
}

async function acquireArchiveRunLock() {
  const key = 'order-archive:run-lock'
  cleanupArchiveRunLocks()

  const localExpiresAt = Number(archiveRunLocks.get(key) || 0)
  if (localExpiresAt > Date.now()) {
    return false
  }

  const lockUntil = Date.now() + ARCHIVE_LOCK_TTL_SECONDS * 1000
  archiveRunLocks.set(key, lockUntil)

  const distributedLock = await withRedis(
    'order_archive_lock_acquire',
    (redis) => redis.set(key, String(lockUntil), { nx: true, ex: ARCHIVE_LOCK_TTL_SECONDS }),
    '__FALLBACK__',
  )

  if (distributedLock === 'OK' || distributedLock === true || distributedLock === '__FALLBACK__') {
    return true
  }

  archiveRunLocks.delete(key)
  return false
}

async function releaseArchiveRunLock() {
  const key = 'order-archive:run-lock'
  archiveRunLocks.delete(key)
  await withRedis('order_archive_lock_release', (redis) => redis.del(key), null)
}

async function archiveRestaurantOrders(restaurantId, orders, purgeAfterArchive) {
  const key = buildTenantArchiveKey({ restaurantId })
  const payload = buildArchivePayload(restaurantId, orders)

  const uploadResult = await uploadArchiveJsonGzip({ key, payload })

  const ids = orders.map((order) => order._id)
  if (purgeAfterArchive) {
    await Order.deleteMany({ _id: { $in: ids } })
  } else {
    await Order.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          isArchived: true,
          archivedAt: new Date(),
          archiveKey: uploadResult.key,
        },
      },
    )
  }

  logger.info('Archived tenant order batch to S3', {
    restaurantId: String(restaurantId),
    orderCount: ids.length,
    key: uploadResult.key,
    bucket: uploadResult.bucket,
    sizeBytes: uploadResult.sizeBytes,
    purgedFromMongo: purgeAfterArchive,
  })
}

export async function runOrderArchiveOnce() {
  if (!isS3ArchiveConfigured()) {
    logger.warn('Skipping order archive: S3 is not configured')
    return { archivedOrders: 0, archivedRestaurants: 0, skipped: true }
  }

  const lockAcquired = await acquireArchiveRunLock()
  if (!lockAcquired) {
    return { archivedOrders: 0, archivedRestaurants: 0, skipped: true }
  }

  try {
    const cutoff = new Date(Date.now() - getArchiveDelayMs())
    const batchSize = getBatchSize()

    const candidates = await Order.find({
      hiddenFromActive: true,
      isArchived: false,
      deletedByOwnerAt: { $lte: cutoff },
    })
      .select(
        '_id restaurantId tableNumber items subtotalAmount discountTotal appliedOffers couponCode totalAmount paymentStatus orderStatus createdAt updatedAt completedAt deletedByOwnerAt',
      )
      .sort({ deletedByOwnerAt: 1 })
      .limit(batchSize)
      .lean()

    if (!candidates.length) {
      return { archivedOrders: 0, archivedRestaurants: 0, skipped: false }
    }

    const byRestaurant = new Map()
    for (const order of candidates) {
      const tenantKey = String(order.restaurantId)
      const list = byRestaurant.get(tenantKey) || []
      list.push(order)
      byRestaurant.set(tenantKey, list)
    }

    let archivedOrders = 0
    let archivedRestaurants = 0
    const purgeAfterArchive = shouldPurgeAfterArchive()

    for (const [tenantKey, orders] of byRestaurant.entries()) {
      await archiveRestaurantOrders(tenantKey, orders, purgeAfterArchive)
      archivedOrders += orders.length
      archivedRestaurants += 1
    }

    return { archivedOrders, archivedRestaurants, skipped: false }
  } finally {
    await releaseArchiveRunLock()
  }
}

let archiveTimer = null
let running = false

export function startOrderArchiveScheduler() {
  const enabled = String(process.env.ORDER_ARCHIVE_ENABLED || 'true').trim().toLowerCase() !== 'false'
  if (!enabled) {
    logger.info('Order archive scheduler disabled by environment')
    return
  }

  const processRole = String(process.env.PROCESS_ROLE || 'all').trim().toLowerCase()
  if (!['all', 'worker', 'jobs'].includes(processRole)) {
    logger.info('Order archive scheduler skipped for process role', { processRole })
    return
  }

  const intervalMinutes = Number(process.env.ORDER_ARCHIVE_INTERVAL_MINUTES || 60)
  const safeMinutes = Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 60
  const intervalMs = safeMinutes * 60 * 1000

  const tick = async () => {
    if (running) return
    running = true
    try {
      const result = await runOrderArchiveOnce()
      if (!result.skipped && result.archivedOrders > 0) {
        logger.info('Order archive cycle complete', result)
      }
    } catch (error) {
      logger.error('Order archive cycle failed', { error: String(error?.message || error) })
    } finally {
      running = false
    }
  }

  archiveTimer = setInterval(tick, intervalMs)
  archiveTimer.unref?.()

  // Kick one cycle shortly after startup.
  setTimeout(() => {
    void tick()
  }, 5000).unref?.()

  logger.info('Order archive scheduler started', { intervalMinutes: safeMinutes, processRole })
}

export function stopOrderArchiveScheduler() {
  if (!archiveTimer) return
  clearInterval(archiveTimer)
  archiveTimer = null
}
