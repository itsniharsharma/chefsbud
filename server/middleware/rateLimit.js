import { withRedis } from '../config/redis.js'

function nowMs() {
  return Date.now()
}

function secondsFromMs(ms) {
  return Math.max(1, Math.ceil(ms / 1000))
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

    const key = (typeof keyFn === 'function' ? keyFn(req) : req.ip) || req.ip || 'unknown'
    const redisKey = `ratelimit:${id}:${key}`

    const redisResult = await withRedis(
      'rate_limit_increment',
      async (redis) => {
        const count = Number(await redis.incr(redisKey))
        if (count === 1) {
          await redis.expire(redisKey, refillWindowSeconds)
        }
        return { count }
      },
      null,
    )

    if (redisResult) {
      const { count } = redisResult
      const remaining = Math.max(0, maxTokens - count)
      setRateLimitHeaders(res, remaining)

      if (count > maxTokens) {
        const ttl = await withRedis('rate_limit_ttl', (redis) => redis.ttl(redisKey), refillWindowSeconds)
        const retryAfterSeconds = Number(ttl) > 0 ? Number(ttl) : refillWindowSeconds
        res.setHeader('Retry-After', String(retryAfterSeconds))
        return res.status(429).json({ message: 'Too many requests. Please retry shortly.' })
      }

      return next()
    }

    return applyLocalRateLimit(key, req, res, next)
  }
}
