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
import logger from '../utils/logger.js'
import config from '../config/dataLifecycle.js'
import { archiveOldOrders } from './archiveService.js'
import { rollupAllAnalytics } from './analyticsRollupService.js'
import redis from '../config/redis.js'
import OrderHourlyMetrics from '../models/OrderHourlyMetrics.js'
import AnalyticsEventIngestion from '../models/AnalyticsEventIngestion.js'
import AnalyticsBasketPairDaily from '../models/AnalyticsBasketPairDaily.js'
import AnalyticsItemDailyMetrics from '../models/AnalyticsItemDailyMetrics.js'

const LEADER_LOCK_KEY = 'data-lifecycle:leader'
const LEADER_TTL = 60 // seconds

// Job tracking
let activeJobs = {}
let jobHistory = []

/**
 * Acquire leadership for background jobs (single instance across cluster)
 * Uses Redis for distributed locking
 */
const acquireLeadership = async () => {
  try {
    const lockAcquired = await redis.set(
      LEADER_LOCK_KEY,
      process.pid.toString(),
      'EX',
      LEADER_TTL,
      'NX',
    )
    
    return lockAcquired === 'OK'
  } catch (error) {
    logger.warn('Failed to check leadership', { error: error.message })
    return false
  }
}

/**
 * Refresh leadership lock (call periodically while job is running)
 */
const refreshLeadership = async () => {
  try {
    await redis.expire(LEADER_LOCK_KEY, LEADER_TTL)
  } catch (error) {
    logger.warn('Failed to refresh leadership', { error: error.message })
  }
}

/**
 * Archive job
 * Moves orders older than ARCHIVE_AFTER_DAYS to Azure Blob Storage
 */
const archiveJob = async () => {
  const jobId = `archive_${Date.now()}`
  
  try {
    const isLeader = await acquireLeadership()
    if (!isLeader) {
      logger.debug('Not cluster leader, skipping archive job')
      return
    }
    
    activeJobs[jobId] = { startTime: Date.now(), name: 'archive' }
    
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
  } catch (error) {
    logger.error('Archive job failed', {
      error: error.message,
      jobId,
    })
    
    activeJobs[jobId] = activeJobs[jobId] || {}
    activeJobs[jobId].error = error.message
    activeJobs[jobId].failed = true
  } finally {
    delete activeJobs[jobId]
  }
}

/**
 * Rollup job
 * Aggregates daily analytics to monthly and cleans up low-frequency data
 */
const rollupJob = async () => {
  const jobId = `rollup_${Date.now()}`
  
  try {
    const isLeader = await acquireLeadership()
    if (!isLeader) {
      logger.debug('Not cluster leader, skipping rollup job')
      return
    }
    
    activeJobs[jobId] = { startTime: Date.now(), name: 'rollup' }
    
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
  } catch (error) {
    logger.error('Rollup job failed', {
      error: error.message,
      jobId,
    })
    
    activeJobs[jobId] = activeJobs[jobId] || {}
    activeJobs[jobId].error = error.message
    activeJobs[jobId].failed = true
  } finally {
    delete activeJobs[jobId]
  }
}

/**
 * Cleanup job
 * Removes low-frequency analytics data and expired metrics
 */
const cleanupJob = async () => {
  const jobId = `cleanup_${Date.now()}`
  
  try {
    const isLeader = await acquireLeadership()
    if (!isLeader) {
      logger.debug('Not cluster leader, skipping cleanup job')
      return
    }
    
    activeJobs[jobId] = { startTime: Date.now(), name: 'cleanup' }
    
    logger.info('Cleanup job started')
    
    const results = {
      hourlyMetricsDeleted: 0,
      basketPairsDeleted: 0,
      itemMetricsOptimized: 0,
      errors: [],
    }
    
    // Clean up old hourly metrics
    try {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - config.cleanup.hourlyMetricsRetention)
      
      const deleted = await OrderHourlyMetrics.deleteMany({
        timestamp: { $lt: cutoffDate },
      })
      
      results.hourlyMetricsDeleted = deleted.deletedCount
      logger.info('Cleaned up old hourly metrics', { deleted: deleted.deletedCount })
    } catch (error) {
      const msg = `Cleanup of hourly metrics failed: ${error.message}`
      logger.error(msg)
      results.errors.push(msg)
    }
    
    // Clean up low-frequency basket pairs (keep only top 100 per day)
    try {
      const groupedByDay = await AnalyticsBasketPairDaily.aggregate([
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
    
    // Optimize item metrics (remove zero-row entries)
    try {
      const removed = await AnalyticsItemDailyMetrics.deleteMany({
        $and: [{ views: 0 }, { addToCart: 0 }, { orders: 0 }, { revenue: 0 }],
      })
      
      results.itemMetricsOptimized = removed.deletedCount
      logger.info('Optimized item metrics', { removed: removed.deletedCount })
    } catch (error) {
      const msg = `Optimization of item metrics failed: ${error.message}`
      logger.error(msg)
      results.errors.push(msg)
    }
    
    activeJobs[jobId].endTime = Date.now()
    activeJobs[jobId].result = results
    
    logger.info('Cleanup job completed', results)
    
    jobHistory.push({ ...activeJobs[jobId], timestamp: new Date() })
  } catch (error) {
    logger.error('Cleanup job failed', {
      error: error.message,
      jobId,
    })
    
    activeJobs[jobId] = activeJobs[jobId] || {}
    activeJobs[jobId].error = error.message
    activeJobs[jobId].failed = true
  } finally {
    delete activeJobs[jobId]
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
    rollupSchedule: config.schedules.rollup,
    cleanupSchedule: config.schedules.cleanup,
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
    
    logger.info('Data lifecycle scheduler initialized successfully', {
      jobsScheduled: scheduledJobs.length,
    })
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
      rollup: { enabled: config.rollup.enabled, schedule: config.schedules.rollup },
      cleanup: { schedule: config.schedules.cleanup },
    },
  }
}

/**
 * Manually trigger a job (for testing/debugging)
 */
const triggerJob = async (jobName) => {
  const validJobs = ['archive', 'rollup', 'cleanup']
  if (!validJobs.includes(jobName)) {
    throw new Error(`Invalid job name. Valid options: ${validJobs.join(', ')}`)
  }
  
  logger.info('Manually triggering job', { job: jobName })
  
  switch (jobName) {
    case 'archive':
      return await archiveJob()
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
  rollupJob,
  cleanupJob,
}
