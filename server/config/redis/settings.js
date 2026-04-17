import { logger } from '../../utils/logger.js'

const redisRestUrl = String(process.env.UPSTASH_REDIS_REST_URL || '').trim()
const redisRestToken = String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const configuredRedisSocketUrl = String(process.env.REDIS_SOCKET_URL || process.env.REDIS_URL || '').trim()

let warnedSocketUrlNormalized = false

function normalizeRedisSocketUrl(url) {
  const normalized = String(url || '').trim()
  if (!normalized) return ''

  try {
    const parsed = new URL(normalized)
    const host = String(parsed.hostname || '').toLowerCase()
    if (parsed.protocol === 'redis:' && host.endsWith('.upstash.io')) {
      parsed.protocol = 'rediss:'
      if (!warnedSocketUrlNormalized) {
        warnedSocketUrlNormalized = true
        logger.warn('redis_socket_url_normalized_to_tls', {
          message: 'Upstash socket Redis URLs should use rediss://. Normalized redis:// to rediss:// for this process.',
        })
      }
      return parsed.toString()
    }
  } catch {
    return normalized
  }

  return normalized
}

export const redisSettings = Object.freeze({
  restUrl: redisRestUrl,
  restToken: redisRestToken,
  socketUrl: normalizeRedisSocketUrl(configuredRedisSocketUrl),
})

