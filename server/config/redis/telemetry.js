const redisOpStats = new Map()

export function recordRedisOp(operationName, field) {
  const op = String(operationName || 'unknown')
  if (!redisOpStats.has(op)) {
    redisOpStats.set(op, {
      attempts: 0,
      success: 0,
      fallback: 0,
      errors: 0,
      lastAt: 0,
    })
  }

  const stats = redisOpStats.get(op)
  if (!stats) return
  stats[field] = Number(stats[field] || 0) + 1
  stats.lastAt = Date.now()
}

export function buildRedisTelemetry({ top = 20, configured = false, blockingConfigured = false } = {}) {
  const safeTop = Math.max(1, Number(top || 20))
  const operations = [...redisOpStats.entries()]
    .map(([operation, stats]) => ({
      operation,
      attempts: Number(stats?.attempts || 0),
      success: Number(stats?.success || 0),
      fallback: Number(stats?.fallback || 0),
      errors: Number(stats?.errors || 0),
      lastAt: Number(stats?.lastAt || 0),
    }))
    .sort((a, b) => b.attempts - a.attempts)

  const totals = operations.reduce(
    (acc, row) => ({
      attempts: acc.attempts + row.attempts,
      success: acc.success + row.success,
      fallback: acc.fallback + row.fallback,
      errors: acc.errors + row.errors,
    }),
    { attempts: 0, success: 0, fallback: 0, errors: 0 },
  )

  return {
    configured,
    blockingConfigured,
    totals,
    topOperations: operations.slice(0, safeTop),
  }
}

