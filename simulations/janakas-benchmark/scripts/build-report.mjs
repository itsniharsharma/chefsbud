import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import dotenv from 'dotenv'

dotenv.config()

const outputDir = process.env.BENCH_OUTPUT_DIR || path.resolve('outputs/latest')
const k6SummarySteadyPath = process.env.K6_SUMMARY_STEADY_PATH || path.join(outputDir, 'k6-summary-steady.json')
const k6SummaryPeakPath = process.env.K6_SUMMARY_PEAK_PATH || path.join(outputDir, 'k6-summary-peak.json')
const k6SummaryPath = process.env.K6_SUMMARY_PATH || path.join(outputDir, 'k6-summary.json')
const infraSamplePath = process.env.INFRA_SAMPLE_PATH || path.join(outputDir, 'infra-samples.jsonl')
const pricingPath = path.resolve('config/pricing.json')
const endpointAttributionPath = path.resolve('config/endpoint-attribution.json')

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function readJsonl(filePath) {
  try {
    return fs
      .readFileSync(filePath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

function round(value, digits = 2) {
  const n = Number(value || 0)
  const f = 10 ** digits
  return Math.round((n + Number.EPSILON) * f) / f
}

function bytesToMb(bytes) {
  return round(Number(bytes || 0) / (1024 * 1024), 3)
}

function bytesToGb(bytes) {
  return round(Number(bytes || 0) / (1024 * 1024 * 1024), 4)
}

function getMetric(summary, key, pathValue = 'values') {
  return summary?.metrics?.[key]?.[pathValue] || {}
}

function getMetricCount(summary, key) {
  return Number(getMetric(summary, key).count || 0)
}

function getMetricAvg(summary, key) {
  return Number(getMetric(summary, key).avg || 0)
}

function sumBy(rows = [], selector) {
  return rows.reduce((sum, row) => sum + Number(selector(row) || 0), 0)
}

function pickActiveSummary(steadySummary, peakSummary, fallbackSummary) {
  if (steadySummary?.metrics && Object.keys(steadySummary.metrics).length) {
    return { steadySummary, peakSummary }
  }

  if (fallbackSummary?.metrics && Object.keys(fallbackSummary.metrics).length) {
    return { steadySummary: fallbackSummary, peakSummary: {} }
  }

  return { steadySummary: {}, peakSummary: {} }
}

function computeDbLoad(samples = []) {
  const mongo = samples.filter((s) => s.kind === 'mongo')
  if (mongo.length < 2) {
    return {
      readsTotal: 0,
      writesTotal: 0,
      readsPerSecAvg: 0,
      readsPerSecPeak: 0,
      writesPerSecAvg: 0,
      payload: {},
      mongoWorkingSetBytes: 0,
    }
  }

  const first = mongo[0]
  const last = mongo[mongo.length - 1]

  const readFirst =
    Number(first?.opcounters?.query || 0) +
    Number(first?.opcounters?.getmore || 0) +
    Number(first?.opcounters?.command || 0)
  const readLast =
    Number(last?.opcounters?.query || 0) +
    Number(last?.opcounters?.getmore || 0) +
    Number(last?.opcounters?.command || 0)

  const writeFirst =
    Number(first?.opcounters?.insert || 0) +
    Number(first?.opcounters?.update || 0) +
    Number(first?.opcounters?.delete || 0)
  const writeLast =
    Number(last?.opcounters?.insert || 0) +
    Number(last?.opcounters?.update || 0) +
    Number(last?.opcounters?.delete || 0)

  const readsTotal = Math.max(0, readLast - readFirst)
  const writesTotal = Math.max(0, writeLast - writeFirst)

  const elapsedSec = Math.max(1, (Date.parse(last.ts) - Date.parse(first.ts)) / 1000)
  const readsPerSecAvg = readsTotal / elapsedSec
  const writesPerSecAvg = writesTotal / elapsedSec

  let readsPerSecPeak = 0
  for (let i = 1; i < mongo.length; i += 1) {
    const prev = mongo[i - 1]
    const cur = mongo[i]
    const prevRead =
      Number(prev?.opcounters?.query || 0) +
      Number(prev?.opcounters?.getmore || 0) +
      Number(prev?.opcounters?.command || 0)
    const curRead =
      Number(cur?.opcounters?.query || 0) +
      Number(cur?.opcounters?.getmore || 0) +
      Number(cur?.opcounters?.command || 0)

    const dt = Math.max(1, (Date.parse(cur.ts) - Date.parse(prev.ts)) / 1000)
    readsPerSecPeak = Math.max(readsPerSecPeak, (curRead - prevRead) / dt)
  }

  return {
    readsTotal,
    writesTotal,
    readsPerSecAvg,
    readsPerSecPeak,
    writesPerSecAvg,
    mongoWorkingSetBytes: Number(last?.wiredTigerCacheBytes || 0),
    mongoResidentMb: Number(last?.residentMb || 0),
    mongoDataSizeBytes: Number(last?.dataSizeBytes || 0),
    mongoStorageSizeBytes: Number(last?.storageSizeBytes || 0),
  }
}

function computeMemory(samples = []) {
  const redis = samples.filter((s) => s.kind === 'redis')
  const node = samples.filter((s) => s.kind === 'node')

  const redisMax = redis.reduce((max, row) => Math.max(max, Number(row.usedMemoryBytes || 0)), 0)
  const nodeMax = node.reduce((max, row) => Math.max(max, Number(row.memoryBytes || 0)), 0)
  const nodeCpuPeak = node.reduce((max, row) => Math.max(max, Number(row.cpuPercent || 0)), 0)
  const nodeCpuAvg = node.length > 0 ? sumBy(node, (row) => row.cpuPercent) / node.length : 0
  const nodeAvg =
    node.length > 0
      ? node.reduce((sum, row) => sum + Number(row.memoryBytes || 0), 0) / node.length
      : 0

  const redisHitsFirst = Number(redis[0]?.keyspaceHits || 0)
  const redisHitsLast = Number(redis[redis.length - 1]?.keyspaceHits || 0)
  const redisMissFirst = Number(redis[0]?.keyspaceMisses || 0)
  const redisMissLast = Number(redis[redis.length - 1]?.keyspaceMisses || 0)

  const redisHitsDelta = Math.max(0, redisHitsLast - redisHitsFirst)
  const redisMissDelta = Math.max(0, redisMissLast - redisMissFirst)
  const redisLookupTotal = redisHitsDelta + redisMissDelta
  const redisHitRate = redisLookupTotal > 0 ? redisHitsDelta / redisLookupTotal : 0

  return {
    redisMaxBytes: redisMax,
    nodeMaxBytes: nodeMax,
    nodeAvgBytes: nodeAvg,
    nodeCpuPeak,
    nodeCpuAvg,
    redisHitsDelta,
    redisMissDelta,
    redisHitRate,
  }
}

function normalizeEndpointRows({ summary, attribution, mode, fallbackHitRate }) {
  const endpointEntries = Object.entries(attribution?.endpoints || {})
  return endpointEntries.map(([endpointId, meta]) => {
    const reqCount = getMetricCount(summary, `ep_${endpointId}_req_count`)
    const reqBytes = getMetricCount(summary, `ep_${endpointId}_req_bytes`)
    const resBytes = getMetricCount(summary, `ep_${endpointId}_res_bytes`)
    const docBytes = getMetricCount(summary, `ep_${endpointId}_mongo_doc_bytes_approx`)
    const cacheHitCount = getMetricCount(summary, `ep_${endpointId}_cache_hit`)
    const cacheMissCount = getMetricCount(summary, `ep_${endpointId}_cache_miss`)
    const cacheTotal = cacheHitCount + cacheMissCount
    const measuredHitRate = cacheTotal > 0 ? cacheHitCount / cacheTotal : null
    const effectiveHitRate = meta.cacheable ? (measuredHitRate ?? fallbackHitRate) : 0

    return {
      mode,
      endpointId,
      label: String(meta?.label || endpointId),
      cacheable: Boolean(meta?.cacheable),
      computeWeight: Number(meta?.computeWeight || 1),
      reqCount,
      requestBytesTotal: reqBytes,
      responseBytesTotal: resBytes,
      mongoDocBytesTotalApprox: docBytes,
      avgRequestBytes: reqCount > 0 ? reqBytes / reqCount : 0,
      avgResponseBytes: reqCount > 0 ? resBytes / reqCount : 0,
      avgMongoDocBytesApprox: reqCount > 0 ? docBytes / reqCount : 0,
      cacheHits: cacheHitCount,
      cacheMisses: cacheMissCount,
      cacheHitRate: effectiveHitRate,
      estimatedReadsPerRequestBase: Number(meta?.estimatedReadsPerRequest || 0),
      estimatedWritesPerRequestBase: Number(meta?.estimatedWritesPerRequest || 0),
    }
  })
}

function calibrateEndpointOps(rows, actualReads, actualWrites) {
  const rawReadTotal = sumBy(rows, (row) => row.reqCount * row.estimatedReadsPerRequestBase * (1 - row.cacheHitRate))
  const rawWriteTotal = sumBy(rows, (row) => row.reqCount * row.estimatedWritesPerRequestBase)

  const readScale = rawReadTotal > 0 ? actualReads / rawReadTotal : 1
  const writeScale = rawWriteTotal > 0 ? actualWrites / rawWriteTotal : 1

  return rows.map((row) => {
    const rawReads = row.reqCount * row.estimatedReadsPerRequestBase * (1 - row.cacheHitRate)
    const rawWrites = row.reqCount * row.estimatedWritesPerRequestBase
    const readsTotal = rawReads * readScale
    const writesTotal = rawWrites * writeScale
    const readsPerRequest = row.reqCount > 0 ? readsTotal / row.reqCount : 0
    const writesPerRequest = row.reqCount > 0 ? writesTotal / row.reqCount : 0
    const avoidedReads = row.reqCount * row.estimatedReadsPerRequestBase * row.cacheHitRate * readScale

    return {
      ...row,
      readsTotal,
      writesTotal,
      readsPerRequest,
      writesPerRequest,
      avoidedReads,
    }
  })
}

function estimateEndpointCosts({ rows, pricing }) {
  const p = pricing.assumptions
  const readUnit = Number(p.mongoReadUsdPerMillion || 0) / 1_000_000
  const writeUnit = Number(p.mongoWriteUsdPerMillion || 0) / 1_000_000
  const redisUnit = Number(p.redisOpUsdPerMillion || 0) / 1_000_000
  const networkUnit = Number(p.mongoNetworkEgressUsdPerGb || 0) / (1024 * 1024 * 1024)
  const computeUnit = Number(p.backendRequestUsdPerMillion || 0) / 1_000_000
  const days = Math.max(1, Number(p.daysPerMonth || 30))
  const baseComputePerDay =
    (Number(p.backendInstanceUsdPerMonth || 0) * Number(p.backendInstancesPerRestaurant || 1)) / days

  const weightTotal = Math.max(1, sumBy(rows, (row) => row.reqCount * row.computeWeight))

  return rows.map((row) => {
    const redisOps = row.cacheHits
    const networkCost = row.responseBytesTotal * networkUnit
    const mongoCost = row.readsTotal * readUnit + row.writesTotal * writeUnit
    const redisCost = redisOps * redisUnit
    const computeCostDirect = row.reqCount * computeUnit
    const weightedComputeBase = ((row.reqCount * row.computeWeight) / weightTotal) * baseComputePerDay
    const computeCost = computeCostDirect + weightedComputeBase
    const totalCost = mongoCost + redisCost + networkCost + computeCost

    return {
      ...row,
      redisOps,
      mongoCost,
      redisCost,
      networkCost,
      computeCost,
      totalCost,
    }
  })
}

function estimateCost({
  pricing,
  dailyReads,
  dailyWrites,
  dailyNetworkGb,
  mongoStorageGb,
  redisMemoryGb,
  backendInstancesPerRestaurant,
  scale,
}) {
  const p = pricing.assumptions
  const monthlyReads = dailyReads * p.daysPerMonth
  const monthlyWrites = dailyWrites * p.daysPerMonth
  const monthlyEgressGb = dailyNetworkGb * p.daysPerMonth

  const mongoVariable =
    (monthlyReads / 1_000_000) * p.mongoReadUsdPerMillion +
    (monthlyWrites / 1_000_000) * p.mongoWriteUsdPerMillion +
    mongoStorageGb * p.mongoStorageUsdPerGbMonth +
    monthlyEgressGb * p.mongoNetworkEgressUsdPerGb

  const mongoTotal = p.mongoBaseClusterUsdPerMonth + mongoVariable
  const redisTotal = p.redisBaseUsdPerMonth + redisMemoryGb * p.redisMemoryUsdPerGbMonth
  const backendTotal = p.backendInstanceUsdPerMonth * backendInstancesPerRestaurant

  const perRestaurant = mongoTotal + redisTotal + backendTotal
  return {
    perRestaurant: round(perRestaurant, 2),
    total: round(perRestaurant * scale, 2),
  }
}

function bottlenecks({ p95, p99, errorRate, readsPerSecPeak }) {
  const notes = []
  if (p95 > 1500) notes.push('API p95 latency above 1.5s: optimize query paths and cache hit ratio.')
  if (p99 > 2500) notes.push('API p99 tail latency high: investigate slow endpoints and connection pool saturation.')
  if (errorRate > 0.02) notes.push('Error rate above 2% under load: add retries/circuit guards for hot endpoints.')
  if (readsPerSecPeak > 120) notes.push('Mongo read peak is high for mid-busy profile: improve cache TTL and payload trimming.')
  if (!notes.length) notes.push('No critical bottleneck triggered by configured thresholds in this run.')
  return notes
}

function main() {
  fs.mkdirSync(outputDir, { recursive: true })

  const steadyRaw = readJson(k6SummarySteadyPath, {})
  const peakRaw = readJson(k6SummaryPeakPath, {})
  const fallbackSummary = readJson(k6SummaryPath, {})
  const { steadySummary, peakSummary } = pickActiveSummary(steadyRaw, peakRaw, fallbackSummary)
  const samples = readJsonl(infraSamplePath)
  const pricing = readJson(pricingPath, readJson(path.resolve('config/pricing.json'), {}))
  const attribution = readJson(endpointAttributionPath, {})

  const steadyDuration = getMetric(steadySummary, 'http_req_duration')
  const peakDuration = getMetric(peakSummary, 'http_req_duration')
  const steadyFailed = getMetric(steadySummary, 'http_req_failed')
  const peakFailed = getMetric(peakSummary, 'http_req_failed')
  const steadyReqs = getMetric(steadySummary, 'http_reqs')
  const peakReqs = getMetric(peakSummary, 'http_reqs')
  const steadySent = getMetric(steadySummary, 'data_sent')
  const peakSent = getMetric(peakSummary, 'data_sent')
  const steadyReceived = getMetric(steadySummary, 'data_received')
  const peakReceived = getMetric(peakSummary, 'data_received')

  const db = computeDbLoad(samples)
  const memory = computeMemory(samples)

  const totalRequests = Number(steadyReqs.count || 0) + Number(peakReqs.count || 0)
  const totalSentBytes = Number(steadySent.count || 0) + Number(peakSent.count || 0)
  const totalReceivedBytes = Number(steadyReceived.count || 0) + Number(peakReceived.count || 0)
  const payloadAvgBytes = totalRequests > 0 ? (totalSentBytes + totalReceivedBytes) / totalRequests : 0

  const redisObservedHitRate = memory.redisHitRate
  const endpointRowsSteady = normalizeEndpointRows({
    summary: steadySummary,
    attribution,
    mode: 'steady',
    fallbackHitRate: redisObservedHitRate,
  })
  const endpointRowsPeak = normalizeEndpointRows({
    summary: peakSummary,
    attribution,
    mode: 'peak',
    fallbackHitRate: redisObservedHitRate,
  })
  const endpointRowsRaw = [...endpointRowsSteady, ...endpointRowsPeak]
  const endpointRows = calibrateEndpointOps(endpointRowsRaw, db.readsTotal, db.writesTotal)

  const dailyReads = db.readsTotal
  const dailyWrites = db.writesTotal
  const dailyTransferGb = bytesToGb(totalSentBytes + totalReceivedBytes)

  const mongoStorageGb = bytesToGb(db.mongoStorageSizeBytes || db.mongoDataSizeBytes)
  const redisMemoryGb = bytesToGb(memory.redisMaxBytes)
  const backendInstancesPerRestaurant = Number(pricing?.assumptions?.backendInstancesPerRestaurant || 1)
  const endpointRowsWithCost = estimateEndpointCosts({ rows: endpointRows, pricing })

  const ordersPlaced = getMetricCount(steadySummary, 'orders_placed') + getMetricCount(peakSummary, 'orders_placed')
  const safeOrdersPlaced = Math.max(1, ordersPlaced)
  const totalMongoCostPerDay = sumBy(endpointRowsWithCost, (row) => row.mongoCost)
  const totalRedisCostPerDay = sumBy(endpointRowsWithCost, (row) => row.redisCost)
  const totalComputeCostPerDay = sumBy(endpointRowsWithCost, (row) => row.computeCost)
  const totalNetworkCostPerDay = sumBy(endpointRowsWithCost, (row) => row.networkCost)
  const totalCostPerDay = totalMongoCostPerDay + totalRedisCostPerDay + totalComputeCostPerDay + totalNetworkCostPerDay

  const cacheableReadsTotal = sumBy(endpointRowsWithCost.filter((row) => row.cacheable), (row) => row.readsTotal + row.avoidedReads)
  const avoidedReadsTotal = sumBy(endpointRowsWithCost.filter((row) => row.cacheable), (row) => row.avoidedReads)
  const mongoLoadReductionPct = cacheableReadsTotal > 0 ? (avoidedReadsTotal / cacheableReadsTotal) * 100 : 0

  const topExpensiveEndpoints = [...endpointRowsWithCost]
    .sort((a, b) => Number(b.totalCost || 0) - Number(a.totalCost || 0))
    .slice(0, 3)

  const dominantCost = [
    { type: 'DB', value: totalMongoCostPerDay },
    { type: 'CPU/Compute', value: totalComputeCostPerDay },
    { type: 'Network', value: totalNetworkCostPerDay },
  ].sort((a, b) => b.value - a.value)[0]

  const rankedOptimizations = [
    {
      impactScore: round((sumBy(endpointRowsWithCost.filter((row) => row.endpointId === 'track_table' || row.endpointId === 'track_order'), (row) => row.totalCost) / Math.max(totalCostPerDay, 0.000001)) * 100, 1),
      suggestion: 'Reduce polling cost: increase polling interval adaptively after order reaches stable states.',
    },
    {
      impactScore: round((sumBy(endpointRowsWithCost.filter((row) => row.endpointId === 'menu_fetch'), (row) => row.totalCost) / Math.max(totalCostPerDay, 0.000001)) * 100, 1),
      suggestion: 'Increase menu cache efficiency and reduce menu payload fields for customer flow.',
    },
    {
      impactScore: round((sumBy(endpointRowsWithCost.filter((row) => row.endpointId === 'create_order'), (row) => row.totalCost) / Math.max(totalCostPerDay, 0.000001)) * 100, 1),
      suggestion: 'Optimize order creation query path and indexing for order writes and stock side effects.',
    },
  ].sort((a, b) => Number(b.impactScore || 0) - Number(a.impactScore || 0))

  const cost1 = estimateCost({
    pricing,
    dailyReads,
    dailyWrites,
    dailyNetworkGb: dailyTransferGb,
    mongoStorageGb,
    redisMemoryGb,
    backendInstancesPerRestaurant,
    scale: 1,
  })
  const cost10 = estimateCost({
    pricing,
    dailyReads,
    dailyWrites,
    dailyNetworkGb: dailyTransferGb,
    mongoStorageGb,
    redisMemoryGb,
    backendInstancesPerRestaurant,
    scale: 10,
  })
  const cost50 = estimateCost({
    pricing,
    dailyReads,
    dailyWrites,
    dailyNetworkGb: dailyTransferGb,
    mongoStorageGb,
    redisMemoryGb,
    backendInstancesPerRestaurant,
    scale: 50,
  })

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      k6SummarySteadyPath,
      k6SummaryPeakPath,
      fallbackK6SummaryPath: k6SummaryPath,
      infraSamplePath,
    },
    apiPerformance: {
      steady: {
        averageMs: round(steadyDuration.avg || 0, 2),
        p95Ms: round(steadyDuration['p(95)'] || 0, 2),
        p99Ms: round(steadyDuration['p(99)'] || 0, 2),
        errorRate: round(Number(steadyFailed.rate || 0), 4),
        requestCount: Number(steadyReqs.count || 0),
      },
      peak: {
        averageMs: round(peakDuration.avg || 0, 2),
        p95Ms: round(peakDuration['p(95)'] || 0, 2),
        p99Ms: round(peakDuration['p(99)'] || 0, 2),
        errorRate: round(Number(peakFailed.rate || 0), 4),
        requestCount: Number(peakReqs.count || 0),
      },
      combinedRequestCount: totalRequests,
    },
    databaseLoad: {
      readsPerDay: Math.round(db.readsTotal),
      readsPerSecAverage: round(db.readsPerSecAvg, 2),
      readsPerSecPeak: round(db.readsPerSecPeak, 2),
      writesPerDay: Math.round(db.writesTotal),
      writesPerSecAverage: round(db.writesPerSecAvg, 2),
      payloadSizeAvgBytes: round(payloadAvgBytes, 2),
      totalDataTransferredMb: bytesToMb(totalSentBytes + totalReceivedBytes),
      totalDataTransferredGb: dailyTransferGb,
    },
    memoryUsage: {
      nodeAverageMb: bytesToMb(memory.nodeAvgBytes),
      nodePeakMb: bytesToMb(memory.nodeMaxBytes),
      nodeCpuAvgPercent: round(memory.nodeCpuAvg, 2),
      nodeCpuPeakPercent: round(memory.nodeCpuPeak, 2),
      redisPeakMb: bytesToMb(memory.redisMaxBytes),
      mongoWorkingSetMb: bytesToMb(db.mongoWorkingSetBytes),
      mongoResidentMb: round(db.mongoResidentMb, 2),
    },
    redisAnalysis: {
      keyspaceHits: memory.redisHitsDelta,
      keyspaceMisses: memory.redisMissDelta,
      hitRate: round(memory.redisHitRate, 4),
      missRate: round(memory.redisHitsDelta + memory.redisMissDelta > 0 ? 1 - memory.redisHitRate : 0, 4),
      estimatedMongoLoadReducedPercent: round(mongoLoadReductionPct, 2),
    },
    endpointAnalysis: endpointRowsWithCost
      .map((row) => ({
        mode: row.mode,
        endpointId: row.endpointId,
        endpointLabel: row.label,
        requests: row.reqCount,
        readsPerRequest: round(row.readsPerRequest, 4),
        writesPerRequest: round(row.writesPerRequest, 4),
        averageRequestPayloadBytes: round(row.avgRequestBytes, 2),
        averageResponsePayloadBytes: round(row.avgResponseBytes, 2),
        averageMongoDocumentBytesApprox: round(row.avgMongoDocBytesApprox, 2),
        cacheHitRate: round(row.cacheHitRate, 4),
        readsTotal: round(row.readsTotal, 2),
        writesTotal: round(row.writesTotal, 2),
        dayCostUsd: round(row.totalCost, 6),
      }))
      .sort((a, b) => Number(b.dayCostUsd || 0) - Number(a.dayCostUsd || 0)),
    perOrderModel: {
      ordersPlaced,
      readsPerOrder: round(dailyReads / safeOrdersPlaced, 3),
      writesPerOrder: round(dailyWrites / safeOrdersPlaced, 3),
      dataTransferMbPerOrder: round(bytesToMb(totalSentBytes + totalReceivedBytes) / safeOrdersPlaced, 4),
      costPerOrderUsd: {
        mongo: round(totalMongoCostPerDay / safeOrdersPlaced, 6),
        redis: round(totalRedisCostPerDay / safeOrdersPlaced, 6),
        compute: round(totalComputeCostPerDay / safeOrdersPlaced, 6),
        network: round(totalNetworkCostPerDay / safeOrdersPlaced, 6),
        total: round(totalCostPerDay / safeOrdersPlaced, 6),
      },
    },
    estimatedCostBreakdownUsd: {
      perDay: {
        mongo: round(totalMongoCostPerDay, 4),
        redis: round(totalRedisCostPerDay, 4),
        compute: round(totalComputeCostPerDay, 4),
        network: round(totalNetworkCostPerDay, 4),
        total: round(totalCostPerDay, 4),
      },
      perMonth: {
        mongo: round(totalMongoCostPerDay * Number(pricing?.assumptions?.daysPerMonth || 30), 2),
        redis: round(totalRedisCostPerDay * Number(pricing?.assumptions?.daysPerMonth || 30), 2),
        compute: round(totalComputeCostPerDay * Number(pricing?.assumptions?.daysPerMonth || 30), 2),
        network: round(totalNetworkCostPerDay * Number(pricing?.assumptions?.daysPerMonth || 30), 2),
        total: round(totalCostPerDay * Number(pricing?.assumptions?.daysPerMonth || 30), 2),
      },
    },
    estimatedMonthlyCostUsd: {
      oneRestaurant: cost1.perRestaurant,
      tenRestaurants: cost10.total,
      fiftyRestaurants: cost50.total,
    },
    topExpensiveEndpoints: topExpensiveEndpoints.map((row) => ({
      endpoint: row.label,
      mode: row.mode,
      dayCostUsd: round(row.totalCost, 6),
      requests: row.reqCount,
    })),
    dominantBottleneck: dominantCost?.type || 'DB',
    bottlenecks: bottlenecks({
      p95: Math.max(Number(steadyDuration['p(95)'] || 0), Number(peakDuration['p(95)'] || 0)),
      p99: Math.max(Number(steadyDuration['p(99)'] || 0), Number(peakDuration['p(99)'] || 0)),
      errorRate: Math.max(Number(steadyFailed.rate || 0), Number(peakFailed.rate || 0)),
      readsPerSecPeak: Number(db.readsPerSecPeak || 0),
    }),
    optimizationSuggestionsRanked: rankedOptimizations,
  }

  const reportPath = path.join(outputDir, 'benchmark-report.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

  const mdPath = path.join(outputDir, 'SUMMARY_REPORT.md')
  const endpointRowsMd = report.endpointAnalysis
    .slice(0, 12)
    .map(
      (row) =>
        `| ${row.mode} | ${row.endpointLabel} | ${row.requests} | ${row.readsPerRequest} | ${row.writesPerRequest} | ${row.averageResponsePayloadBytes} | ${round(row.cacheHitRate * 100, 2)}% | ${row.dayCostUsd} |`,
    )
    .join('\n')

  const topExpensiveMd = report.topExpensiveEndpoints
    .map((row) => `- ${row.endpoint} (${row.mode}) -> $${row.dayCostUsd}/day`)
    .join('\n')

  const optimizationsMd = report.optimizationSuggestionsRanked
    .map((row, index) => `${index + 1}. [Impact ${row.impactScore}%] ${row.suggestion}`)
    .join('\n')

  const md = `# Janakas Benchmark Summary\n\nGenerated: ${report.generatedAt}\n\n## Concurrency Modeling\n- Steady traffic (normal): ${report.apiPerformance.steady.requestCount} requests, p95 ${report.apiPerformance.steady.p95Ms} ms, error ${(report.apiPerformance.steady.errorRate * 100).toFixed(2)}%\n- Peak traffic (50-100 concurrent target): ${report.apiPerformance.peak.requestCount} requests, p95 ${report.apiPerformance.peak.p95Ms} ms, error ${(report.apiPerformance.peak.errorRate * 100).toFixed(2)}%\n\n## Database Load (MongoDB)\n- Reads/day: ${report.databaseLoad.readsPerDay}\n- Reads/sec avg: ${report.databaseLoad.readsPerSecAverage}\n- Reads/sec peak: ${report.databaseLoad.readsPerSecPeak}\n- Writes/day: ${report.databaseLoad.writesPerDay}\n- Writes/sec avg: ${report.databaseLoad.writesPerSecAverage}\n- Avg payload/request: ${report.databaseLoad.payloadSizeAvgBytes} bytes\n- Total transfer/day: ${report.databaseLoad.totalDataTransferredMb} MB (${report.databaseLoad.totalDataTransferredGb} GB)\n\n## Redis Cache Analysis\n- Hit rate: ${(report.redisAnalysis.hitRate * 100).toFixed(2)}%\n- Miss rate: ${(report.redisAnalysis.missRate * 100).toFixed(2)}%\n- Estimated Mongo load reduced by Redis: ${report.redisAnalysis.estimatedMongoLoadReducedPercent}%\n\n## Per Endpoint Analysis\n| Mode | Endpoint | Requests | Reads/req | Writes/req | Avg response bytes | Cache hit | Day cost (USD) |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${endpointRowsMd}\n\n## Per Order Cost Model\n- Orders placed: ${report.perOrderModel.ordersPlaced}\n- Reads/order: ${report.perOrderModel.readsPerOrder}\n- Writes/order: ${report.perOrderModel.writesPerOrder}\n- Data transfer/order: ${report.perOrderModel.dataTransferMbPerOrder} MB\n- Cost/order: $${report.perOrderModel.costPerOrderUsd.total} (Mongo $${report.perOrderModel.costPerOrderUsd.mongo}, Redis $${report.perOrderModel.costPerOrderUsd.redis}, Compute $${report.perOrderModel.costPerOrderUsd.compute}, Network $${report.perOrderModel.costPerOrderUsd.network})\n\n## Cost Breakdown\n- Cost/day: $${report.estimatedCostBreakdownUsd.perDay.total}\n- Cost/month: $${report.estimatedCostBreakdownUsd.perMonth.total}\n- 1 restaurant/month: $${report.estimatedMonthlyCostUsd.oneRestaurant}\n- 10 restaurants/month: $${report.estimatedMonthlyCostUsd.tenRestaurants}\n- 50 restaurants/month: $${report.estimatedMonthlyCostUsd.fiftyRestaurants}\n\n## Top 3 Most Expensive Endpoints\n${topExpensiveMd}\n\n## Bottleneck\n- Dominant bottleneck: ${report.dominantBottleneck}\n${report.bottlenecks.map((x) => `- ${x}`).join('\n')}\n\n## Optimization Suggestions (Ranked)\n${optimizationsMd}\n`

  fs.writeFileSync(mdPath, md)

  console.log(`Report generated:\n- ${reportPath}\n- ${mdPath}`)
}

main()
