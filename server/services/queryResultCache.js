import { withRedis } from '../config/redis.js'
import { logger } from '../utils/logger.js'

/**
 * QUERY RESULT CACHE FOR GET ENDPOINTS
 * ====================================
 * Reduces database load for frequently accessed views (active orders, completed today, etc)
 * 3-layer strategy: Request-scoped → Local → Redis
 */

const queryResultCache = new Map()
const localRestaurantIndex = new Map()
const pendingRedisRestaurantInvalidations = new Set()
let pendingRedisRestaurantInvalidationTimer = null
const REDIS_QUERY_INVALIDATION_DEBOUNCE_MS = Math.max(20, Number(process.env.REDIS_QUERY_INVALIDATION_DEBOUNCE_MS || 200))
const REDIS_QUERY_INVALIDATION_BATCH_SIZE = Math.max(5, Number(process.env.REDIS_QUERY_INVALIDATION_BATCH_SIZE || 50))

const CACHE_CONFIGS = {
  active_orders: { ttlSeconds: 15, maxEntries: 1000 },
  completed_today: { ttlSeconds: 30, maxEntries: 500 },
  order_detail: { ttlSeconds: 60, maxEntries: 2000 },
}

function getCacheKey(queryType, { restaurantId, page = 1, limit = 50, filters = {} }) {
  const filterKey = Object.entries(filters)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('|')

  return `query:${queryType}:${restaurantId}:p${page}:l${limit}:${filterKey || 'none'}`
}

function normalizeRestaurantId(value) {
  return String(value || '').trim()
}

function redisRestaurantIndexKey(restaurantId) {
  return `query:index:restaurant:${normalizeRestaurantId(restaurantId)}`
}

function deleteLocalCacheKey(key) {
  const existing = queryResultCache.get(key)
  if (!existing) return

  const restaurantId = normalizeRestaurantId(existing.restaurantId)
  if (restaurantId) {
    const keySet = localRestaurantIndex.get(restaurantId)
    if (keySet) {
      keySet.delete(key)
      if (keySet.size === 0) {
        localRestaurantIndex.delete(restaurantId)
      }
    }
  }

  queryResultCache.delete(key)
}

function getLocalCached(key) {
  const entry = queryResultCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    deleteLocalCacheKey(key)
    return null
  }
  return entry.data
}

function setLocalCached(key, data, ttlSeconds, restaurantId) {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId)

  if (queryResultCache.size > 5000) {
    // Evict oldest 1000 entries
    const keys = [...queryResultCache.keys()]
    for (let i = 0; i < 1000; i++) {
      deleteLocalCacheKey(keys[i])
    }
  }

  queryResultCache.set(key, {
    data,
    restaurantId: normalizedRestaurantId,
    expiresAt: Date.now() + ttlSeconds * 1000,
  })

  if (normalizedRestaurantId) {
    if (!localRestaurantIndex.has(normalizedRestaurantId)) {
      localRestaurantIndex.set(normalizedRestaurantId, new Set())
    }
    localRestaurantIndex.get(normalizedRestaurantId).add(key)
  }
}

async function getRedisCached(key) {
  try {
    return await withRedis('query_cache_read', async (redis) => {
      const raw = await redis.get(key)
      if (!raw) return null
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw)
        } catch {
          return null
        }
      }
      return raw && typeof raw === 'object' ? raw : null
    }, null)
    // eslint-disable-next-line no-unused-vars
  } catch (e) {
    return null
  }
}

async function setRedisCached(key, data, ttlSeconds, restaurantId) {
  try {
    await withRedis('query_cache_write', async (redis) => {
      await redis.set(key, JSON.stringify(data), { ex: ttlSeconds })

      const normalizedRestaurantId = normalizeRestaurantId(restaurantId)
      if (!normalizedRestaurantId) return

      const indexKey = redisRestaurantIndexKey(normalizedRestaurantId)
      await Promise.all([
        redis.sadd(indexKey, key),
        redis.expire(indexKey, Math.max(300, ttlSeconds * 10)),
      ])
    }, null)
    // eslint-disable-next-line no-unused-vars
  } catch (e) {
    // Silently fail
  }
}

async function flushRedisRestaurantInvalidations() {
  if (pendingRedisRestaurantInvalidationTimer) {
    clearTimeout(pendingRedisRestaurantInvalidationTimer)
    pendingRedisRestaurantInvalidationTimer = null
  }

  if (!pendingRedisRestaurantInvalidations.size) {
    return
  }

  const restaurantIds = [...pendingRedisRestaurantInvalidations]
  pendingRedisRestaurantInvalidations.clear()

  for (const restaurantId of restaurantIds) {
    try {
      await withRedis('query_cache_invalidate', async (redis) => {
        const indexKey = redisRestaurantIndexKey(restaurantId)
        const keys = await redis.smembers(indexKey)
        const normalizedKeys = Array.isArray(keys) ? keys.filter(Boolean) : []

        if (normalizedKeys.length) {
          await redis.del(...normalizedKeys)
        }

        await redis.del(indexKey)
      }, null)
    } catch (e) {
      logger.warn('query_cache_invalidation_failed', {
        restaurantId,
        message: e?.message || 'unknown_error',
      })
    }
  }
}

/**
 * GET CACHED QUERY RESULT
 * 3-tier lookup: request params → local memory → redis → null
 */
export async function getCachedQueryResult(queryType, params) {
  const cacheConfig = CACHE_CONFIGS[queryType]
  if (!cacheConfig) return null

  const key = getCacheKey(queryType, params)

  // Tier 1: Local memory
  const localResult = getLocalCached(key)
  if (localResult) {
    return { data: localResult, source: 'local' }
  }

  // Tier 2: Redis
  const redisResult = await getRedisCached(key)
  if (redisResult) {
    setLocalCached(key, redisResult, cacheConfig.ttlSeconds, params?.restaurantId)
    return { data: redisResult, source: 'redis' }
  }

  return null
}

/**
 * SET CACHED QUERY RESULT
 * Store in both local and Redis for maximum hit rate
 */
export async function setCachedQueryResult(queryType, params, data) {
  const cacheConfig = CACHE_CONFIGS[queryType]
  if (!cacheConfig) return

  const key = getCacheKey(queryType, params)

  setLocalCached(key, data, cacheConfig.ttlSeconds, params?.restaurantId)
  void setRedisCached(key, data, cacheConfig.ttlSeconds, params?.restaurantId)
}

/**
 * INVALIDATE QUERY CACHE FOR RESTAURANT
 * Called when orders change (create, update status, etc)
 */
export async function invalidateOrderQueries(restaurantId) {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId)
  if (!normalizedRestaurantId) return

  // Invalidate local cache entries for this restaurant
  const localKeys = [...(localRestaurantIndex.get(normalizedRestaurantId) || [])]
  for (const key of localKeys) {
    deleteLocalCacheKey(key)
  }

  pendingRedisRestaurantInvalidations.add(normalizedRestaurantId)

  if (pendingRedisRestaurantInvalidations.size >= REDIS_QUERY_INVALIDATION_BATCH_SIZE) {
    await flushRedisRestaurantInvalidations()
    return
  }

  if (!pendingRedisRestaurantInvalidationTimer) {
    pendingRedisRestaurantInvalidationTimer = setTimeout(() => {
      void flushRedisRestaurantInvalidations()
    }, REDIS_QUERY_INVALIDATION_DEBOUNCE_MS)
    pendingRedisRestaurantInvalidationTimer.unref?.()
  }
}

/**
 * CACHE STATS
 */
export function getQueryCachestats() {
  return {
    localEntries: queryResultCache.size,
    configs: Object.entries(CACHE_CONFIGS).map(([type, config]) => ({
      type,
      ttlSeconds: config.ttlSeconds,
      maxEntries: config.maxEntries,
    })),
  }
}
