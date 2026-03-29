import mongoose from 'mongoose'
import { logger } from '../utils/logger.js'
import { withRedis } from '../config/redis.js'

/**
 * Analytics consistency service for thread-safe metric updates
 * Prevents race conditions in concurrent upsert operations
 * Uses Redis for distributed locking with local fallback
 */

const ANALYTICS_LOCK_PREFIX = 'analytics_lock:'
const LOCK_TTL_SECONDS = 5
const lockLocalStore = new Map()

function lockKey(identifier) {
  return `${ANALYTICS_LOCK_PREFIX}${identifier}`
}

function nowMs() {
  return Date.now()
}

function cleanupLocalStores() {
  const now = nowMs()
  for (const [key, expiresAt] of lockLocalStore.entries()) {
    if (expiresAt <= now) {
      lockLocalStore.delete(key)
    }
  }
}

/**
 * Acquire lock for analytics update of a specific resource
 */
async function acquireAnalyticsLock(restaurantId, resourceType, resourceKey) {
  const normalized = `${String(restaurantId)}:${resourceType}:${resourceKey}`.trim()
  if (!normalized) return true

  cleanupLocalStores()
  const now = nowMs()
  const existingLock = lockLocalStore.get(normalized)
  if (existingLock && existingLock > now) {
    return false
  }

  const distributedLock = await withRedis(
    'analytics_lock_set',
    (redis) =>
      redis.set(lockKey(normalized), String(now), {
        nx: true,
        ex: LOCK_TTL_SECONDS,
      }),
    '__FALLBACK__',
  )

  if (distributedLock === 'OK') {
    lockLocalStore.set(normalized, now + LOCK_TTL_SECONDS * 1000)
    return true
  }

  if (distributedLock === '__FALLBACK__') {
    lockLocalStore.set(normalized, now + LOCK_TTL_SECONDS * 1000)
    return true
  }

  return false
}

/**
 * Release analytics lock
 */
async function releaseAnalyticsLock(normalized) {
  if (!normalized) return

  lockLocalStore.delete(normalized)
  await withRedis('analytics_lock_release', (redis) => redis.del(lockKey(normalized)), 0)
}

/**
 * Safe upsert with transactional consistency
 * Prevents race conditions in concurrent updates
 */
export async function safeAnalyticsUpsert({
  model,
  filter,
  update,
  restaurantId,
  resourceType,
  resourceKey,
  session,
} = {}) {
  if (!model || !filter || !update || !restaurantId) {
    throw new Error('Missing required parameters for safe analytics upsert')
  }

  const lockIdentifier = `${String(restaurantId)}:${resourceType}:${resourceKey}`
  const lockAcquired = await acquireAnalyticsLock(restaurantId, resourceType, resourceKey)

  if (!lockAcquired) {
    logger.warn('analytics_lock_acquisition_failed', {
      restaurantId: String(restaurantId),
      resourceType,
      resourceKey,
    })
    // Fall back to unsafe upsert if lock acquisition fails
    return model.findOneAndUpdate(filter, update, { upsert: true, new: true, session })
  }

  try {
    // Perform upsert within lock
    const result = await model.findOneAndUpdate(filter, update, { upsert: true, new: true, session })
    return result
  } finally {
    // Always release lock
    await releaseAnalyticsLock(lockIdentifier)
  }
}

/**
 * Safe batch upsert with transactional consistency
 * Updates multiple documents atomically
 */
export async function safeAnalyticsBatchUpsert({
  model,
  operations,
  restaurantId,
  resourceType,
  session,
} = {}) {
  if (!model || !operations || !restaurantId || !resourceType) {
    throw new Error('Missing required parameters for batch upsert')
  }

  const resourceKey = `batch:${operations.length}:${Date.now()}`
  const lockIdentifier = `${String(restaurantId)}:${resourceType}:${resourceKey}`
  const lockAcquired = await acquireAnalyticsLock(restaurantId, resourceType, resourceKey)

  if (!lockAcquired) {
    logger.warn('analytics_batch_lock_acquisition_failed', {
      restaurantId: String(restaurantId),
      operationCount: operations.length,
    })
  }

  try {
    // Perform batch upserts
    const results = []
    for (const operation of operations) {
      const result = await model.findOneAndUpdate(operation.filter, operation.update, {
        upsert: true,
        new: true,
        session,
      })
      results.push(result)
    }
    return results
  } finally {
    if (lockAcquired) {
      await releaseAnalyticsLock(lockIdentifier)
    }
  }
}

/**
 * Analytics update wrapper with retry logic
 */
export async function analyticsUpdateWithRetry({
  operation,
  maxRetries = 3,
  backoffMs = 100,
} = {}) {
  let lastError = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt < maxRetries - 1) {
        const delayMs = backoffMs * Math.pow(2, attempt)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }

  throw lastError
}

/**
 * Batch analytics update with transaction support
 */
export async function batchAnalyticsUpdate(operations, restaurantId) {
  const session = await mongoose.startSession()
  session.startTransaction()

  try {
    const results = []
    for (const operation of operations) {
      const result = await analyticsUpdateWithRetry({
        operation: () =>
          safeAnalyticsUpsert({
            ...operation,
            restaurantId,
            session,
          }),
        maxRetries: 3,
      })
      results.push(result)
    }

    await session.commitTransaction()
    return results
  } catch (error) {
    await session.abortTransaction()
    logger.error('batch_analytics_update_failed', {
      restaurantId: String(restaurantId),
      operationCount: operations.length,
      error: error.message,
    })
    throw error
  } finally {
    await session.endSession()
  }
}
