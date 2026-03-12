import 'dotenv/config'
import app from './app.js'
import { connectDB } from './config/db.js'
import { startOrderArchiveScheduler } from './services/orderArchiveService.js'

const PORT = process.env.PORT || 5000

async function start() {
  await connectDB()
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`)
  })

  startOrderArchiveScheduler()

  server.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 65000)
  server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS || 66000)
}

start().catch((error) => {
  console.error('Failed to start server', error)
  process.exit(1)
})
