import { Redis } from '@upstash/redis'
import { logger } from '../../utils/logger.js'
import { redisSettings } from './settings.js'
import { recordRedisOp } from './telemetry.js'

let redisClient = null
let warnedUnavailable = false

export function isRedisConfigured() {
  return Boolean(redisSettings.restUrl && redisSettings.restToken)
}

export function getRedisClient() {
  if (!isRedisConfigured()) {
    return null
  }

  if (!redisClient) {
    redisClient = new Redis({
      url: redisSettings.restUrl,
      token: redisSettings.restToken,
    })
  }

  return redisClient
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

