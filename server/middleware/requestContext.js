import crypto from 'crypto'
import { logger } from '../utils/logger.js'

const SLOW_REQUEST_THRESHOLD_MS = Number(process.env.SLOW_REQUEST_THRESHOLD_MS || 3000)

function buildRequestId() {
  const fn = crypto.randomUUID
  if (typeof fn === 'function') {
    return fn()
  }
  return `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`
}

export function requestContext(req, res, next) {
  const requestId = String(req.get('x-request-id') || '').trim() || buildRequestId()
  const startedAt = process.hrtime.bigint()

  req.id = requestId
  res.setHeader('x-request-id', requestId)

  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    const rounded = Math.round(elapsedMs * 100) / 100
    const isSlow = rounded > SLOW_REQUEST_THRESHOLD_MS
    logger[isSlow ? 'warn' : 'info'](isSlow ? 'slow_request' : 'http_request', {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: rounded,
      ip: req.ip,
      userId: req.user?._id || null,
    })
  })

  next()
}
