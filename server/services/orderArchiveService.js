import { logger } from '../utils/logger.js'
import { archiveOldOrders, purgeArchivedOrders } from './archiveService.js'

let archiveTimer = null
let running = false
let lastPurgeAtMs = 0

function shouldRunPurgeNow() {
  const purgeIntervalMinutes = Number(process.env.PURGE_INTERVAL_MINUTES || 360)
  const safeIntervalMs = (Number.isFinite(purgeIntervalMinutes) && purgeIntervalMinutes > 0 ? purgeIntervalMinutes : 360) * 60 * 1000
  const now = Date.now()
  if (now - lastPurgeAtMs < safeIntervalMs) {
    return false
  }
  lastPurgeAtMs = now
  return true
}

export async function runOrderArchiveOnce() {
  const archiveResult = await archiveOldOrders()
  const purgeResult = shouldRunPurgeNow()
    ? await purgeArchivedOrders()
    : { status: 'skipped_interval', totalDeleted: 0 }

  return {
    archivedOrders: Number(archiveResult?.totalArchived || 0),
    purgedOrders: Number(purgeResult?.totalDeleted || 0),
    archivedRestaurants: 0,
    skipped: archiveResult?.status === 'disabled' && purgeResult?.status === 'disabled',
    status: archiveResult?.status || 'unknown',
    purgeStatus: purgeResult?.status || 'unknown',
  }
}

export function startOrderArchiveScheduler() {
  const enabled = String(process.env.ORDER_ARCHIVE_ENABLED || process.env.ARCHIVE_ENABLED || 'true').trim().toLowerCase() !== 'false'
  if (!enabled) {
    logger.info('Order archive scheduler disabled by environment')
    return
  }

  const processRole = String(process.env.PROCESS_ROLE || 'all').trim().toLowerCase()
  if (!['all', 'worker', 'jobs'].includes(processRole)) {
    logger.info('Order archive scheduler skipped for process role', { processRole })
    return
  }

  const intervalMinutes = Number(process.env.ORDER_ARCHIVE_INTERVAL_MINUTES || 60)
  const safeMinutes = Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 60
  const intervalMs = safeMinutes * 60 * 1000

  const tick = async () => {
    if (running) return
    running = true
    try {
      const result = await runOrderArchiveOnce()
      if (!result.skipped && (result.archivedOrders > 0 || result.purgedOrders > 0)) {
        logger.info('Order archive cycle complete', result)
      }
    } catch (error) {
      logger.error('Order archive cycle failed', { error: String(error?.message || error) })
    } finally {
      running = false
    }
  }

  archiveTimer = setInterval(tick, intervalMs)
  archiveTimer.unref?.()

  // Kick one cycle shortly after startup.
  setTimeout(() => {
    void tick()
  }, 5000).unref?.()

  logger.info('Order archive scheduler started', { intervalMinutes: safeMinutes, processRole })
}

export function stopOrderArchiveScheduler() {
  if (!archiveTimer) return
  clearInterval(archiveTimer)
  archiveTimer = null
}
