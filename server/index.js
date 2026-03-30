import 'dotenv/config'
import app from './app.js'
import { closeDB, connectDB } from './config/db.js'
import { initializeScheduler, shutdownScheduler } from './services/dataLifecycleScheduler.js'
import { startInventoryReconciliationScheduler, stopInventoryReconciliationScheduler } from './services/inventoryReconciliationService.js'
import { cleanupAllLeaderships } from './services/schedulerLeaderElection.js'
import { runStartupChecks } from './services/startupChecks.js'
import { closeSocketServer, initSocketServer } from './realtime/socketServer.js'
import { performanceMetrics } from './services/performanceMetrics.js'
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
    await stopInventoryReconciliationScheduler()
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
  await runStartupChecks()

  if (PROCESS_ROLE === 'jobs' || PROCESS_ROLE === 'worker') {
    initializeScheduler()
    startInventoryReconciliationScheduler()
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
    startInventoryReconciliationScheduler()
  }

  httpServer.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 65000)
  httpServer.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS || 66000)
  httpServer.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS || 120000)
  httpServer.maxRequestsPerSocket = Number(process.env.MAX_REQUESTS_PER_SOCKET || 1000)
}

start().catch((error) => {
  logger.error('server_start_failed', { message: error?.message, stack: error?.stack })
  process.exit(1)
})
