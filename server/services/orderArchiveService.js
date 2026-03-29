import { logger } from '../utils/logger.js'
import { archiveOldOrders } from './archiveService.js'

let archiveTimer = null
let running = false

export async function runOrderArchiveOnce() {
  const result = await archiveOldOrders()
  return {
    archivedOrders: Number(result?.totalArchived || 0),
    archivedRestaurants: 0,
    skipped: result?.status === 'disabled',
    status: result?.status || 'unknown',
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
      if (!result.skipped && result.archivedOrders > 0) {
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
