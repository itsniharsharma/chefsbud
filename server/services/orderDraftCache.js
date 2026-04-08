import crypto from 'crypto'
import MenuItem from '../models/MenuItem.js'
import Offer from '../models/Offer.js'
import Restaurant from '../models/Restaurant.js'
import { withRedis } from '../config/redis.js'

const restaurantLookupStore = new Map()
const draftStore = new Map()

const RESTAURANT_LOOKUP_TTL_MS = Math.max(60_000, Number(process.env.ORDER_DRAFT_RESTAURANT_LOOKUP_TTL_MS || 15 * 60_000))
const DRAFT_CACHE_TTL_SECONDS = Math.max(30, Math.min(60, Number(process.env.ORDER_DRAFT_CACHE_TTL_SECONDS || 45)))
const MAX_LOCAL_ENTRIES = Math.max(100, Number(process.env.ORDER_DRAFT_CACHE_MAX_ENTRIES || 1000))

function nowMs() {
  return Date.now()
}

function normalizeSlug(value) {
  return String(value || '').trim()
}

function slugCacheKey(restaurantSlug) {
  return normalizeSlug(restaurantSlug).toLowerCase()
}

function restaurantLookupRedisKey(restaurantSlug) {
  return `order-draft:restaurant:${slugCacheKey(restaurantSlug)}`
}

function draftCacheKey(restaurantId, menuVersion, itemsHash) {
  return `order-draft:draft:${String(restaurantId || '').trim()}:${String(menuVersion || '').trim()}:${String(itemsHash || '').trim()}`
}

function ensureCapacity(store) {
  while (store.size >= MAX_LOCAL_ENTRIES) {
    const oldestKey = store.keys().next().value
    if (!oldestKey) break
    store.delete(oldestKey)
  }
}

function readLocalEntry(store, key) {
  const entry = store.get(key)
  if (!entry) return null
  if (entry.expiresAt <= nowMs()) {
    store.delete(key)
    return null
  }
  return entry.value
}

function writeLocalEntry(store, key, value, ttlMs) {
  ensureCapacity(store)
  store.set(key, {
    value,
    expiresAt: nowMs() + ttlMs,
  })
}

async function readJsonFromRedis(key) {
  return withRedis('order_draft_cache_read', async (redis) => {
    const raw = await redis.get(key)
    if (!raw) return null

    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    }

    return raw && typeof raw === 'object' ? raw : null
  }, null)
}

async function writeJsonToRedis(key, value, ttlSeconds) {
  await withRedis('order_draft_cache_write', (redis) => redis.set(key, JSON.stringify(value), { ex: ttlSeconds }), null)
}

export function buildOrderDraftItemsHash(items = [], couponCode = '') {
  const normalizedItems = Array.isArray(items)
    ? items
        .map((item) => ({
          menuItemId: String(item?.menuItemId || '').trim(),
          quantity: Math.max(1, Number(item?.quantity || 1)),
        }))
        .filter((item) => item.menuItemId)
        .sort((left, right) => {
          if (left.menuItemId !== right.menuItemId) return left.menuItemId.localeCompare(right.menuItemId)
          return left.quantity - right.quantity
        })
    : []

  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ items: normalizedItems, couponCode: String(couponCode || '').trim().toUpperCase() }))
    .digest('hex')
}

export async function resolveRestaurantIdentityBySlug(restaurantSlug) {
  const normalizedSlug = normalizeSlug(restaurantSlug)
  if (!normalizedSlug) {
    return null
  }

  const cacheKey = slugCacheKey(normalizedSlug)
  const localCached = readLocalEntry(restaurantLookupStore, cacheKey)
  if (localCached) {
    return localCached
  }

  const redisCached = await readJsonFromRedis(restaurantLookupRedisKey(normalizedSlug))
  if (redisCached?.restaurantId) {
    const entry = {
      restaurantId: String(redisCached.restaurantId),
      restaurantSlug: String(redisCached.restaurantSlug || normalizedSlug),
    }
    writeLocalEntry(restaurantLookupStore, cacheKey, entry, RESTAURANT_LOOKUP_TTL_MS)
    return entry
  }

  const restaurant = await Restaurant.findOne({ slug: normalizedSlug }).select('_id slug').lean()
  if (!restaurant) {
    return null
  }

  const resolved = {
    restaurantId: String(restaurant._id),
    restaurantSlug: String(restaurant.slug || normalizedSlug),
  }

  writeLocalEntry(restaurantLookupStore, cacheKey, resolved, RESTAURANT_LOOKUP_TTL_MS)
  void writeJsonToRedis(restaurantLookupRedisKey(normalizedSlug), resolved, Math.ceil(RESTAURANT_LOOKUP_TTL_MS / 1000))

  return resolved
}

export async function resolveCatalogVersion(restaurantId) {
  const normalizedRestaurantId = String(restaurantId || '').trim()
  if (!normalizedRestaurantId) {
    return '0:0'
  }

  const [latestMenuItem, latestOffer] = await Promise.all([
    MenuItem.findOne({ restaurantId: normalizedRestaurantId, available: true })
      .sort({ updatedAt: -1, _id: -1 })
      .select('updatedAt')
      .lean(),
    Offer.findOne({ restaurantId: normalizedRestaurantId, active: true })
      .sort({ updatedAt: -1, _id: -1 })
      .select('updatedAt')
      .lean(),
  ])

  return [
    latestMenuItem?.updatedAt ? new Date(latestMenuItem.updatedAt).getTime() : 0,
    latestOffer?.updatedAt ? new Date(latestOffer.updatedAt).getTime() : 0,
  ].join(':')
}

export async function getCachedDraftResult({ restaurantId, menuVersion, itemsHash }) {
  const key = draftCacheKey(restaurantId, menuVersion, itemsHash)
  const localCached = readLocalEntry(draftStore, key)
  if (localCached) {
    return localCached
  }

  const redisCached = await readJsonFromRedis(key)
  if (!redisCached) {
    return null
  }

  const cachedDraft = {
    restaurant: redisCached.restaurant,
    restaurantSlug: redisCached.restaurantSlug,
    orderItems: redisCached.orderItems,
    pricing: redisCached.pricing,
    tableNumber: redisCached.tableNumber,
    floorNumber: redisCached.floorNumber,
    cacheHit: true,
    menuVersion,
    itemsHash,
  }

  writeLocalEntry(draftStore, key, cachedDraft, DRAFT_CACHE_TTL_SECONDS * 1000)
  return cachedDraft
}

export async function setCachedDraftResult({ restaurantId, menuVersion, itemsHash, draft }) {
  const key = draftCacheKey(restaurantId, menuVersion, itemsHash)
  const cachedDraft = {
    ...draft,
    cacheHit: false,
    menuVersion,
    itemsHash,
  }

  writeLocalEntry(draftStore, key, cachedDraft, DRAFT_CACHE_TTL_SECONDS * 1000)
  void writeJsonToRedis(key, cachedDraft, DRAFT_CACHE_TTL_SECONDS)
  return cachedDraft
}

export function getOrderDraftCacheTtlSeconds() {
  return DRAFT_CACHE_TTL_SECONDS
}
