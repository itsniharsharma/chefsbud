const SESSION_STORAGE_PREFIX = 'chefs_bud_customer_session'

function generateSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export function getCustomerAnalyticsSessionId({ restaurantSlug, tableNumber }) {
  const key = `${SESSION_STORAGE_PREFIX}:${String(restaurantSlug || '').trim()}:${String(tableNumber || '').trim()}`
  const existing = sessionStorage.getItem(key)
  if (existing) return existing

  const next = generateSessionId()
  sessionStorage.setItem(key, next)
  return next
}
