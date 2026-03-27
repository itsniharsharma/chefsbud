const SESSION_STORAGE_PREFIX = 'chefs_bud_customer_session'

function randomToken(length = 12) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buffer = new Uint32Array(length)
    crypto.getRandomValues(buffer)
    for (let idx = 0; idx < length; idx += 1) {
      out += alphabet[buffer[idx] % alphabet.length]
    }
    return out
  }

  for (let idx = 0; idx < length; idx += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

function generateSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export function getCustomerAnalyticsSessionId({ restaurantSlug, tableNumber }) {
  const key = `${SESSION_STORAGE_PREFIX}:${String(restaurantSlug || '').trim()}:${String(tableNumber || '').trim()}`
  if (typeof sessionStorage === 'undefined') {
    return generateSessionId()
  }

  const existing = sessionStorage.getItem(key)
  if (existing) return existing

  const next = generateSessionId()
  sessionStorage.setItem(key, next)
  return next
}

export function createCustomerAnalyticsEventId({ prefix = 'evt', restaurantSlug = '', tableNumber = '', menuItemId = '' } = {}) {
  const base = [
    String(prefix || 'evt').trim().toLowerCase(),
    String(restaurantSlug || '').trim().toLowerCase(),
    String(tableNumber || '').trim(),
    String(menuItemId || '').trim(),
    Date.now().toString(36),
  ]
    .filter(Boolean)
    .join(':')

  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${base}:${crypto.randomUUID()}`
  }

  return `${base}:${randomToken(16)}`
}
