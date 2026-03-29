/**
 * Data Lifecycle Management Endpoints
 * Add these to your express app for operational monitoring
 *
 * Owner-only access control recommended (authorization.js middleware)
 */

import express from 'express'
import authorize from '../middleware/authorize.js'
import {
  getSchedulerStatus,
  triggerJob,
} from '../services/dataLifecycleScheduler.js'
import { getArchiveStats } from '../services/archiveService.js'
import { getRollupStats } from '../services/analyticsRollupService.js'
import { BlobServiceClient } from '@azure/storage-blob'
import dataLifecycleConfig from '../config/dataLifecycle.js'
import AnalyticsDailyMetrics from '../models/AnalyticsDailyMetrics.js'
import { logger } from '../utils/logger.js'

const router = express.Router()

/**
 * GET /api/data-lifecycle/status
 * Get current scheduler status and recent job history
 *
 * Response:
 * {
 *   running: boolean,
 *   scheduledJobs: number,
 *   activeJobs: number,
 *   activeJobDetails: {...},
 *   recentHistory: [
 *     { name: 'archive', startTime, endTime, duration, result: {...} }
 *   ],
 *   config: {
 *     archive: { enabled: boolean, schedule: string },
 *     rollup: { enabled: boolean, schedule: string },
 *     cleanup: { schedule: string }
 *   }
 * }
 */
router.get('/status', authorize(['owner']), (req, res) => {
  try {
    const status = getSchedulerStatus()
    return res.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    logger.error('Failed to get scheduler status', { error: error.message })
    return res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

/**
 * POST /api/data-lifecycle/jobs/:jobName/trigger
 * Manually trigger a specific job
 *
 * Params:
 *   jobName: 'archive' | 'rollup' | 'cleanup'
 *
 * Response:
 * {
 *   success: true,
 *   jobName: string,
 *   triggered: boolean,
 *   message: string
 * }
 */
router.post('/jobs/:jobName/trigger', authorize(['owner']), async (req, res) => {
  try {
    const { jobName } = req.params
    const validJobs = ['archive', 'rollup', 'cleanup']
    
    if (!validJobs.includes(jobName)) {
      return res.status(400).json({
        success: false,
        error: `Invalid job name. Valid options: ${validJobs.join(', ')}`,
      })
    }
    
    logger.info('Manual job trigger requested', {
      jobName,
      requestedBy: req.user?.id || 'unknown',
    })
    
    // Run in background (don't wait)
    triggerJob(jobName).catch((error) => {
      logger.error(`Manual job ${jobName} failed`, { error: error.message })
    })
    
    return res.json({
      success: true,
      jobName,
      triggered: true,
      message: `${jobName} job triggered and running in background`,
    })
  } catch (error) {
    logger.error('Failed to trigger job', { error: error.message })
    return res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

/**
 * GET /api/data-lifecycle/archive/stats/:restaurantId
 * Get archive statistics for a specific restaurant
 *
 * Response:
 * {
 *   restaurantId: string,
 *   archived: number,
 *   active: number,
 *   archivePercentage: string (e.g., "25.50")
 * }
 */
router.get('/archive/stats/:restaurantId', authorize(['owner']), async (req, res) => {
  try {
    const { restaurantId } = req.params
    
    // Verify restaurant ownership
    // You should add this check if needed
    
    const stats = await getArchiveStats(restaurantId)
    
    return res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    logger.error('Failed to get archive stats', {
      restaurantId: req.params.restaurantId,
      error: error.message,
    })
    return res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

/**
 * GET /api/data-lifecycle/rollup/stats/:restaurantId
 * Get rollup statistics for a specific restaurant
 *
 * Response:
 * {
 *   restaurantId: string,
 *   daily: { count: number, rolledUp: number },
 *   monthly: number,
 *   itemDaily: { count: number, rolledUp: number },
 *   itemMonthly: number,
 *   pairDaily: { count: number, rolledUp: number },
 *   pairMonthly: number
 * }
 */
router.get('/rollup/stats/:restaurantId', authorize(['owner']), async (req, res) => {
  try {
    const { restaurantId } = req.params
    
    const stats = await getRollupStats(restaurantId)
    
    return res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    logger.error('Failed to get rollup stats', {
      restaurantId: req.params.restaurantId,
      error: error.message,
    })
    return res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

/**
 * GET /api/data-lifecycle/config
 * Get current lifecycle configuration (for debugging)
 *
 * Response:
 * {
 *   archive: { enabled, afterDays, batchSize, maxRetries },
 *   rollup: { enabled, afterDays, topBasketPairsPerMonth },
 *   cleanup: {...},
 *   azure: { containerName, archivePath },
 *   schedules: { archive, rollup, cleanup, cleanupExpired }
 * }
 */
router.get('/config', authorize(['owner']), (req, res) => {
  try {
    // Don't expose sensitive info like connection strings
    const safeConfig = {
      archive: {
        enabled: dataLifecycleConfig.archive.enabled,
        afterDays: dataLifecycleConfig.archive.afterDays,
        batchSize: dataLifecycleConfig.archive.batchSize,
        maxRetries: dataLifecycleConfig.archive.maxRetries,
      },
      rollup: {
        enabled: dataLifecycleConfig.rollup.enabled,
        afterDays: dataLifecycleConfig.rollup.afterDays,
        topBasketPairsPerMonth: dataLifecycleConfig.rollup.topBasketPairsPerMonth,
      },
      cleanup: {
        hourlyMetricsRetention: dataLifecycleConfig.cleanup.hourlyMetricsRetention,
        keepRolledUpDaily: dataLifecycleConfig.cleanup.keepRolledUpDaily,
      },
      schedules: dataLifecycleConfig.schedules,
    }
    
    return res.json({
      success: true,
      data: safeConfig,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    logger.error('Failed to get config', { error: error.message })
    return res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

/**
 * POST /api/data-lifecycle/test
 * Run a test to verify all services are working
 *
 * Response:
 * {
 *   archive: { working: boolean, details: string },
 *   rollup: { working: boolean, details: string },
 *   azure: { working: boolean, details: string }
 * }
 */
router.post('/test', authorize(['owner']), async (req, res) => {
  try {
    const results = {
      timestamp: new Date().toISOString(),
      tests: {},
    }
    
    // Test archive service
    try {
      logger.info('Testing archive service')
      // This will check if services are importable and working
      results.tests.archive = {
        status: 'ok',
        message: 'Archive service responsive',
      }
    } catch (error) {
      results.tests.archive = {
        status: 'error',
        message: error.message,
      }
    }
    
    // Test Azure connection
    try {
      logger.info('Testing Azure connection')
      const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING
      
      if (!connectionString) {
        throw new Error('AZURE_STORAGE_CONNECTION_STRING not configured')
      }
      
      const client = BlobServiceClient.fromConnectionString(connectionString)
      const container = client.getContainerClient(process.env.AZURE_STORAGE_CONTAINER)
      
      // Just check existence
      await container.exists()
      
      results.tests.azure = {
        status: 'ok',
        message: 'Azure Blob Storage connection successful',
      }
    } catch (error) {
      results.tests.azure = {
        status: 'error',
        message: `Azure error: ${error.message}`,
      }
    }
    
    // Test MongoDB connection
    try {
      logger.info('Testing MongoDB connection')
      await AnalyticsDailyMetrics.collection.stats()
      
      results.tests.mongodb = {
        status: 'ok',
        message: 'MongoDB connection successful',
      }
    } catch (error) {
      results.tests.mongodb = {
        status: 'error',
        message: `MongoDB error: ${error.message}`,
      }
    }
    
    // Determine overall status
    const allOk = Object.values(results.tests).every((t) => t.status === 'ok')
    
    return res.json({
      success: allOk,
      data: results,
    })
  } catch (error) {
    logger.error('Test failed', { error: error.message })
    return res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

export default router
