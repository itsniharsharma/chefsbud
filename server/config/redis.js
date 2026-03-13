import { Redis } from '@upstash/redis'
import { logger } from '../utils/logger.js'

const redisUrl = String(process.env.UPSTASH_REDIS_REST_URL || '').trim()
const redisToken = String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()

let redisClient = null
let warnedUnavailable = false

export function isRedisConfigured() {
  return Boolean(redisUrl && redisToken)
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

export async function withRedis(operationName, operation, fallbackValue = null) {
  const client = getRedisClient()
  if (!client) {
    return fallbackValue
  }

  try {
    return await operation(client)
  } catch (error) {
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
