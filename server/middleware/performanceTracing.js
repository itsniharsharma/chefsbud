import { logger } from '../utils/logger.js'
import { recordHistogramMetric } from '../services/performanceMetrics.js'

/**
 * PERFORMANCE TRACING MIDDLEWARE
 * ==============================
 * Detailed timing breakdown for order-related endpoints
 * Tracks: draft building, DB operations, offer computation, etc.
 * Enables production-grade visibility into bottleneck sources
 */

class PerformanceTracer {
  constructor(requestId) {
    this.requestId = requestId
    this.marks = new Map() 
    this.startTime = process.hrtime.bigint()
  }

  mark(name) {
    this.marks.set(name, process.hrtime.bigint())
  }

  measure(name, fromMark, toMark) {
    const from = this.marks.get(fromMark) || this.startTime
    const to = this.marks.get(toMark) || process.hrtime.bigint()
    const durationMs = Number(to - from) / 1_000_000
    return durationMs
  }

  getTotalMs() {
    const to = process.hrtime.bigint()
    const durationMs = Number(to - this.startTime) / 1_000_000
    return durationMs
  }

  getBreakdown() {
    return Object.fromEntries(this.marks)
  }
}

// Store tracer in request context
export function attachPerformanceTracer(req, res, next) {
  req._perfTracer = new PerformanceTracer(req.id || req.headers['x-request-id'] || 'unknown')
  req._perfTracer.mark('start')
  
  // Hook response sending to capture final timing
  const originalJson = res.json.bind(res)
  res.json = function(data) {
    req._perfTracer.mark('before_send')
    const totalMs = req._perfTracer.getTotalMs()
    
    // Record performance metric
    if (req.path && req.method) {
      const endpointKey = `${req.method} ${req.path}`.toLowerCase()
      try {
        recordHistogramMetric(`endpoint_duration_ms:${endpointKey}`, totalMs)
        // eslint-disable-next-line no-unused-vars
      } catch (e) {
        // Ignore metric recording failures
      }
    }

    // Log slow requests (>500ms)
    if (totalMs > 500) {
      logger.warn('slow_request_detected', {
        requestId: req._perfTracer.requestId,
        method: req.method,
        path: req.path,
        totalMs: Math.round(totalMs),
        breakdown: {
          draft: req._draftMs || 0,
          db: req._dbMs || 0,
          offers: req._offersMs || 0,
        },
      })
    }

    return originalJson(data)
  }

  next()
}

/**
 * DRAFT BUILDING PROFILER
 * Tracks time spent in buildCustomerOrderDraft
 */
export function wrapDraftBuilding(originalFn) {
  return async function profiledBuildDraft(params) {
    const startNs = process.hrtime.bigint()
    try {
      const result = await originalFn(params)
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000
      
      // Attach to request if available (via context)
      if (globalThis._currentRequest) {
        globalThis._currentRequest._draftMs = durationMs
      }

      recordHistogramMetric('draft_building_ms', durationMs, {
        cacheHit: result.cacheHit ? 'yes' : 'no',
      })

      if (durationMs > 300) {
        logger.warn('slow_draft_building', {
          durationMs: Math.round(durationMs),
          cacheHit: result.cacheHit || false,
        })
      }

      return result
    } catch (error) {
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000
      logger.error('draft_building_failed', {
        durationMs: Math.round(durationMs),
        message: error?.message || 'unknown_error',
      })
      throw error
    }
  }
}

/**
 * REQUEST CONTEXT TRACER
 * Injects request context for timing measurements
 */
export function attachRequestContext(req, res, next) {
  req._orderCreateStartedAtNs = process.hrtime.bigint()
  
  // Store in global context for cross-function access
  const previousContext = globalThis._currentRequest
  globalThis._currentRequest = req

  res.on('finish', () => {
    globalThis._currentRequest = previousContext
  })

  next()
}

/**
 * VALIDATION TIMING
 * Track middleware validation time
 */
export function attachValidationTiming(req, res, next) {
  req._orderCreateValidatedAtNs = process.hrtime.bigint()
  next()
}

/**
 * HISTOGRAM RECORDING HELPER
 * Records metric with automatic bucketing
 */
export function recordEndpointMetric(req, metricName, value, tags = {}) {
  try {
    recordHistogramMetric(metricName, value, tags)
    // eslint-disable-next-line no-unused-vars
  } catch (e) {
    // Silently fail on metric errors
  }
}

/**
 * PERFORMANCE SUMMARY HEADER
 * Adds X-Response-Time header showing total latency
 */
export function addResponseTimeHeader(req, res, next) {
  const startTime = process.hrtime.bigint()
  
  res.on('finish', () => {
    const totalMs = Number(process.hrtime.bigint() - startTime) / 1_000_000
    res.setHeader('X-Response-Time', `${Math.round(totalMs)}ms`)
  })

  next()
}
