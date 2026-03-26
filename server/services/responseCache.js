import { withRedis } from '../config/redis.js'

const cacheStore = new Map()
const tagIndex = new Map()
const inflightStore = new Map()
const redisTagMembershipStore = new Map()
const redisTagMembershipIndex = new Map()
const MAX_CACHE_ENTRIES = Math.max(50, Number(process.env.RESPONSE_CACHE_MAX_ENTRIES || 500))
const MAX_INFLIGHT_MS = 30000
const MAX_REDIS_TAG_MEMBERSHIP_ENTRIES = 5000
const REDIS_TAG_REFRESH_BUFFER_MS = 5000
const REDIS_INVALIDATION_BATCH_SIZE = Math.max(10, Number(process.env.REDIS_INVALIDATION_BATCH_SIZE || 50))
const CACHE_CLEANUP_EVERY_REQUESTS = Math.max(10, Number(process.env.RESPONSE_CACHE_CLEANUP_EVERY || 100))
const CACHE_NS = 'response-cache'
let requestCounter = 0

function nowMs() {
  return Date.now()
}

function redisCacheKey(key) {
  return `${CACHE_NS}:entry:${key}`
}

function redisTagKey(tag) {
  return `${CACHE_NS}:tag:${tag}`
}

function attachKeyToTag(tag, key) {
  if (!tag) return
  if (!tagIndex.has(tag)) {
    tagIndex.set(tag, new Set())
  }
  tagIndex.get(tag).add(key)
}

function touchCacheEntry(key, entry) {
  if (!cacheStore.has(key) || !entry) return
  cacheStore.delete(key)
  cacheStore.set(key, entry)
}

function clearKey(key) {
  const entry = cacheStore.get(key)
  if (!entry) return

  for (const tag of entry.tags) {
    const keys = tagIndex.get(tag)
    if (!keys) continue
    keys.delete(key)
    if (keys.size === 0) {
      tagIndex.delete(tag)
    }
  }

  cacheStore.delete(key)
}

function cleanupExpiredEntries() {
  const now = nowMs()
  for (const [key, entry] of cacheStore.entries()) {
    if (entry.expiresAt <= now) {
      clearKey(key)
    }
  }
}

function ensureCacheCapacity() {
  while (cacheStore.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cacheStore.keys().next().value
    if (!oldestKey) break
    clearKey(oldestKey)
  }
}

function cleanupStaleInflight() {
  const now = nowMs()
  for (const [key, entry] of inflightStore.entries()) {
    if (now - entry.startedAt > MAX_INFLIGHT_MS) {
      inflightStore.delete(key)
      entry.reject(new Error('in-flight request timed out'))
    }
  }
}

function cleanupRedisTagMembership() {
  const current = nowMs()
  for (const [membershipKey, expiresAt] of redisTagMembershipStore.entries()) {
    if (expiresAt <= current) {
      const separatorIndex = membershipKey.indexOf('::')
      const tag = separatorIndex >= 0 ? membershipKey.slice(0, separatorIndex) : ''
      redisTagMembershipStore.delete(membershipKey)
      if (!tag) continue
      const membershipKeys = redisTagMembershipIndex.get(tag)
      if (!membershipKeys) continue
      membershipKeys.delete(membershipKey)
      if (membershipKeys.size === 0) {
        redisTagMembershipIndex.delete(tag)
      }
    }
  }
}

function shouldRefreshRedisTagMembership(tag, key, ttlSeconds) {
  const membershipKey = `${tag}::${key}`
  const current = nowMs()
  const cachedExpiresAt = Number(redisTagMembershipStore.get(membershipKey) || 0)
  if (cachedExpiresAt > current + REDIS_TAG_REFRESH_BUFFER_MS) {
    return false
  }

  if (redisTagMembershipStore.size >= MAX_REDIS_TAG_MEMBERSHIP_ENTRIES) {
    cleanupRedisTagMembership()
  }

  redisTagMembershipStore.set(membershipKey, current + ttlSeconds * 1000)
  if (!redisTagMembershipIndex.has(tag)) {
    redisTagMembershipIndex.set(tag, new Set())
  }
  redisTagMembershipIndex.get(tag).add(membershipKey)
  return true
}

function normalizeTags(tags = []) {
  return [...new Set(tags.map((tag) => String(tag || '').trim()).filter(Boolean))]
}

async function readFromRedisCache(key) {
  const raw = await withRedis('cache_read', (redis) => redis.get(redisCacheKey(key)), null)
  if (!raw) return null

  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
  }

  if (!parsed || typeof parsed !== 'object') return null

  const expiresAt = Number(parsed.expiresAt || 0)
  if (expiresAt <= nowMs()) {
    return null
  }

  return parsed
}

async function writeToRedisCache({ key, status, payload, tags, ttlSeconds }) {
  const expiresAt = nowMs() + ttlSeconds * 1000
  const entry = { status, payload, tags, expiresAt }

  await withRedis(
    'cache_write',
    async (redis) => {
      await redis.set(redisCacheKey(key), JSON.stringify(entry), { ex: ttlSeconds })
      if (!tags.length) return

      const tagsToSync = tags.filter((tag) => shouldRefreshRedisTagMembership(tag, key, ttlSeconds))
      if (!tagsToSync.length) return

      await Promise.all(
        tagsToSync.map(async (tag) => {
          const tagKey = redisTagKey(tag)
          await redis.sadd(tagKey, redisCacheKey(key))
          await redis.expire(tagKey, Math.max(60, ttlSeconds + 30))
        }),
      )
    },
    null,
  )
}

async function invalidateRedisByTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return
  }

  await withRedis(
    'cache_invalidate_tags',
    async (redis) => {
      for (let index = 0; index < tags.length; index += REDIS_INVALIDATION_BATCH_SIZE) {
        const batch = tags.slice(index, index + REDIS_INVALIDATION_BATCH_SIZE)
        await Promise.all(
          batch.map(async (tag) => {
            const tagKey = redisTagKey(tag)
            const keys = await redis.smembers(tagKey)
            const normalizedKeys = Array.isArray(keys) ? keys.filter(Boolean) : []

            if (normalizedKeys.length > 0) {
              await redis.del(...normalizedKeys)
            }

            await redis.del(tagKey)
          }),
        )
      }
    },
    null,
  )
}

export function invalidateCacheByTags(tags = []) {
  const normalizedTags = normalizeTags(tags)
  if (!normalizedTags.length) {
    return
  }

  for (const tag of normalizedTags) {
    const membershipKeys = redisTagMembershipIndex.get(tag)
    if (!membershipKeys) continue
    for (const membershipKey of [...membershipKeys]) {
      redisTagMembershipStore.delete(membershipKey)
    }
    redisTagMembershipIndex.delete(tag)
  }

  for (const tag of normalizedTags) {
    const keys = tagIndex.get(tag)
    if (!keys) continue

    for (const key of [...keys]) {
      clearKey(key)
    }
  }

  void invalidateRedisByTags(normalizedTags)
}

export function cacheResponse({ ttlSeconds = 20, keyBuilder, tagsBuilder, skip } = {}) {
  const ttl = Math.max(1, Number(ttlSeconds) || 20)

  return async (req, res, next) => {
    if (req.method !== 'GET') {
      return next()
    }

    if (typeof skip === 'function' && skip(req)) {
      return next()
    }

    requestCounter += 1
    if (requestCounter % CACHE_CLEANUP_EVERY_REQUESTS === 0) {
      cleanupExpiredEntries()
      cleanupStaleInflight()
      cleanupRedisTagMembership()
    }

    const key = String(keyBuilder ? keyBuilder(req) : req.originalUrl)
    const current = nowMs()
    const cached = cacheStore.get(key)

    if (cached && cached.expiresAt > current) {
      touchCacheEntry(key, cached)
      return res.status(cached.status).json(cached.payload)
    }

    if (cached) {
      clearKey(key)
    }

    const distributedCached = await readFromRedisCache(key)
    if (distributedCached) {
      ensureCacheCapacity()
      const tags = new Set(normalizeTags(distributedCached.tags || []))

      const entry = {
        status: Number(distributedCached.status || 200),
        payload: distributedCached.payload,
        tags,
        expiresAt: Number(distributedCached.expiresAt || nowMs() + ttl * 1000),
      }

      cacheStore.set(key, entry)

      for (const tag of tags) {
        attachKeyToTag(tag, key)
      }

      return res.status(entry.status).json(entry.payload)
    }

    const inflight = inflightStore.get(key)
    if (inflight) {
      return inflight.promise
        .then((result) => res.status(result.status).json(result.payload))
        .catch(() => next())
    }

    let settled = false
    let resolveInflight
    let rejectInflight
    const inflightPromise = new Promise((resolve, reject) => {
      resolveInflight = resolve
      rejectInflight = reject
    })

    inflightStore.set(key, {
      startedAt: nowMs(),
      promise: inflightPromise,
      reject: rejectInflight,
    })

    const originalJson = res.json.bind(res)

    res.json = (payload) => {
      const status = res.statusCode || 200
      if (status >= 200 && status < 300) {
        ensureCacheCapacity()
        const tags = new Set(normalizeTags(tagsBuilder ? tagsBuilder(req, payload) : []))
        const expiresAt = nowMs() + ttl * 1000

        cacheStore.set(key, {
          status,
          payload,
          tags,
          expiresAt,
        })

        for (const tag of tags) {
          attachKeyToTag(tag, key)
        }

        void writeToRedisCache({
          key,
          status,
          payload,
          tags: [...tags],
          ttlSeconds: ttl,
        })
      }

      if (!settled) {
        settled = true
        inflightStore.delete(key)
        resolveInflight({ status, payload })
      }

      return originalJson(payload)
    }

    res.on('close', () => {
      if (settled) return
      settled = true
      inflightStore.delete(key)
      rejectInflight(new Error('request closed before response'))
    })

    return next()
  }
}
