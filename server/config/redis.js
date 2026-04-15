import { Redis } from '@upstash/redis'
import { createClient } from 'redis'
import { logger } from '../utils/logger.js'

const redisUrl = String(process.env.UPSTASH_REDIS_REST_URL || '').trim()
const redisToken = String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const redisSocketUrl = String(process.env.REDIS_SOCKET_URL || '').trim()

let redisClient = null
let blockingRedisClient = null
let blockingRedisConnectPromise = null
let warnedUnavailable = false
let warnedBlockingUnavailable = false
const redisOpStats = new Map()

function recordRedisOp(operationName, field) {
  const op = String(operationName || 'unknown')
  if (!redisOpStats.has(op)) {
    redisOpStats.set(op, {
      attempts: 0,
      success: 0,
      fallback: 0,
      errors: 0,
      lastAt: 0,
    })
  }

  const stats = redisOpStats.get(op)
  if (!stats) return
  stats[field] = Number(stats[field] || 0) + 1
  stats.lastAt = Date.now()
}

export function isRedisConfigured() {
  return Boolean(redisUrl && redisToken)
}

export function isBlockingRedisConfigured() {
  return Boolean(redisSocketUrl)
}

export function getRedisClient() {
  if (!isRedisConfigured()) {
    return null
  }

  if (!redisClient) {
    redisClient = new Redis({
      url: redisUrl,
      token: redisToken,
    })
  }

  return redisClient
}

export async function getBlockingRedisClient() {
  if (!isBlockingRedisConfigured()) {
    return null
  }

  if (!blockingRedisClient) {
    blockingRedisClient = createClient({ url: redisSocketUrl })
    blockingRedisClient.on('error', (error) => {
      if (!warnedBlockingUnavailable) {
        warnedBlockingUnavailable = true
        logger.warn('redis_blocking_client_error', {
          message: error?.message || 'Blocking Redis client error',
        })
      }
    })
  }

  if (!blockingRedisClient.isOpen) {
    if (!blockingRedisConnectPromise) {
      blockingRedisConnectPromise = blockingRedisClient.connect().catch((error) => {
        blockingRedisConnectPromise = null
        throw error
      })
    }

    try {
      await blockingRedisConnectPromise
    } finally {
      blockingRedisConnectPromise = null
    }
  }

  return blockingRedisClient
}

export async function withRedis(operationName, operation, fallbackValue = null) {
  recordRedisOp(operationName, 'attempts')
  const client = getRedisClient()
  if (!client) {
    recordRedisOp(operationName, 'fallback')
    return fallbackValue
  }

  try {
    const result = await operation(client)
    recordRedisOp(operationName, 'success')
    return result
  } catch (error) {
    recordRedisOp(operationName, 'errors')
    recordRedisOp(operationName, 'fallback')
    if (!warnedUnavailable) {
      warnedUnavailable = true
      logger.warn('redis_unavailable_fallback', {
        operation: operationName,
        message: error?.message || 'Redis operation failed',
      })
    }
    return fallbackValue
  }
}

export function getRedisTelemetry({ top = 20 } = {}) {
  const safeTop = Math.max(1, Number(top || 20))
  const operations = [...redisOpStats.entries()]
    .map(([operation, stats]) => ({
      operation,
      attempts: Number(stats?.attempts || 0),
      success: Number(stats?.success || 0),
      fallback: Number(stats?.fallback || 0),
      errors: Number(stats?.errors || 0),
      lastAt: Number(stats?.lastAt || 0),
    }))
    .sort((a, b) => b.attempts - a.attempts)

  const totals = operations.reduce(
    (acc, row) => ({
      attempts: acc.attempts + row.attempts,
      success: acc.success + row.success,
      fallback: acc.fallback + row.fallback,
      errors: acc.errors + row.errors,
    }),
    { attempts: 0, success: 0, fallback: 0, errors: 0 },
  )

  return {
    configured: isRedisConfigured(),
    blockingConfigured: isBlockingRedisConfigured(),
    totals,
    topOperations: operations.slice(0, safeTop),
  }
}
