function normalizeRazorpayMeLink(value) {
  return String(value || '').trim()
}

function buildConfigError(message) {
  const error = new Error(message)
  error.statusCode = 409
  return error
}

function isSupportedRazorpayMeHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  return host === 'razorpay.me' || host === 'www.razorpay.me' || host === 'rzp.io' || host === 'www.rzp.io'
}

export function validateRazorpayMeLink(value) {
  const link = normalizeRazorpayMeLink(value)
  if (!link) {
    throw buildConfigError('razorpay.me link is required')
  }

  let parsed
  try {
    parsed = new URL(link)
  } catch {
    throw buildConfigError('Invalid razorpay.me link')
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw buildConfigError('Invalid razorpay.me link protocol')
  }

  if (!isSupportedRazorpayMeHost(parsed.hostname)) {
    throw buildConfigError('Only razorpay.me links are allowed')
  }

  if (!parsed.pathname || parsed.pathname === '/') {
    throw buildConfigError('Razorpay.me link path is missing')
  }

  parsed.search = ''
  parsed.hash = ''

  return parsed.toString().replace(/\/$/, '')
}

export function isRestaurantPaymentConfigComplete(paymentConfig = {}) {
  const link = normalizeRazorpayMeLink(paymentConfig?.razorpayMeLink)
  return Boolean(paymentConfig?.enabled && paymentConfig?.provider === 'razorpay_me' && link)
}

export function serializeRestaurantPaymentConfig(paymentConfig = {}) {
  const link = normalizeRazorpayMeLink(paymentConfig?.razorpayMeLink)
  return {
    provider: paymentConfig?.provider || 'razorpay_me',
    enabled: Boolean(paymentConfig?.enabled),
    razorpayMeLink: link,
    configuredAt: paymentConfig?.configuredAt || null,
    isReady: isRestaurantPaymentConfigComplete(paymentConfig),
  }
}

export function applyRestaurantPaymentConfig(restaurant, payload = {}) {
  if (!restaurant) return restaurant

  const current = restaurant.paymentConfig || { provider: 'razorpay_me', enabled: false }
  const nextEnabled = typeof payload.enabled === 'boolean' ? payload.enabled : Boolean(current.enabled)
  const hasLinkInPayload = 'razorpayMeLink' in payload
  const nextLink = hasLinkInPayload ? normalizeRazorpayMeLink(payload.razorpayMeLink) : normalizeRazorpayMeLink(current.razorpayMeLink)

  restaurant.paymentConfig = {
    provider: 'razorpay_me',
    enabled: nextEnabled,
    razorpayMeLink: nextLink,
    configuredAt: new Date(),
  }

  if (nextEnabled) {
    restaurant.paymentConfig.razorpayMeLink = validateRazorpayMeLink(nextLink)
  }

  return restaurant
}

export function buildRazorpayMeCheckoutUrl({ razorpayMeLink, amountPaise }) {
  void amountPaise
  return validateRazorpayMeLink(razorpayMeLink)
}
