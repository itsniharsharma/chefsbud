import { logger } from '../utils/logger.js'

const METRICS_ENABLED = String(process.env.PERF_METRICS_ENABLED || 'true') === 'true'
const FLUSH_INTERVAL_MS = Math.max(15_000, Number(process.env.PERF_METRICS_FLUSH_INTERVAL_MS || 60_000))
const MAX_KEYS_PER_FAMILY = Math.max(25, Number(process.env.PERF_METRICS_MAX_KEYS_PER_FAMILY || 500))
const HISTOGRAM_BOUNDS_MS = [5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000]

function createHistogram() {
  return {
    bounds: HISTOGRAM_BOUNDS_MS,
    buckets: Array(HISTOGRAM_BOUNDS_MS.length + 1).fill(0),
  }
}

function observeHistogram(histogram, valueMs) {
  const value = Math.max(0, Number(valueMs || 0))
  const bounds = histogram.bounds
  let index = bounds.findIndex((bound) => value <= bound)
  if (index < 0) index = bounds.length
  histogram.buckets[index] += 1
}

function percentileFromHistogram(histogram, p) {
  const percentile = Math.max(0, Math.min(1, Number(p || 0)))
  const total = histogram.buckets.reduce((sum, count) => sum + count, 0)
  if (!total) return 0

  const threshold = Math.ceil(total * percentile)
  let seen = 0
  for (let index = 0; index < histogram.buckets.length; index += 1) {
    seen += Number(histogram.buckets[index] || 0)
    if (seen >= threshold) {
      if (index >= histogram.bounds.length) {
        return histogram.bounds[histogram.bounds.length - 1]
      }
      return histogram.bounds[index]
    }
  }

  return histogram.bounds[histogram.bounds.length - 1]
}

function createStats() {
  return {
    count: 0,
    errorCount: 0,
    totalMs: 0,
    maxMs: 0,
    histogram: createHistogram(),
  }
}

function normalizeKey(value, fallback) {
  const normalized = String(value || '').trim()
  return normalized || fallback
}

function buildSummary(stats) {
  const count = Number(stats?.count || 0)
  if (!count) {
    return {
      count: 0,
      errorCount: 0,
      errorRatePct: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
    }
  }

  const errorCount = Number(stats?.errorCount || 0)
  return {
    count,
    errorCount,
    errorRatePct: Math.round((errorCount / count) * 10_000) / 100,
    avgMs: Math.round((Number(stats.totalMs || 0) / count) * 100) / 100,
    p50Ms: percentileFromHistogram(stats.histogram, 0.5),
    p95Ms: percentileFromHistogram(stats.histogram, 0.95),
    p99Ms: percentileFromHistogram(stats.histogram, 0.99),
    maxMs: Math.round(Number(stats.maxMs || 0) * 100) / 100,
  }
}

function mapStatsToSummaries(statsMap = new Map()) {
  return [...statsMap.entries()].map(([key, stats]) => ({
    key,
    ...buildSummary(stats),
  }))
}

class PerformanceMetrics {
  constructor() {
    this.enabled = METRICS_ENABLED
    this.flushTimer = null
    this.httpStats = new Map()
    this.mongoStats = new Map()
  }

  start() {
    if (!this.enabled || this.flushTimer) return

    this.flushTimer = setInterval(() => {
      this.flush()
    }, FLUSH_INTERVAL_MS)
    this.flushTimer.unref?.()
  }

  stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    this.flush()
  }

  get isEnabled() {
    return this.enabled
  }

  recordHttp({ routeKey, durationMs, statusCode }) {
    if (!this.enabled) return

    const requestedKey = normalizeKey(routeKey, 'UNKNOWN_ROUTE')
    const canCreateNewKey = this.httpStats.has(requestedKey) || this.httpStats.size < MAX_KEYS_PER_FAMILY
    const key = canCreateNewKey ? requestedKey : 'OTHER'

    if (!this.httpStats.has(key)) {
      this.httpStats.set(key, createStats())
    }

    const stats = this.httpStats.get(key) || this.httpStats.get('OTHER')
    if (!stats) return

    const duration = Math.max(0, Number(durationMs || 0))
    stats.count += 1
    if (Number(statusCode || 0) >= 500) {
      stats.errorCount += 1
    }
    stats.totalMs += duration
    stats.maxMs = Math.max(stats.maxMs, duration)
    observeHistogram(stats.histogram, duration)
  }

  recordMongo({ operationKey, durationMs, failed = false }) {
    if (!this.enabled) return

    const requestedKey = normalizeKey(operationKey, 'mongodb.unknown')
    const canCreateNewKey = this.mongoStats.has(requestedKey) || this.mongoStats.size < MAX_KEYS_PER_FAMILY
    const key = canCreateNewKey ? requestedKey : 'OTHER'

    if (!this.mongoStats.has(key)) {
      this.mongoStats.set(key, createStats())
    }

    const stats = this.mongoStats.get(key) || this.mongoStats.get('OTHER')
    if (!stats) return

    const duration = Math.max(0, Number(durationMs || 0))
    stats.count += 1
    if (failed) {
      stats.errorCount += 1
    }
    stats.totalMs += duration
    stats.maxMs = Math.max(stats.maxMs, duration)
    observeHistogram(stats.histogram, duration)
  }

  getMongoOperationSummaries({ operationPrefix = '', minCount = 1, limit = 100 } = {}) {
    if (!this.enabled) {
      return []
    }

    const normalizedPrefix = String(operationPrefix || '').trim()
    const safeMinCount = Math.max(1, Number(minCount || 1))
    const safeLimit = Math.max(1, Number(limit || 100))

    return mapStatsToSummaries(this.mongoStats)
      .map((entry) => ({
        operationKey: entry.key,
        count: entry.count,
        errorCount: entry.errorCount,
        errorRatePct: entry.errorRatePct,
        avgMs: entry.avgMs,
        p50Ms: entry.p50Ms,
        p95Ms: entry.p95Ms,
        p99Ms: entry.p99Ms,
        maxMs: entry.maxMs,
      }))
      .filter((entry) => {
        if (entry.count < safeMinCount) return false
        if (!normalizedPrefix) return true
        return String(entry.operationKey || '').startsWith(normalizedPrefix)
      })
      .sort((a, b) => b.p95Ms - a.p95Ms)
      .slice(0, safeLimit)
  }

  getMongoPressure({ operationPrefix = '', minSamples = 10 } = {}) {
    const rows = this.getMongoOperationSummaries({
      operationPrefix,
      minCount: Math.max(1, Number(minSamples || 10)),
      limit: 250,
    })

    if (!rows.length) {
      return {
        available: false,
        operationCount: 0,
        sampleCount: 0,
        weightedAvgMs: 0,
        maxP95Ms: 0,
        p95Ms: 0,
      }
    }

    const sampleCount = rows.reduce((sum, row) => sum + Number(row.count || 0), 0)
    const weightedAvgMs = sampleCount > 0
      ? rows.reduce((sum, row) => sum + Number(row.avgMs || 0) * Number(row.count || 0), 0) / sampleCount
      : 0
    const maxP95Ms = rows.reduce((max, row) => Math.max(max, Number(row.p95Ms || 0)), 0)

    return {
      available: true,
      operationCount: rows.length,
      sampleCount,
      weightedAvgMs: Math.round(weightedAvgMs * 100) / 100,
      maxP95Ms: Math.round(maxP95Ms * 100) / 100,
      p95Ms: Math.round(maxP95Ms * 100) / 100,
      topOperations: rows.slice(0, 5),
    }
  }

  flush() {
    if (!this.enabled) return

    if (this.httpStats.size > 0) {
      const endpoints = [...this.httpStats.entries()]
        .map(([routeKey, stats]) => ({ routeKey, ...buildSummary(stats) }))
        .sort((a, b) => b.p95Ms - a.p95Ms)
        .slice(0, 25)

      logger.info('perf_http_window', {
        flushIntervalMs: FLUSH_INTERVAL_MS,
        endpointCount: endpoints.length,
        endpoints,
      })
    }

    if (this.mongoStats.size > 0) {
      const operations = [...this.mongoStats.entries()]
        .map(([operationKey, stats]) => ({ operationKey, ...buildSummary(stats) }))
        .sort((a, b) => b.p95Ms - a.p95Ms)
        .slice(0, 25)

      logger.info('perf_mongo_window', {
        flushIntervalMs: FLUSH_INTERVAL_MS,
        operationCount: operations.length,
        operations,
      })
    }

    this.httpStats.clear()
    this.mongoStats.clear()
  }
}

export const performanceMetrics = new PerformanceMetrics()
