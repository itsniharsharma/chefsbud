import { performanceMetrics } from '../services/performanceMetrics.js'

function normalizeRoutePath(path = '') {
  const trimmed = String(path || '').trim()
  if (!trimmed) return '/unknown'
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function normalizeFallbackPath(path = '') {
  const normalized = normalizeRoutePath(path)
  return normalized
    .split('/')
    .map((segment) => {
      const value = String(segment || '').trim()
      if (!value) return value
      if (/^[0-9]+$/.test(value)) return ':id'
      if (/^[a-f0-9]{24}$/i.test(value)) return ':id'
      return value
    })
    .join('/')
}

export function requestLatencyMetrics(req, res, next) {
  if (!performanceMetrics.isEnabled) {
    return next()
  }

  if (req.path === '/api/health') {
    return next()
  }

  const startedAt = process.hrtime.bigint()
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    const routePath = req.route?.path || normalizeFallbackPath(req.path || '/unknown')
    const basePath = req.baseUrl || ''
    const routeKey = `${req.method} ${normalizeRoutePath(`${basePath}${routePath}`)}`

    performanceMetrics.recordHttp({
      routeKey,
      durationMs,
      statusCode: res.statusCode,
    })
  })

  return next()
}
