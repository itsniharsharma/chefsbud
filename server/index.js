import 'dotenv/config'
import app from './app.js'
import { closeDB, connectDB, isMongoStalePrimaryError, refreshMongoTopology } from './config/db.js'
import config from './config/dataLifecycle.js'
import { initializeScheduler, shutdownScheduler } from './services/dataLifecycleScheduler.js'
import { cleanupAllLeaderships } from './services/schedulerLeaderElection.js'
import { runStartupChecks } from './services/startupChecks.js'
import { closeSocketServer, initSocketServer } from './realtime/socketServer.js'
import { performanceMetrics } from './services/performanceMetrics.js'
import { startOrderInventoryWorker, stopOrderInventoryWorker } from './services/orderInventoryQueueService.js'
import { startOrderOutboxWorker, stopOrderOutboxWorker } from './services/orderOutboxService.js'
import { startOrderQueueWorker, stopOrderQueueWorker } from './services/orderQueueService.js'
import { logger } from './utils/logger.js'

const PORT = process.env.PORT || 5000
const PROCESS_ROLE = String(process.env.PROCESS_ROLE || 'all').trim().toLowerCase()
const SHUTDOWN_TIMEOUT_MS = Math.max(1_000, Number(process.env.SHUTDOWN_TIMEOUT_MS || 15_000))

let httpServer = null
let shuttingDown = false

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  logger.info('server_shutdown_started', { signal })

  const forceExitTimer = setTimeout(() => {
    logger.error('server_shutdown_timeout', { signal, timeoutMs: SHUTDOWN_TIMEOUT_MS })
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  forceExitTimer.unref?.()

  try {
    await shutdownScheduler()
    stopOrderOutboxWorker()
    stopOrderInventoryWorker()
    stopOrderQueueWorker()
    await cleanupAllLeaderships()
    performanceMetrics.stop()
    await closeSocketServer()

    if (httpServer) {
      await new Promise((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }

    await closeDB()
    logger.info('server_shutdown_completed', { signal })
    process.exit(exitCode)
  } catch (error) {
    logger.error('server_shutdown_failed', { signal, message: error?.message, stack: error?.stack })
    process.exit(1)
  }
}

process.on('uncaughtException', (error) => {
  logger.error('uncaught_exception', { errorMessage: error?.message, stack: error?.stack })
  void shutdown('uncaughtException', 1)
})

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { reason: String(reason?.message || reason) })

  if (isMongoStalePrimaryError(reason)) {
    void refreshMongoTopology('unhandled_rejection_stale_primary').catch((error) => {
      logger.error('mongodb_topology_refresh_failed', {
        message: error?.message,
        source: 'unhandled_rejection',
      })
    })
  }
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

async function start() {
  performanceMetrics.start()
  await connectDB()
  
  // Phase 1: Startup validation - ensure TTL >= Rollup Lookback
  try {
    const LEDGER_TTL_SECONDS = Number(process.env.INVENTORY_LEDGER_TTL_SECONDS || 432000)
    const LEDGER_TTL_DAYS = Math.ceil(LEDGER_TTL_SECONDS / 86400)
    const ROLLUP_LOOKBACK_DAYS = Number(config.inventoryLifecycle?.dailyRollupLookbackDays || LEDGER_TTL_DAYS)
    
    if (ROLLUP_LOOKBACK_DAYS < LEDGER_TTL_DAYS) {
      const msg = `[CRITICAL] Inventory lifecycle constraint violation: ROLLUP_LOOKBACK_DAYS (${ROLLUP_LOOKBACK_DAYS}) must be >= LEDGER_TTL_DAYS (${LEDGER_TTL_DAYS}). This creates a data loss risk! Aborting startup.`
      console.error(msg)
      logger.error('startup_validation_failed', { ROLLUP_LOOKBACK_DAYS, LEDGER_TTL_DAYS })
      process.exit(1)
    }
    logger.info('startup_validation_passed', { ROLLUP_LOOKBACK_DAYS, LEDGER_TTL_DAYS, message: 'Inventory lifecycle TTL constraint satisfied' })
  } catch (error) {
    logger.error('startup_validation_error', { message: error?.message })
    process.exit(1)
  }
  
  await runStartupChecks()

  if (PROCESS_ROLE === 'jobs' || PROCESS_ROLE === 'worker') {
    initializeScheduler()
    startOrderOutboxWorker()
    startOrderInventoryWorker()
    startOrderQueueWorker()
    logger.info('Jobs process started', { processRole: PROCESS_ROLE })
    return
  }

  httpServer = app.listen(PORT, () => {
    logger.info('server_started', {
      port: Number(PORT),
      nodeEnv: process.env.NODE_ENV || 'development',
      processRole: PROCESS_ROLE,
    })
  })

  initSocketServer(httpServer)

  if (PROCESS_ROLE === 'all') {
    initializeScheduler()
  }

  startOrderOutboxWorker()
  startOrderInventoryWorker()
  startOrderQueueWorker()

  httpServer.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 65000)
  httpServer.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS || 66000)
  httpServer.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS || 120000)
  httpServer.maxRequestsPerSocket = Number(process.env.MAX_REQUESTS_PER_SOCKET || 1000)
}

start().catch((error) => {
  logger.error('server_start_failed', { message: error?.message, stack: error?.stack })
  process.exit(1)
})
