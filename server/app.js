import cors from 'cors'
import compression from 'compression'
import express from 'express'
import authRoutes from './routes/authRoutes.js'
import restaurantRoutes from './routes/restaurantRoutes.js'
import menuRoutes from './routes/menuRoutes.js'
import tableRoutes from './routes/tableRoutes.js'
import orderRoutes from './routes/orderRoutes.js'
import offerRoutes from './routes/offerRoutes.js'
import analyticsRoutes from './routes/analyticsRoutes.js'
import paymentRoutes from './routes/paymentRoutes.js'
import inventoryRoutes from './routes/inventoryRoutes.js'
import inventoryV2Routes from './routes/inventoryV2Routes.js'
import demoRoutes from './routes/demoRoutes.js'
import dataLifecycleRoutes from './routes/dataLifecycleRoutes.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { requestContext } from './middleware/requestContext.js'
import { requestLatencyMetrics } from './middleware/performanceMetrics.js'
import { securityHeaders } from './middleware/securityHeaders.js'
import { createRateLimiter } from './middleware/rateLimit.js'
import { getDbStatus } from './config/db.js'
import { getRedisTelemetry } from './config/redis.js'
import { getInventoryRuntimeConfig } from './config/inventoryRuntime.js'
import { getQueueStats } from './services/orderQueueService.js'

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)
app.set('etag', 'strong')
const isProduction = process.env.NODE_ENV === 'production'
const appRevision =
  String(process.env.APP_REVISION || process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || 'local').trim() ||
  'local'
const jsonLimit = process.env.API_JSON_LIMIT || '1mb'
const urlEncodedLimit = process.env.API_URLENCODED_LIMIT || '256kb'

const globalLimiter = createRateLimiter({
  id: 'global',
  capacity: Number(process.env.RATE_LIMIT_GLOBAL_CAPACITY || 240),
  windowMs: Number(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS || 60_000),
  keyFn: (req) => req.ip,
  skip: (req) =>
    req.method === 'OPTIONS' ||
    req.method === 'HEAD' ||
    req.path === '/' ||
    req.path === '/favicon.ico' ||
    req.path === '/robots.txt' ||
    req.path === '/manifest.json' ||
    req.path.startsWith('/socket.io') ||
    req.path === '/health' ||
    req.path === '/api/health' ||
    (req.method === 'GET' && (req.path.startsWith('/api/menu/') || req.path.startsWith('/api/orders/track/'))) ||
    (req.method === 'POST' && req.path === '/api/orders')
})

const originConfig = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)

    const normalizedOrigin = String(origin).trim()
    const allowlisted = originConfig.includes(normalizedOrigin)
    const localhostLike = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
    const lanLike =
      /^https?:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(
        origin,
      )
    const ngrokLike = /^https?:\/\/[a-z0-9-]+\.(ngrok-free\.dev|ngrok-free\.app|ngrok\.io|ngrok\.app)$/i.test(
      origin,
    )

    if (allowlisted || localhostLike || lanLike || ngrokLike || !isProduction) {
      return callback(null, true)
    }

    const corsError = new Error('CORS origin not allowed')
    corsError.status = 403
    return callback(corsError)
  },
}

app.use(cors(corsOptions))
app.use(compression())
app.use((req, res, next) => {
  res.setHeader('x-app-revision', appRevision)
  next()
})
app.use(requestContext)
app.use(requestLatencyMetrics)
app.use(securityHeaders)
app.use(globalLimiter)
app.use('/api/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }))
app.use(express.json({ limit: jsonLimit }))
app.use(express.urlencoded({ extended: false, limit: urlEncodedLimit }))

app.get('/api/health', async (req, res) => {
  const inventoryConfig = getInventoryRuntimeConfig()
  const queueStats = await getQueueStats()
  const redisTelemetry = getRedisTelemetry({ top: 15 })

  res.json({
    ok: true,
    app: "Chef's Bud - Restaurant Revenue OS",
    revision: appRevision,
    inventoryPatchLevel: 'inventory-hardening-v2',
    inventoryRolloutMode: inventoryConfig.rolloutMode,
    inventoryStrictPolicy: inventoryConfig.strictPolicy,
    inventoryLegacyFallback: inventoryConfig.allowLegacyFallback,
    uptimeSeconds: Math.round(process.uptime()),
    processRole: String(process.env.PROCESS_ROLE || 'all').trim().toLowerCase(),
    db: getDbStatus(),
    redis: redisTelemetry,
    queue: queueStats,
  })
})

app.use('/api/auth', authRoutes)
app.use('/api/restaurants', restaurantRoutes)
app.use('/api/menu', menuRoutes)
app.use('/api/tables', tableRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/offers', offerRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/inventory', inventoryRoutes)
app.use('/api/inventory/v2', inventoryV2Routes)
app.use('/api/demo', demoRoutes)
app.use('/api/data-lifecycle', dataLifecycleRoutes)

app.use(notFoundHandler)
app.use(errorHandler)

export default app
