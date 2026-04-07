import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient } from 'redis'
import Restaurant from '../models/Restaurant.js'
import { logger } from '../utils/logger.js'

let ioServer = null
const REDIS_ERROR_LOG_WINDOW_MS = Math.max(10_000, Number(process.env.SOCKET_REDIS_ERROR_LOG_WINDOW_MS || 60_000))
const REDIS_ERROR_LOG_BURST_LIMIT = Math.max(1, Number(process.env.SOCKET_REDIS_ERROR_LOG_BURST_LIMIT || 3))
const redisErrorBuckets = new Map()

function isRedisAdapterEnabled() {
  const explicit = String(process.env.SOCKET_ENABLE_REDIS_ADAPTER || '').trim().toLowerCase()
  if (explicit === 'true' || explicit === '1' || explicit === 'yes') return true
  if (explicit === 'false' || explicit === '0' || explicit === 'no') return false
  return process.env.NODE_ENV === 'production'
}

function logSocketRedisError(eventKey, error) {
  const now = Date.now()
  const message = String(error?.message || `unknown_${eventKey}_error`)
  const bucketKey = `${eventKey}:${message}`
  const existing = redisErrorBuckets.get(bucketKey)

  if (!existing || now - existing.windowStart >= REDIS_ERROR_LOG_WINDOW_MS) {
    if (existing?.suppressed > 0) {
      logger.warn('socket_redis_error_suppressed_summary', {
        event: eventKey,
        message,
        suppressedCount: existing.suppressed,
        windowMs: REDIS_ERROR_LOG_WINDOW_MS,
      })
    }

    redisErrorBuckets.set(bucketKey, {
      windowStart: now,
      logged: 1,
      suppressed: 0,
    })
    logger.warn(eventKey, { message })
    return
  }

  if (existing.logged < REDIS_ERROR_LOG_BURST_LIMIT) {
    existing.logged += 1
    logger.warn(eventKey, { message })
    return
  }

  existing.suppressed += 1
}

function parseToken(socket) {
  const authToken = String(socket.handshake?.auth?.token || '').trim()
  if (authToken) return authToken

  const headerValue = String(socket.handshake?.headers?.authorization || '').trim()
  if (headerValue.startsWith('Bearer ')) {
    return headerValue.slice(7)
  }

  return ''
}

function buildCorsOrigins() {
  return String(process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

export function restaurantRoomName(restaurantId) {
  return `restaurant:${String(restaurantId || '').trim()}`
}

export function menuRoomName(restaurantSlug) {
  return `menu:${String(restaurantSlug || '').trim().toLowerCase()}`
}

function isValidMenuSlug(slug) {
  // Keep room keys bounded and predictable; this avoids accidental room explosion.
  return /^[a-z0-9-]{2,120}$/.test(String(slug || '').trim().toLowerCase())
}

async function configureRedisAdapter(io) {
  if (!isRedisAdapterEnabled()) {
    logger.info('socket_redis_adapter_skipped', {
      reason: 'disabled_by_environment',
      nodeEnv: process.env.NODE_ENV || 'development',
    })
    return
  }

  const redisUrl = String(process.env.REDIS_URL || '').trim()
  if (!redisUrl) return

  if (!/^rediss?:\/\//i.test(redisUrl)) {
    logger.warn('socket_redis_adapter_disabled', { message: 'REDIS_URL must start with redis:// or rediss://' })
    return
  }

  const pubClient = createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries) => Math.min(200 + retries * 200, 5_000),
    },
  })
  const subClient = pubClient.duplicate()

  // Redis clients emit error events that must be handled to avoid process crash.
  pubClient.on('error', (error) => {
    logSocketRedisError('socket_redis_pub_error', error)
  })
  subClient.on('error', (error) => {
    logSocketRedisError('socket_redis_sub_error', error)
  })

  await Promise.all([pubClient.connect(), subClient.connect()])
  io.adapter(createAdapter(pubClient, subClient))

  io.engine.on('close', async () => {
    await Promise.allSettled([pubClient.quit(), subClient.quit()])
  })
}

export function initSocketServer(server) {
  if (ioServer) return ioServer

  ioServer = new Server(server, {
    path: '/socket.io',
    cors: {
      origin: buildCorsOrigins(),
      credentials: true,
    },
  })

  ioServer.use(async (socket, next) => {
    const token = parseToken(socket)
    if (!token) {
      socket.data.role = 'public'
      socket.data.userId = ''
      return next()
    }

    try {
      if (!process.env.JWT_SECRET) {
        return next(new Error('Unauthorized'))
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      if (!decoded?.userId) {
        return next(new Error('Unauthorized'))
      }

      socket.data.userId = String(decoded.userId)
      socket.data.role = String(decoded.role || 'owner')
      return next()
    } catch {
      return next(new Error('Unauthorized'))
    }
  })

  ioServer.on('connection', (socket) => {
    socket.on('dashboard:join-restaurant', async (payload = {}, ack) => {
      try {
        if (!socket.data?.userId || socket.data?.role === 'public') {
          if (typeof ack === 'function') ack({ ok: false, message: 'Unauthorized' })
          return
        }

        const restaurantId = String(payload.restaurantId || '').trim()
        if (!restaurantId) {
          if (typeof ack === 'function') ack({ ok: false, message: 'restaurantId is required' })
          return
        }

        const hasAccess = await Restaurant.exists({ _id: restaurantId, ownerId: socket.data.userId })
        if (!hasAccess) {
          if (typeof ack === 'function') ack({ ok: false, message: 'Forbidden' })
          return
        }

        socket.join(restaurantRoomName(restaurantId))
        if (typeof ack === 'function') ack({ ok: true })
      } catch {
        if (typeof ack === 'function') ack({ ok: false, message: 'Failed to join room' })
      }
    })

    socket.on('dashboard:leave-restaurant', (payload = {}) => {
      const restaurantId = String(payload.restaurantId || '').trim()
      if (!restaurantId) return
      socket.leave(restaurantRoomName(restaurantId))
    })

    socket.on('menu:join-restaurant', (payload = {}, ack) => {
      try {
        const restaurantSlug = String(payload.restaurantSlug || '').trim().toLowerCase()
        if (!restaurantSlug || !isValidMenuSlug(restaurantSlug)) {
          if (typeof ack === 'function') ack({ ok: false, message: 'restaurantSlug is required' })
          return
        }

        socket.join(menuRoomName(restaurantSlug))
        if (typeof ack === 'function') ack({ ok: true })
      } catch {
        if (typeof ack === 'function') ack({ ok: false, message: 'Failed to join menu room' })
      }
    })

    socket.on('menu:leave-restaurant', (payload = {}) => {
      const restaurantSlug = String(payload.restaurantSlug || '').trim().toLowerCase()
      if (!restaurantSlug) return
      socket.leave(menuRoomName(restaurantSlug))
    })
  })

  configureRedisAdapter(ioServer).catch((error) => {
    logger.warn('socket_redis_adapter_disabled', { message: error?.message || 'failed_to_configure_redis_adapter' })
  })

  return ioServer
}

export function getSocketServer() {
  return ioServer
}

export async function closeSocketServer() {
  if (!ioServer) return

  await new Promise((resolve) => {
    ioServer.close(() => resolve())
  })
  ioServer = null
}

export function emitToRestaurant(restaurantId, eventName, payload) {
  if (!ioServer || !restaurantId) return
  ioServer.to(restaurantRoomName(restaurantId)).emit(eventName, payload)
}

export function emitToMenu(restaurantSlug, eventName, payload) {
  if (!ioServer || !restaurantSlug) return
  ioServer.to(menuRoomName(restaurantSlug)).emit(eventName, payload)
}
