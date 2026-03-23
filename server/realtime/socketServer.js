import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient } from 'redis'
import Restaurant from '../models/Restaurant.js'
import { logger } from '../utils/logger.js'

let ioServer = null

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

async function configureRedisAdapter(io) {
  const redisUrl = String(process.env.REDIS_URL || '').trim()
  if (!redisUrl) return

  if (!/^rediss?:\/\//i.test(redisUrl)) {
    logger.warn('socket_redis_adapter_disabled', { message: 'REDIS_URL must start with redis:// or rediss://' })
    return
  }

  const pubClient = createClient({ url: redisUrl })
  const subClient = pubClient.duplicate()

  // Redis clients emit error events that must be handled to avoid process crash.
  pubClient.on('error', (error) => {
    logger.warn('socket_redis_pub_error', { message: error?.message || 'unknown_redis_pub_error' })
  })
  subClient.on('error', (error) => {
    logger.warn('socket_redis_sub_error', { message: error?.message || 'unknown_redis_sub_error' })
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
    try {
      const token = parseToken(socket)
      if (!token) {
        return next(new Error('Unauthorized'))
      }

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
