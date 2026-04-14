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
