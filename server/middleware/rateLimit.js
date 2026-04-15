import { withRedis } from '../config/redis.js'

const RATE_LIMIT_ATOMIC_SCRIPT = `
local key = KEYS[1]
local windowSec = tonumber(ARGV[1])

local count = redis.call('INCR', key)
if count == 1 then
  redis.call('EXPIRE', key, windowSec)
end

local ttl = redis.call('TTL', key)
if ttl < 0 then
  redis.call('EXPIRE', key, windowSec)
  ttl = windowSec
end

return {count, ttl}
`

let atomicScriptEnabled = true
const RATE_LIMIT_USE_REDIS = String(process.env.RATE_LIMIT_USE_REDIS || 'true') === 'true'

function nowMs() {
  return Date.now()
}

const orderCreateBurstStore = new Map()
const ORDER_CREATE_BURST_WINDOW_MS = Math.max(5000, Number(process.env.ORDER_CREATE_BURST_WINDOW_MS || 15_000))
const ORDER_CREATE_BURST_THRESHOLD = Math.max(3, Number(process.env.ORDER_CREATE_BURST_THRESHOLD || 4))

function secondsFromMs(ms) {
  return Math.max(1, Math.ceil(ms / 1000))
}

function cleanupOrderCreateBurstStore() {
  const cutoff = nowMs() - Math.max(ORDER_CREATE_BURST_WINDOW_MS * 4, 60_000)
  for (const [key, entry] of orderCreateBurstStore.entries()) {
    if (entry.lastSeenAt < cutoff) {
      orderCreateBurstStore.delete(key)
    }
  }
}

export function shouldApplyOrderCreateBurstLimit(req) {
  const ip = String(req?.ip || '').trim() || 'unknown'
  const currentMs = nowMs()
  const existing = orderCreateBurstStore.get(ip) || {
    windowStartedAt: currentMs,
    hitCount: 0,
    lastSeenAt: currentMs,
  }

  if (currentMs - existing.windowStartedAt > ORDER_CREATE_BURST_WINDOW_MS) {
    existing.windowStartedAt = currentMs
    existing.hitCount = 0
  }

  existing.hitCount += 1
  existing.lastSeenAt = currentMs
  orderCreateBurstStore.set(ip, existing)

  if (orderCreateBurstStore.size > 5000) {
    cleanupOrderCreateBurstStore()
  }

  return existing.hitCount >= ORDER_CREATE_BURST_THRESHOLD
}

export function createRateLimiter({
  capacity,
  windowMs,
  keyFn,
  id = 'rate-limit',
  skip,
}) {
  const maxTokens = Math.max(1, Number(capacity) || 60)
  const refillWindowMs = Math.max(1000, Number(windowMs) || 60_000)
  const refillRatePerMs = maxTokens / refillWindowMs
  const refillWindowSeconds = Math.max(1, Math.ceil(refillWindowMs / 1000))
  const store = new Map()

  const cleanupInterval = setInterval(() => {
    const cutoff = nowMs() - Math.max(refillWindowMs * 3, 10 * 60 * 1000)
    for (const [key, entry] of store.entries()) {
      if (entry.lastSeenAt < cutoff) {
        store.delete(key)
      }
    }
  }, Math.max(refillWindowMs, 60_000))

  if (typeof cleanupInterval.unref === 'function') {
    cleanupInterval.unref()
  }

  function setRateLimitHeaders(res, remaining) {
    res.setHeader('X-RateLimit-Limit', String(maxTokens))
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, Math.floor(remaining))))
    res.setHeader('X-RateLimit-Policy', `${id};w=${Math.round(refillWindowMs / 1000)};c=${maxTokens}`)
  }

  function applyLocalRateLimit(key, req, res, next) {
    const currentMs = nowMs()
    const existing = store.get(key) || {
      tokens: maxTokens,
      lastRefillAt: currentMs,
      blockedUntilMs: 0,
      lastSeenAt: currentMs,
    }

    if (existing.blockedUntilMs > currentMs) {
      const retryAfterMs = existing.blockedUntilMs - currentMs
      res.setHeader('Retry-After', String(secondsFromMs(retryAfterMs)))
      setRateLimitHeaders(res, existing.tokens)
      return res.status(429).json({ message: 'Too many requests. Please retry shortly.' })
    }

    const elapsed = Math.max(0, currentMs - existing.lastRefillAt)
    const refilled = elapsed * refillRatePerMs
    existing.tokens = Math.min(maxTokens, existing.tokens + refilled)
    existing.lastRefillAt = currentMs
    existing.lastSeenAt = currentMs

    if (existing.tokens < 1) {
      const deficit = 1 - existing.tokens
      const retryAfterMs = Math.ceil(deficit / refillRatePerMs)
      existing.blockedUntilMs = currentMs + Math.max(retryAfterMs, 1000)
      store.set(key, existing)

      res.setHeader('Retry-After', String(secondsFromMs(retryAfterMs)))
      setRateLimitHeaders(res, existing.tokens)
      return res.status(429).json({ message: 'Too many requests. Please retry shortly.' })
    }

    existing.tokens -= 1
    store.set(key, existing)
    setRateLimitHeaders(res, existing.tokens)
    return next()
  }

  return async function rateLimitMiddleware(req, res, next) {
    if (typeof skip === 'function' && skip(req) === true) {
      return next()
    }

    if (!RATE_LIMIT_USE_REDIS) {
      const key = (typeof keyFn === 'function' ? keyFn(req) : req.ip) || req.ip || 'unknown'
      return applyLocalRateLimit(key, req, res, next)
    }

    const key = (typeof keyFn === 'function' ? keyFn(req) : req.ip) || req.ip || 'unknown'
    const redisKey = `ratelimit:${id}:${key}`

    const redisResult = await withRedis(
      'rate_limit_increment',
      async (redis) => {
        if (atomicScriptEnabled && typeof redis?.command === 'function') {
          try {
            const raw = await redis.command(['EVAL', RATE_LIMIT_ATOMIC_SCRIPT, '1', redisKey, String(refillWindowSeconds)])
            const normalized = Array.isArray(raw) ? raw : []
            const count = Number(normalized[0] || 0)
            const ttl = Number(normalized[1] || refillWindowSeconds)
            if (Number.isFinite(count) && count > 0) {
              return { count, ttl }
            }
          } catch {
            atomicScriptEnabled = false
          }
        }

        const count = Number(await redis.incr(redisKey))
        if (count === 1) {
          await redis.expire(redisKey, refillWindowSeconds)
        }

        let ttl = refillWindowSeconds
        if (count > maxTokens) {
          const currentTtl = Number(await redis.ttl(redisKey))
          if (currentTtl > 0) {
            ttl = currentTtl
          }
        }

        return { count, ttl }
      },
      null,
    )

    if (redisResult) {
      const { count, ttl } = redisResult
      const remaining = Math.max(0, maxTokens - count)
      setRateLimitHeaders(res, remaining)

      if (count > maxTokens) {
        const retryAfterSeconds = Number(ttl) > 0 ? Number(ttl) : refillWindowSeconds
        res.setHeader('Retry-After', String(retryAfterSeconds))
        return res.status(429).json({ message: 'Too many requests. Please retry shortly.' })
      }

      return next()
    }

    return applyLocalRateLimit(key, req, res, next)
  }
}
