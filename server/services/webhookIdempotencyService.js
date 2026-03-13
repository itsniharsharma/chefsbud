import { withRedis } from '../config/redis.js'

const processedLocalStore = new Map()
const lockLocalStore = new Map()

const PROCESSED_TTL_SECONDS = Math.max(60, Number(process.env.WEBHOOK_PROCESSED_TTL_SECONDS || 24 * 60 * 60))
const LOCK_TTL_SECONDS = Math.max(5, Number(process.env.WEBHOOK_LOCK_TTL_SECONDS || 120))

function nowMs() {
  return Date.now()
}

function processedKey(eventId) {
  return `webhook:processed:${eventId}`
}

function lockKey(eventId) {
  return `webhook:lock:${eventId}`
}

function cleanupLocalStores() {
  const now = nowMs()

  for (const [key, expiresAt] of processedLocalStore.entries()) {
    if (expiresAt <= now) {
      processedLocalStore.delete(key)
    }
  }

  for (const [key, expiresAt] of lockLocalStore.entries()) {
    if (expiresAt <= now) {
      lockLocalStore.delete(key)
    }
  }
}

export async function isWebhookProcessed(eventId) {
  const normalized = String(eventId || '').trim()
  if (!normalized) return false

  cleanupLocalStores()
  if (processedLocalStore.has(normalized)) {
    return true
  }

  const marker = await withRedis(
    'webhook_processed_get',
    (redis) => redis.get(processedKey(normalized)),
    null,
  )

  return Boolean(marker)
}

export async function acquireWebhookLock(eventId) {
  const normalized = String(eventId || '').trim()
  if (!normalized) return true

  cleanupLocalStores()
  const now = nowMs()
  const existingLock = lockLocalStore.get(normalized)
  if (existingLock && existingLock > now) {
    return false
  }

  const distributedLock = await withRedis(
    'webhook_lock_set',
    (redis) =>
      redis.set(lockKey(normalized), String(now), {
        nx: true,
        ex: LOCK_TTL_SECONDS,
      }),
    '__FALLBACK__',
  )

  if (distributedLock === 'OK') {
    lockLocalStore.set(normalized, now + LOCK_TTL_SECONDS * 1000)
    return true
  }

  if (distributedLock === '__FALLBACK__') {
    lockLocalStore.set(normalized, now + LOCK_TTL_SECONDS * 1000)
    return true
  }

  return false
}

export async function releaseWebhookLock(eventId) {
  const normalized = String(eventId || '').trim()
  if (!normalized) return

  lockLocalStore.delete(normalized)
  await withRedis('webhook_lock_release', (redis) => redis.del(lockKey(normalized)), 0)
}

export async function markWebhookProcessed(eventId) {
  const normalized = String(eventId || '').trim()
  if (!normalized) return

  const expiresAt = nowMs() + PROCESSED_TTL_SECONDS * 1000
  processedLocalStore.set(normalized, expiresAt)

  await withRedis(
    'webhook_processed_set',
    (redis) => redis.set(processedKey(normalized), '1', { ex: PROCESSED_TTL_SECONDS }),
    null,
  )
}
