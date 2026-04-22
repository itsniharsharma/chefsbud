import jwt from 'jsonwebtoken'
import Restaurant from '../models/Restaurant.js'
import User from '../models/User.js'
import StaffAccount from '../models/StaffAccount.js'
import { withRedis } from '../config/redis.js'

const AUTH_CACHE_TTL_SECONDS = Math.max(5, Math.min(Number(process.env.AUTH_CACHE_TTL_SECONDS || 15), 120))
const AUTH_CACHE_MAX_ENTRIES = Math.max(200, Number(process.env.AUTH_CACHE_MAX_ENTRIES || 5000))
const AUTH_CACHE_NAMESPACE = 'auth-cache:v1'
const authCache = new Map()

function nowMs() {
  return Date.now()
}

function authEntryKey(scope, payload = {}) {
  const userId = String(payload?.userId || '').trim()
  const ownerId = String(payload?.ownerId || '').trim()
  const staffId = String(payload?.staffId || '').trim()
  const restaurantId = String(payload?.restaurantId || '').trim()
  const tokenVersion = Number(payload?.tokenVersion || 0)
  return `${scope}:${userId}:${ownerId}:${staffId}:${restaurantId}:${tokenVersion}`
}

function redisAuthKey(key) {
  return `${AUTH_CACHE_NAMESPACE}:${key}`
}

function ensureAuthCacheCapacity() {
  while (authCache.size > AUTH_CACHE_MAX_ENTRIES) {
    const oldestKey = authCache.keys().next().value
    if (!oldestKey) break
    authCache.delete(oldestKey)
  }
}

function readMemoryAuthCache(key) {
  const entry = authCache.get(key)
  if (!entry) return null
  if (Number(entry.expiresAt || 0) <= nowMs()) {
    authCache.delete(key)
    return null
  }
  authCache.delete(key)
  authCache.set(key, entry)
  return entry.value
}

function writeMemoryAuthCache(key, value) {
  authCache.set(key, {
    value,
    expiresAt: nowMs() + AUTH_CACHE_TTL_SECONDS * 1000,
  })
  ensureAuthCacheCapacity()
}

async function readRedisAuthCache(key) {
  const raw = await withRedis('auth_cache_read', (redis) => redis.get(redisAuthKey(key)), null)
  if (!raw) return null
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object') return null
  return parsed
}

async function writeRedisAuthCache(key, value) {
  await withRedis(
    'auth_cache_write',
    (redis) => redis.set(redisAuthKey(key), JSON.stringify(value), { ex: AUTH_CACHE_TTL_SECONDS }),
    null,
  )
}

async function getAuthCachedValue(key) {
  const local = readMemoryAuthCache(key)
  if (local) return local

  const distributed = await readRedisAuthCache(key)
  if (!distributed) return null
  writeMemoryAuthCache(key, distributed)
  return distributed
}

async function setAuthCachedValue(key, value) {
  writeMemoryAuthCache(key, value)
  await writeRedisAuthCache(key, value)
}

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: 'JWT secret is not configured' })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    if (!decoded?.userId) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    if (decoded?.role === 'staff') {
      const ownerId = String(decoded?.ownerId || decoded?.userId || '').trim()
      const staffId = String(decoded?.staffId || '').trim()
      const restaurantId = String(decoded?.restaurantId || '').trim()

      if (!ownerId || !staffId || !restaurantId) {
        return res.status(401).json({ message: 'Unauthorized' })
      }

      const tokenVersion = Number(decoded?.tokenVersion || 0)
      const cacheKey = authEntryKey('staff', {
        userId: ownerId,
        ownerId,
        staffId,
        restaurantId,
        tokenVersion,
      })
      const cached = await getAuthCachedValue(cacheKey)
      if (cached?.user && cached?.restaurant) {
        req.user = cached.user
        req.restaurant = cached.restaurant
        return next()
      }

      const [staff, owner, restaurant] = await Promise.all([
        StaffAccount.findOne({
          _id: staffId,
          ownerId,
          restaurantId,
          isActive: true,
        })
          .select('_id ownerId restaurantId username displayName isActive')
          .lean(),
        User.findById(ownerId)
          .select('_id name email role emailVerified tokenVersion billing')
          .lean(),
        Restaurant.findOne({
          _id: restaurantId,
          ownerId,
        })
          .select('_id ownerId slug name gstin address phone paymentConfig kotReprintConfig.passkeyHash kotReprintConfig.updatedAt inventoryAlertConfig')
          .lean(),
      ])

      if (!staff || !owner || !restaurant) {
        return res.status(401).json({ message: 'Invalid token' })
      }

      const currentTokenVersion = Number(owner?.tokenVersion || 0)
      if (tokenVersion !== currentTokenVersion) {
        return res.status(401).json({ message: 'Session expired. Please log in again.' })
      }

      req.user = {
        _id: owner._id,
        ownerId: owner._id,
        role: 'staff',
        staffId: staff._id,
        staffUsername: staff.username,
        staffDisplayName: staff.displayName,
        restaurantId: staff.restaurantId,
        name: staff.displayName || staff.username,
        email: owner.email,
        emailVerified: owner.emailVerified,
        billing: owner.billing,
      }

      req.restaurant = restaurant
      await setAuthCachedValue(cacheKey, {
        user: req.user,
        restaurant,
      })

      return next()
    }

    const tokenVersion = Number(decoded?.tokenVersion || 0)
    const cacheKey = authEntryKey('owner', {
      userId: decoded.userId,
      ownerId: decoded.userId,
      tokenVersion,
    })
    const cached = await getAuthCachedValue(cacheKey)
    if (cached?.user) {
      req.user = cached.user
      req.restaurant = cached.restaurant || null
      return next()
    }

    const [user, restaurant] = await Promise.all([
      User.findById(decoded.userId)
        .select('_id name email role emailVerified tokenVersion billing')
        .lean(),
      Restaurant.findOne({ ownerId: decoded.userId })
        .select('_id ownerId slug name gstin address phone paymentConfig kotReprintConfig.passkeyHash kotReprintConfig.updatedAt inventoryAlertConfig')
        .lean(),
    ])

    if (!user) {
      return res.status(401).json({ message: 'Invalid token' })
    }

    const currentTokenVersion = Number(user?.tokenVersion || 0)
    if (tokenVersion !== currentTokenVersion) {
      return res.status(401).json({ message: 'Session expired. Please log in again.' })
    }

    req.user = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      billing: user.billing,
    }

    req.restaurant = restaurant
    await setAuthCachedValue(cacheKey, {
      user: req.user,
      restaurant,
    })

    next()
  } catch {
    return res.status(401).json({ message: 'Unauthorized' })
  }
}
