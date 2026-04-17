import { createClient } from 'redis'
import { logger } from '../../utils/logger.js'
import { redisSettings } from './settings.js'

let blockingRedisClient = null
let blockingRedisConnectPromise = null
let warnedBlockingUnavailable = false

export function isBlockingRedisConfigured() {
  return Boolean(redisSettings.socketUrl)
}

export async function getBlockingRedisClient() {
  if (!isBlockingRedisConfigured()) {
    return null
  }

  if (!blockingRedisClient) {
    blockingRedisClient = createClient({ url: redisSettings.socketUrl })
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

export async function closeBlockingRedisClient() {
  if (!blockingRedisClient) {
    return
  }

  try {
    if (blockingRedisClient.isOpen) {
      await blockingRedisClient.quit()
    }
  } catch (error) {
    logger.warn('redis_blocking_client_close_failed', {
      message: error?.message || 'Blocking Redis client close failed',
    })
  } finally {
    blockingRedisClient = null
    blockingRedisConnectPromise = null
  }
}

