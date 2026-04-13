import { withRedis } from '../config/redis.js'
import { logger } from '../utils/logger.js'

/**
 * QUERY RESULT CACHE FOR GET ENDPOINTS
 * ====================================
 * Reduces database load for frequently accessed views (active orders, completed today, etc)
 * 3-layer strategy: Request-scoped → Local → Redis
 */

const queryResultCache = new Map()

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

function getLocalCached(key) {
  const entry = queryResultCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    queryResultCache.delete(key)
    return null
  }
  return entry.data
}

function setLocalCached(key, data, ttlSeconds) {
  if (queryResultCache.size > 5000) {
    // Evict oldest 1000 entries
    const keys = [...queryResultCache.keys()]
    for (let i = 0; i < 1000; i++) {
      queryResultCache.delete(keys[i])
    }
  }

  queryResultCache.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000,
  })
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

async function setRedisCached(key, data, ttlSeconds) {
  try {
    await withRedis('query_cache_write', (redis) => redis.set(key, JSON.stringify(data), { ex: ttlSeconds }), null)
    // eslint-disable-next-line no-unused-vars
  } catch (e) {
    // Silently fail
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
    setLocalCached(key, redisResult, cacheConfig.ttlSeconds)
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

  setLocalCached(key, data, cacheConfig.ttlSeconds)
  void setRedisCached(key, data, cacheConfig.ttlSeconds)
}

/**
 * INVALIDATE QUERY CACHE FOR RESTAURANT
 * Called when orders change (create, update status, etc)
 */
export async function invalidateOrderQueries(restaurantId) {
  if (!restaurantId) return

  // Invalidate local cache entries for this restaurant
  const keys = [...queryResultCache.keys()]
  for (const key of keys) {
    if (key.includes(`${restaurantId}`)) {
      queryResultCache.delete(key)
    }
  }

  // Invalidate Redis cache
  try {
    await withRedis('query_cache_invalidate', async (redis) => {
      const pattern = `query:*:${restaurantId}:*`
      const keys = await redis.keys(pattern)
      if (keys.length) {
        await redis.del(...keys)
      }
    }, null)
  } catch (e) {
    logger.warn('query_cache_invalidation_failed', {
      restaurantId: String(restaurantId || ''),
      message: e?.message || 'unknown_error',
    })
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
