import { analyticsService } from './analyticsService'

const QUEUE_STORAGE_KEY = 'chefs_bud_analytics_queue_v1'
const MAX_QUEUE_LENGTH = 300
const MAX_RETRY_DELAY_MS = 60_000
const MAX_ATTEMPTS = 8
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000

let isFlushing = false
let flushTimer = null
let initialized = false

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function loadQueue() {
  if (typeof localStorage === 'undefined') return []
  const raw = localStorage.getItem(QUEUE_STORAGE_KEY)
  const parsed = safeJsonParse(raw || '[]', [])
  if (!Array.isArray(parsed)) return []

  const now = Date.now()
  return parsed.filter((entry) => {
    const createdAt = Number(entry?.createdAt || 0)
    if (!createdAt) return false
    return now - createdAt <= MAX_EVENT_AGE_MS
  })
}

function saveQueue(queue) {
  if (typeof localStorage === 'undefined') return
  const safeQueue = Array.isArray(queue) ? queue.slice(-MAX_QUEUE_LENGTH) : []
  localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(safeQueue))
}

function ensureInitialized() {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  const onOnline = () => {
    scheduleFlush(100)
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      scheduleFlush(100)
    }
  }

  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
}

function scheduleFlush(delayMs = 250) {
  if (typeof window === 'undefined') return
  if (flushTimer) {
    clearTimeout(flushTimer)
  }

  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushQueue()
  }, Math.max(0, Number(delayMs || 0)))
}

function canAttemptNow(entry, now) {
  return Number(entry?.nextAttemptAt || 0) <= now
}

function shouldDropEntry(entry, now) {
  const attempts = Number(entry?.attempts || 0)
  const createdAt = Number(entry?.createdAt || 0)
  if (!createdAt || now - createdAt > MAX_EVENT_AGE_MS) return true
  return attempts >= MAX_ATTEMPTS
}

function upsertQueueEntry(queue, nextEntry) {
  const nextId = String(nextEntry?.id || '').trim()
  if (!nextId) return queue

  const index = queue.findIndex((entry) => String(entry?.id || '') === nextId)
  if (index === -1) {
    queue.push(nextEntry)
    return queue
  }

  const existing = queue[index]
  const existingAttempts = Number(existing?.attempts || 0)
  const nextAttempts = Number(nextEntry?.attempts || 0)

  queue[index] = {
    ...existing,
    ...nextEntry,
    attempts: Math.max(existingAttempts, nextAttempts),
    createdAt: Math.min(Number(existing?.createdAt || Date.now()), Number(nextEntry?.createdAt || Date.now())),
    nextAttemptAt: Math.min(Number(existing?.nextAttemptAt || Date.now()), Number(nextEntry?.nextAttemptAt || Date.now())),
  }

  return queue
}

function nextDelayMs(attempts) {
  const safeAttempts = Math.max(1, Number(attempts || 1))
  return Math.min(MAX_RETRY_DELAY_MS, (2 ** safeAttempts) * 1000)
}

async function dispatchEntry(entry) {
  if (entry.type === 'menu-view') {
    return analyticsService.trackMenuExposure(entry.payload)
  }

  if (entry.type === 'add-to-cart') {
    return analyticsService.trackAddToCart(entry.payload)
  }

  return null
}

export function queueAnalyticsEvent(type, payload) {
  ensureInitialized()

  const next = {
    id: String(payload?.eventId || `${type}:${Date.now()}`),
    type,
    payload,
    attempts: 0,
    createdAt: Date.now(),
    nextAttemptAt: Date.now(),
  }

  const queue = loadQueue()
  upsertQueueEntry(queue, next)
  saveQueue(queue)
  scheduleFlush(100)
}

export async function flushQueue() {
  ensureInitialized()

  if (isFlushing) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    scheduleFlush(2000)
    return
  }
  isFlushing = true

  try {
    const now = Date.now()
    const queue = loadQueue()
    const remaining = []
    let earliestRetry = null

    for (const entry of queue) {
      if (shouldDropEntry(entry, now)) {
        continue
      }

      if (!canAttemptNow(entry, now)) {
        remaining.push(entry)
        earliestRetry = earliestRetry === null ? Number(entry.nextAttemptAt) : Math.min(earliestRetry, Number(entry.nextAttemptAt))
        continue
      }

      try {
        await dispatchEntry(entry)
      } catch {
        const attempts = Number(entry?.attempts || 0) + 1
        if (attempts >= MAX_ATTEMPTS) {
          continue
        }
        const nextAt = now + nextDelayMs(attempts)
        remaining.push({
          ...entry,
          attempts,
          nextAttemptAt: nextAt,
        })
        earliestRetry = earliestRetry === null ? nextAt : Math.min(earliestRetry, nextAt)
      }
    }

    saveQueue(remaining)

    if (earliestRetry !== null) {
      scheduleFlush(Math.max(250, earliestRetry - Date.now()))
    }
  } finally {
    isFlushing = false
  }
}

export function trackMenuExposureReliable(payload) {
  queueAnalyticsEvent('menu-view', payload)
}

export function trackAddToCartReliable(payload) {
  queueAnalyticsEvent('add-to-cart', payload)
}
