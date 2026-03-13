import { withRedis } from '../config/redis.js'

const cacheStore = new Map()
const tagIndex = new Map()
const inflightStore = new Map()
const MAX_CACHE_ENTRIES = 500
const MAX_INFLIGHT_MS = 30000
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

      await Promise.all(
        tags.map(async (tag) => {
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
  await withRedis(
    'cache_invalidate_tags',
    async (redis) => {
      for (const tag of tags) {
        const tagKey = redisTagKey(tag)
        const keys = await redis.smembers(tagKey)
        const normalizedKeys = Array.isArray(keys) ? keys.filter(Boolean) : []

        if (normalizedKeys.length > 0) {
          await redis.del(...normalizedKeys)
        }

        await redis.del(tagKey)
      }
    },
    null,
  )
}

export function invalidateCacheByTags(tags = []) {
  const normalizedTags = normalizeTags(tags)

  for (const tag of normalizedTags) {
    const keys = tagIndex.get(tag)
    if (!keys) continue

    for (const key of [...keys]) {
      clearKey(key)
    }
  }

  void invalidateRedisByTags(normalizedTags)
}

export function cacheResponse({ ttlSeconds = 20, keyBuilder, tagsBuilder } = {}) {
  const ttl = Math.max(1, Number(ttlSeconds) || 20)

  return async (req, res, next) => {
    if (req.method !== 'GET') {
      return next()
    }

    requestCounter += 1
    if (requestCounter % 100 === 0) {
      cleanupExpiredEntries()
      cleanupStaleInflight()
    }

    const key = String(keyBuilder ? keyBuilder(req) : req.originalUrl)
    const current = nowMs()
    const cached = cacheStore.get(key)

    if (cached && cached.expiresAt > current) {
      return res.status(cached.status).json(cached.payload)
    }

    if (cached) {
      clearKey(key)
    }

    const distributedCached = await readFromRedisCache(key)
    if (distributedCached) {
      ensureCacheCapacity()
      const tags = new Set(normalizeTags(distributedCached.tags || []))

      cacheStore.set(key, {
        status: Number(distributedCached.status || 200),
        payload: distributedCached.payload,
        tags,
        expiresAt: Number(distributedCached.expiresAt || nowMs() + ttl * 1000),
      })

      for (const tag of tags) {
        attachKeyToTag(tag, key)
      }

      return res.status(Number(distributedCached.status || 200)).json(distributedCached.payload)
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
