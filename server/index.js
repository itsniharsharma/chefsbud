import 'dotenv/config'
import app from './app.js'
import { connectDB } from './config/db.js'
import { startOrderArchiveScheduler } from './services/orderArchiveService.js'
import { initSocketServer } from './realtime/socketServer.js'
import { logger } from './utils/logger.js'

const PORT = process.env.PORT || 5000

process.on('uncaughtException', (error) => {
  logger.error('uncaught_exception', { errorMessage: error?.message, stack: error?.stack })
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { reason: String(reason?.message || reason) })
})

async function start() {
  await connectDB()
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`)
  })

  initSocketServer(server)

  startOrderArchiveScheduler()

  server.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 65000)
  server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS || 66000)
}

start().catch((error) => {
  console.error('Failed to start server', error)
  process.exit(1)
})
