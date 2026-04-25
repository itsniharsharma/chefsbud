/**
 * Data Lifecycle Scheduler
 * Orchestrates all background jobs for data lifecycle management:
 * - Order archival (daily)
 * - Analytics rollup (daily)
 * - Cleanup of expired/old data (periodic)
 *
 * Uses node-cron for scheduling
 * Features:
 * - Leader election for multi-instance deployments
 * - Comprehensive logging and monitoring
 * - Graceful error handling
 * - Job execution tracking
 */

import cron from 'node-cron'
import { logger } from '../utils/logger.js'
import config from '../config/dataLifecycle.js'
import { archiveOldOrders, purgeArchivedOrders } from './archiveService.js'
import { rollupAllAnalytics } from './analyticsRollupService.js'
import { runInventoryLedgerLifecycleCycle } from './inventoryLedgerLifecycleService.js'
import { getRedisClient } from '../config/redis.js'
import OrderHourlyMetrics from '../models/OrderHourlyMetrics.js'
import Order from '../models/Order.js'
import InventoryReservation from '../models/InventoryReservation.js'
import InventoryMonthlySummary from '../models/InventoryMonthlySummary.js'
import AnalyticsDailyMetrics from '../models/AnalyticsDailyMetrics.js'
import AnalyticsMonthlyMetrics from '../models/AnalyticsMonthlyMetrics.js'
import AnalyticsBasketPairDaily from '../models/AnalyticsBasketPairDaily.js'
import AnalyticsBasketPairMonthly from '../models/AnalyticsBasketPairMonthly.js'
import AnalyticsItemDailyMetrics from '../models/AnalyticsItemDailyMetrics.js'
import AnalyticsItemMonthlyMetrics from '../models/AnalyticsItemMonthlyMetrics.js'
import { listEnabledRestaurantIdsForFeature } from './restaurantFeatureFlags.js'

const JOB_LOCK_PREFIX = 'data-lifecycle:job-lock'
const JOB_LOCK_TTL = Math.max(120, Number(process.env.LIFECYCLE_JOB_LOCK_TTL_SECONDS || 900))
const LOCK_OWNER_ID = `${process.pid}:${Date.now()}`

// Job tracking
let activeJobs = {}
let jobHistory = []
const runningJobs = new Set()

/**
 * Acquire per-job lock across cluster.
 * Prevents duplicate/overlapping execution across instances.
 * Phase 1: Implements Redis fallback policy
 *  - Single-instance (PROCESS_ROLE='all'|'jobs') → degraded mode
 *  - Multi-instance without Redis → FAIL
 */
const acquireJobLock = async (jobName) => {
  const lockKey = `${JOB_LOCK_PREFIX}:${jobName}`
  const client = getRedisClient()
  
  // Redis is available, use it
  if (client) {
    try {
      const lockAcquired = await client.set(lockKey, LOCK_OWNER_ID, {
        ex: JOB_LOCK_TTL,
        nx: true,
      })
      return lockAcquired === 'OK'
    } catch (error) {
      logger.warn('Failed to acquire lifecycle job lock', {
        jobName,
        lockKey,
        error: error.message,
      })
      return false
    }
  }

  // Phase 1: Redis unavailable, implement degraded mode
  const processRole = String(process.env.PROCESS_ROLE || 'all').toLowerCase().trim()
  
  if (processRole === 'all' || processRole === 'jobs') {
    // Single-instance deployment → allow degraded execution
    logger.warn('DEGRADED MODE: Redis lock unavailable on single-process deployment. Proceeding without distributed lock.', {
      jobName,
      processRole,
    })
    // Emit metric for alerting
    logger.info('lifecycle_lock_degraded_mode', { jobName, processRole })
    return { acquired: true, mode: 'degraded' }
  }

  // Multi-instance deployment without Redis → FAIL
  logger.error('CRITICAL: Redis lock unavailable in multi-instance deployment', {
    jobName,
    processRole,
  })
  logger.info('lifecycle_lock_failed', { jobName, processRole })
  return false
}

const releaseJobLock = async (jobName) => {
  const lockKey = `${JOB_LOCK_PREFIX}:${jobName}`
  const client = getRedisClient()
  if (!client) return

  try {
    const currentOwner = await client.get(lockKey)
    if (currentOwner === LOCK_OWNER_ID) {
      await client.del(lockKey)
    }
  } catch (error) {
    logger.warn('Failed to release lifecycle job lock', {
      jobName,
      lockKey,
      error: error.message,
    })
  }
}

const beginJob = async (jobName, jobId) => {
  if (runningJobs.has(jobName)) {
    logger.warn('Lifecycle job overlap prevented (local)', { jobName })
    return false
  }

  const lockResult = await acquireJobLock(jobName)
  
  // Phase 1: Handle degraded mode or lock failure
  if (lockResult === false) {
    logger.debug('Lifecycle job lock held by another instance or unavailable', { jobName })
    return false
  }
  
  // lockResult can be true (classic) or { acquired: true, mode: 'degraded' }
  const lockAcquired = lockResult === true || (typeof lockResult === 'object' && lockResult.acquired === true)
  
  if (!lockAcquired) {
    return false
  }

  runningJobs.add(jobName)
  activeJobs[jobId] = { startTime: Date.now(), name: jobName }
  return true
}

const endJob = async (jobName, jobId) => {
  runningJobs.delete(jobName)
  delete activeJobs[jobId]
  await releaseJobLock(jobName)
}

const logLifecycleHealth = async (sourceJob) => {
  try {
    const now = new Date()
    const staleArchiveCutoff = new Date(now)
    staleArchiveCutoff.setDate(staleArchiveCutoff.getDate() - Math.max(0, Number(config.purge.deleteAfterArchiveDays || 0)))

    const [staleArchivedOrders, activeReservationBacklog, monthlyPopulation, inventoryMonthlySummaryCount] = await Promise.all([
      Order.countDocuments({
        isArchived: true,
        archivedAt: { $exists: true, $lte: staleArchiveCutoff },
        archiveKey: { $exists: true, $ne: '' },
        orderStatus: 'Completed',
      }),
      InventoryReservation.countDocuments({
        status: 'active',
        expiresAt: { $exists: true, $lt: now },
      }),
      Promise.all([
        AnalyticsMonthlyMetrics.countDocuments({}),
        AnalyticsItemMonthlyMetrics.countDocuments({}),
        AnalyticsBasketPairMonthly.countDocuments({}),
      ]),
      InventoryMonthlySummary.countDocuments({}),
    ])

    logger.info('lifecycle_health_snapshot', {
      sourceJob,
      staleArchivedOrders,
      reservationTtlBacklog: activeReservationBacklog,
      monthlyAnalyticsPopulation: {
        daily: monthlyPopulation[0],
        item: monthlyPopulation[1],
        pair: monthlyPopulation[2],
      },
      inventoryMonthlySummaryCount,
    })
  } catch (error) {
    logger.warn('lifecycle_health_snapshot_failed', {
      sourceJob,
      error: error.message,
    })
  }
}

/**
 * Archive job
 * Moves orders older than ARCHIVE_AFTER_DAYS to Azure Blob Storage
 */
const archiveJob = async () => {
  const jobId = `archive_${Date.now()}`
  let started = false
  
  try {
    const canRun = await beginJob('archive', jobId)
    if (!canRun) {
      return
    }
    started = true

    logger.info('Archive job started')
    const result = await archiveOldOrders()
    
    activeJobs[jobId].endTime = Date.now()
    activeJobs[jobId].result = result
    
    logger.info('Archive job completed', {
      status: result.status,
      processed: result.totalProcessed,
      duration: result.duration,
    })
    
    jobHistory.push({ ...activeJobs[jobId], timestamp: new Date() })
    await logLifecycleHealth('archive')
  } catch (error) {
    logger.error('Archive job failed', {
      error: error.message,
      jobId,
    })
    
    activeJobs[jobId] = activeJobs[jobId] || {}
    activeJobs[jobId].error = error.message
    activeJobs[jobId].failed = true
  } finally {
    if (started) {
      await endJob('archive', jobId)
    }
  }
}

/**
 * Purge job
 * Deletes safely-archived orders after retention window.
 */
const purgeJob = async () => {
  const jobId = `purge_${Date.now()}`
  let started = false

  try {
    const canRun = await beginJob('purge', jobId)
    if (!canRun) {
      return
    }
    started = true

    logger.info('Purge job started')
    const result = await purgeArchivedOrders()

    activeJobs[jobId].endTime = Date.now()
    activeJobs[jobId].result = result

    logger.info('Purge job completed', {
      status: result.status,
      totalDeleted: result.totalDeleted,
      duration: result.duration,
      dryRun: result.dryRun,
    })

    jobHistory.push({ ...activeJobs[jobId], timestamp: new Date() })
    await logLifecycleHealth('purge')
  } catch (error) {
    logger.error('Purge job failed', {
      error: error.message,
      jobId,
    })

    activeJobs[jobId] = activeJobs[jobId] || {}
    activeJobs[jobId].error = error.message
    activeJobs[jobId].failed = true
  } finally {
    if (started) {
      await endJob('purge', jobId)
    }
  }
}

/**
 * Rollup job
 * Aggregates daily analytics to monthly and cleans up low-frequency data
 */
const rollupJob = async () => {
  const jobId = `rollup_${Date.now()}`
  let started = false
  
  try {
    const enabledAnalyticsRestaurantIds = await listEnabledRestaurantIdsForFeature('analyticsEnabled')
    if (!enabledAnalyticsRestaurantIds.length) {
      logger.info('Rollup job skipped: no analytics-enabled restaurants')
      return
    }

    const canRun = await beginJob('rollup', jobId)
    if (!canRun) {
      return
    }
    started = true

    logger.info('Rollup job started')
    const result = await rollupAllAnalytics()
    
    activeJobs[jobId].endTime = Date.now()
    activeJobs[jobId].result = result
    
    logger.info('Rollup job completed', {
      allSucceeded: result.allSucceeded,
      totalDuration: result.totalDuration,
      operations: result.operations.length,
    })
    
    jobHistory.push({ ...activeJobs[jobId], timestamp: new Date() })
    await logLifecycleHealth('rollup')
  } catch (error) {
    logger.error('Rollup job failed', {
      error: error.message,
      jobId,
    })
    
    activeJobs[jobId] = activeJobs[jobId] || {}
    activeJobs[jobId].error = error.message
    activeJobs[jobId].failed = true
  } finally {
    if (started) {
      await endJob('rollup', jobId)
    }
  }
}

/**
 * Cleanup job
 * Removes low-frequency analytics data and expired metrics
 */
const cleanupJob = async () => {
  const jobId = `cleanup_${Date.now()}`
  let started = false
  
  try {
    const enabledAnalyticsRestaurantIds = await listEnabledRestaurantIdsForFeature('analyticsEnabled')
    const analyticsEnabledFilter = enabledAnalyticsRestaurantIds.length
      ? { restaurantId: { $in: enabledAnalyticsRestaurantIds } }
      : null

    const canRun = await beginJob('cleanup', jobId)
    if (!canRun) {
      return
    }
    started = true

    logger.info('Cleanup job started')
    
    const results = {
      hourlyMetricsDeleted: 0,
      rolledUpDailyDeleted: 0,
      rolledUpItemDailyDeleted: 0,
      rolledUpPairDailyDeleted: 0,
      basketPairsDeleted: 0,
      itemMetricsOptimized: 0,
      errors: [],
    }
    
    // Clean up old hourly metrics
    if (analyticsEnabledFilter) {
      try {
        const cutoffDate = new Date()
        cutoffDate.setDate(cutoffDate.getDate() - config.cleanup.hourlyMetricsRetention)
        
        const deleted = await OrderHourlyMetrics.deleteMany({
          ...analyticsEnabledFilter,
          date: { $lt: cutoffDate },
        })
        
        results.hourlyMetricsDeleted = deleted.deletedCount
        logger.info('Cleaned up old hourly metrics', { deleted: deleted.deletedCount })
      } catch (error) {
        const msg = `Cleanup of hourly metrics failed: ${error.message}`
        logger.error(msg)
        results.errors.push(msg)
      }
    }

    // Remove rolled-up daily analytics older than configured retention.
    if (config.cleanup.keepRolledUpDaily && analyticsEnabledFilter) {
      try {
        const cutoffDate = new Date()
        cutoffDate.setDate(cutoffDate.getDate() - config.cleanup.keepRolledUpDailyFor)

        const [dailyDeleted, itemDailyDeleted, pairDailyDeleted] = await Promise.all([
          AnalyticsDailyMetrics.deleteMany({
            ...analyticsEnabledFilter,
            rolledUp: true,
            rolledUpAt: { $exists: true, $lte: cutoffDate },
          }),
          AnalyticsItemDailyMetrics.deleteMany({
            ...analyticsEnabledFilter,
            rolledUp: true,
            rolledUpAt: { $exists: true, $lte: cutoffDate },
          }),
          AnalyticsBasketPairDaily.deleteMany({
            ...analyticsEnabledFilter,
            rolledUp: true,
            rolledUpAt: { $exists: true, $lte: cutoffDate },
          }),
        ])

        results.rolledUpDailyDeleted = dailyDeleted.deletedCount
        results.rolledUpItemDailyDeleted = itemDailyDeleted.deletedCount
        results.rolledUpPairDailyDeleted = pairDailyDeleted.deletedCount

        logger.info('Cleaned rolled-up daily analytics', {
          cutoffDate: cutoffDate.toISOString(),
          daily: dailyDeleted.deletedCount,
          itemDaily: itemDailyDeleted.deletedCount,
          pairDaily: pairDailyDeleted.deletedCount,
        })
      } catch (error) {
        const msg = `Cleanup of rolled-up daily analytics failed: ${error.message}`
        logger.error(msg)
        results.errors.push(msg)
      }
    }
    
    // Clean up low-frequency basket pairs (keep only top 100 per day)
    if (analyticsEnabledFilter) {
      try {
        const groupedByDay = await AnalyticsBasketPairDaily.aggregate([
          { $match: analyticsEnabledFilter },
          { $group: { _id: { restaurantId: '$restaurantId', dateKey: '$dateKey' }, count: { $sum: 1 } } },
          { $match: { count: { $gt: 100 } } },
        ])
        
        let totalDeleted = 0
        for (const group of groupedByDay) {
          const toDelete = await AnalyticsBasketPairDaily.find({
            restaurantId: group._id.restaurantId,
            dateKey: group._id.dateKey,
          })
            .sort({ count: 1 })
            .skip(100)
            .lean()
          
          if (toDelete.length > 0) {
            const ids = toDelete.map((d) => d._id)
            const result = await AnalyticsBasketPairDaily.deleteMany({ _id: { $in: ids } })
            totalDeleted += result.deletedCount
          }
        }
        
        results.basketPairsDeleted = totalDeleted
        logger.info('Cleaned up low-frequency basket pairs', { deleted: totalDeleted })
      } catch (error) {
        const msg = `Cleanup of basket pairs failed: ${error.message}`
        logger.error(msg)
        results.errors.push(msg)
      }
    }
    
    // Optimize item metrics (remove zero-row entries)
    if (analyticsEnabledFilter) {
      try {
        const removed = await AnalyticsItemDailyMetrics.deleteMany({
          ...analyticsEnabledFilter,
          $and: [{ views: 0 }, { addToCart: 0 }, { orders: 0 }, { revenue: 0 }],
        })
        
        results.itemMetricsOptimized = removed.deletedCount
        logger.info('Optimized item metrics', { removed: removed.deletedCount })
      } catch (error) {
        const msg = `Optimization of item metrics failed: ${error.message}`
        logger.error(msg)
        results.errors.push(msg)
      }
    }
    
    activeJobs[jobId].endTime = Date.now()
    activeJobs[jobId].result = results
    
    logger.info('Cleanup job completed', results)
    
    jobHistory.push({ ...activeJobs[jobId], timestamp: new Date() })
    await logLifecycleHealth('cleanup')
  } catch (error) {
    logger.error('Cleanup job failed', {
      error: error.message,
      jobId,
    })
    
    activeJobs[jobId] = activeJobs[jobId] || {}
    activeJobs[jobId].error = error.message
    activeJobs[jobId].failed = true
  } finally {
    if (started) {
      await endJob('cleanup', jobId)
    }
  }
}

const inventoryLifecycleJob = async () => {
  const jobId = `inventory_lifecycle_${Date.now()}`
  let started = false

  try {
    const enabledInventoryRestaurantIds = await listEnabledRestaurantIdsForFeature('inventoryEnabled')
    if (!enabledInventoryRestaurantIds.length) {
      logger.info('Inventory lifecycle job skipped: no inventory-enabled restaurants')
      return
    }

    const canRun = await beginJob('inventory_lifecycle', jobId)
    if (!canRun) {
      return
    }
    started = true

    logger.info('Inventory lifecycle job started')
    const result = await runInventoryLedgerLifecycleCycle()

    activeJobs[jobId].endTime = Date.now()
    activeJobs[jobId].result = result

    logger.info('Inventory lifecycle job completed', {
      status: result?.status,
      durationMs: result?.durationMs,
      dailyWindows: result?.daily?.dailyWindows || 0,
      monthlyWindows: result?.monthly?.monthlyWindows || 0,
      archivedGroups: result?.archive?.archivedGroups || 0,
    })

    jobHistory.push({ ...activeJobs[jobId], timestamp: new Date() })
    await logLifecycleHealth('inventory_lifecycle')
  } catch (error) {
    logger.error('Inventory lifecycle job failed', {
      error: error.message,
      jobId,
    })

    activeJobs[jobId] = activeJobs[jobId] || {}
    activeJobs[jobId].error = error.message
    activeJobs[jobId].failed = true
  } finally {
    if (started) {
      await endJob('inventory_lifecycle', jobId)
    }
  }
}

/**
 * Initialize all scheduled jobs
 */
let scheduledJobs = []

const initializeScheduler = () => {
  if (scheduledJobs.length > 0) {
    logger.warn('Scheduler already initialized, skipping re-initialization')
    return
  }
  
  logger.info('Initializing data lifecycle scheduler', {
    archiveSchedule: config.schedules.archive,
    purgeSchedule: config.schedules.purge,
    rollupSchedule: config.schedules.rollup,
    cleanupSchedule: config.schedules.cleanup,
    inventoryLifecycleSchedule: config.schedules.inventoryLifecycle,
  })
  
  try {
    // Archive job
    if (config.archive.enabled) {
      const archiveSchedule = cron.schedule(config.schedules.archive, archiveJob, {
        runOnInit: false,
        timezone: 'UTC',
      })
      scheduledJobs.push(archiveSchedule)
      logger.info('Archive job scheduled', { cron: config.schedules.archive })
    }

    if (config.purge.enabled) {
      const purgeSchedule = cron.schedule(config.schedules.purge, purgeJob, {
        runOnInit: false,
        timezone: 'UTC',
      })
      scheduledJobs.push(purgeSchedule)
      logger.info('Purge job scheduled', { cron: config.schedules.purge })
    }
    
    // Rollup job
    if (config.rollup.enabled) {
      const rollupSchedule = cron.schedule(config.schedules.rollup, rollupJob, {
        runOnInit: false,
        timezone: 'UTC',
      })
      scheduledJobs.push(rollupSchedule)
      logger.info('Rollup job scheduled', { cron: config.schedules.rollup })
    }
    
    // Cleanup job
    const cleanupSchedule = cron.schedule(config.schedules.cleanup, cleanupJob, {
      runOnInit: false,
      timezone: 'UTC',
    })
    scheduledJobs.push(cleanupSchedule)
    logger.info('Cleanup job scheduled', { cron: config.schedules.cleanup })

    if (config.inventoryLifecycle.enabled) {
      const inventoryLifecycleSchedule = cron.schedule(config.schedules.inventoryLifecycle, inventoryLifecycleJob, {
        runOnInit: false,
        timezone: 'UTC',
      })
      scheduledJobs.push(inventoryLifecycleSchedule)
      logger.info('Inventory lifecycle job scheduled', { cron: config.schedules.inventoryLifecycle })
    }
    
    logger.info('Data lifecycle scheduler initialized successfully', {
      jobsScheduled: scheduledJobs.length,
    })

    void logLifecycleHealth('scheduler_init')
  } catch (error) {
    logger.error('Failed to initialize scheduler', {
      error: error.message,
      stack: error.stack,
    })
    throw error
  }
}

/**
 * Shutdown scheduler gracefully
 */
const shutdownScheduler = async () => {
  logger.info('Shutting down data lifecycle scheduler')
  
  for (const job of scheduledJobs) {
    try {
      job.stop()
      job.destroy()
    } catch (error) {
      logger.warn('Error stopping scheduled job', { error: error.message })
    }
  }
  
  scheduledJobs = []
  logger.info('Scheduler shutdown complete')
}

/**
 * Get job status and history
 */
const getSchedulerStatus = () => {
  return {
    running: scheduledJobs.length > 0,
    scheduledJobs: scheduledJobs.length,
    activeJobs: Object.keys(activeJobs).length,
    activeJobDetails: activeJobs,
    recentHistory: jobHistory.slice(-20), // Last 20 jobs
    config: {
      archive: { enabled: config.archive.enabled, schedule: config.schedules.archive },
      purge: {
        enabled: config.purge.enabled,
        schedule: config.schedules.purge,
        deleteAfterArchiveDays: config.purge.deleteAfterArchiveDays,
      },
      rollup: { enabled: config.rollup.enabled, schedule: config.schedules.rollup },
      cleanup: { schedule: config.schedules.cleanup },
    },
  }
}

/**
 * Manually trigger a job (for testing/debugging)
 */
const triggerJob = async (jobName) => {
  const validJobs = ['archive', 'purge', 'rollup', 'cleanup']
  if (!validJobs.includes(jobName)) {
    throw new Error(`Invalid job name. Valid options: ${validJobs.join(', ')}`)
  }
  
  logger.info('Manually triggering job', { job: jobName })
  
  switch (jobName) {
    case 'archive':
      return await archiveJob()
    case 'purge':
      return await purgeJob()
    case 'rollup':
      return await rollupJob()
    case 'cleanup':
      return await cleanupJob()
    default:
      throw new Error(`Unknown job: ${jobName}`)
  }
}

export {
  initializeScheduler,
  shutdownScheduler,
  getSchedulerStatus,
  triggerJob,
  archiveJob,
  purgeJob,
  rollupJob,
  cleanupJob,
}
