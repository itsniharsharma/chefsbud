import MenuItem from '../models/MenuItem.js'
import Offer from '../models/Offer.js'
import { withRedis } from '../config/redis.js'
import { logger } from '../utils/logger.js'

/**
 * CATALOG CACHE SYSTEM
 * ===================
 * 3-layer caching for restaurant menu items and offers:
 * L0: In-memory local cache (fastest, per-instance)
 * L1: Redis distributed cache (cross-instance)
 * L2: Database (source of truth)
 *
 * Drastically reduces repeated DB queries during order draft building.
 * Target: 60-70% reduction in offer/menu queries
 */

const menuItemsStore = new Map() // restaurantId -> { data, expiresAt }
const offersStore = new Map() // restaurantId -> { data, expiresAt }

const MENU_ITEMS_CACHE_TTL_MS = Math.max(5 * 60_000, Number(process.env.CATALOG_MENU_CACHE_TTL_MS || 10 * 60_000))
const OFFERS_CACHE_TTL_MS = Math.max(1 * 60_000, Number(process.env.CATALOG_OFFERS_CACHE_TTL_MS || 5 * 60_000))
const MAX_LOCAL_ENTRIES = 500

function nowMs() {
  return Date.now()
}

function menuItemsCacheKey(restaurantId) {
  return `catalog:menu:${String(restaurantId || '').trim()}`
}

function offersCacheKey(restaurantId) {
  return `catalog:offers:${String(restaurantId || '').trim()}`
}

function readLocalEntry(store, key) {
  const entry = store.get(key)
  if (!entry) return null
  if (entry.expiresAt <= nowMs()) {
    store.delete(key)
    return null
  }
  return entry.data
}

function writeLocalEntry(store, key, data, ttlMs) {
  while (store.size >= MAX_LOCAL_ENTRIES) {
    const oldestKey = store.keys().next().value
    if (!oldestKey) break
    store.delete(oldestKey)
  }
  store.set(key, { data, expiresAt: nowMs() + ttlMs })
}

async function readJsonFromRedis(key) {
  return withRedis('catalog_cache_read', async (redis) => {
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
  await withRedis('catalog_cache_write', (redis) => redis.set(key, JSON.stringify(value), { ex: ttlSeconds }), null)
}

/**
 * MENU ITEMS CACHE
 * Returns lean documents with projection for order building
 */
export async function getRestaurantMenuItems(restaurantId) {
  const normalizedId = String(restaurantId || '').trim()
  if (!normalizedId) return []

  const localCached = readLocalEntry(menuItemsStore, normalizedId)
  if (Array.isArray(localCached)) {
    return localCached
  }

  const redisCached = await readJsonFromRedis(menuItemsCacheKey(normalizedId))
  if (Array.isArray(redisCached) && redisCached.length) {
    writeLocalEntry(menuItemsStore, normalizedId, redisCached, MENU_ITEMS_CACHE_TTL_MS)
    return redisCached
  }

  try {
    const menuItems = await MenuItem.find({ restaurantId: normalizedId, available: true })
      .select('_id name price')
      .lean()

    if (Array.isArray(menuItems) && menuItems.length) {
      writeLocalEntry(menuItemsStore, normalizedId, menuItems, MENU_ITEMS_CACHE_TTL_MS)
      void writeJsonToRedis(menuItemsCacheKey(normalizedId), menuItems, Math.ceil(MENU_ITEMS_CACHE_TTL_MS / 1000))
    }

    return menuItems || []
  } catch (error) {
    logger.warn('catalog_menu_items_fetch_failed', {
      restaurantId: normalizedId,
      message: error?.message || 'unknown_error',
    })
    return []
  }
}

/**
 * OFFERS CACHE
 * Returns cached offers for a restaurant with all required fields for evaluation
 */
export async function getRestaurantOffers(restaurantId) {
  const normalizedId = String(restaurantId || '').trim()
  if (!normalizedId) return []

  const localCached = readLocalEntry(offersStore, normalizedId)
  if (Array.isArray(localCached)) {
    return localCached
  }

  const redisCached = await readJsonFromRedis(offersCacheKey(normalizedId))
  if (Array.isArray(redisCached) && redisCached.length) {
    writeLocalEntry(offersStore, normalizedId, redisCached, OFFERS_CACHE_TTL_MS)
    return redisCached
  }

  try {
    const offers = await Offer.find({ restaurantId: normalizedId, active: true })
      .select('_id name ruleType stackingPolicy priority conditions actions startTime endTime createdAt')
      .lean()

    if (Array.isArray(offers) && offers.length) {
      writeLocalEntry(offersStore, normalizedId, offers, OFFERS_CACHE_TTL_MS)
      void writeJsonToRedis(offersCacheKey(normalizedId), offers, Math.ceil(OFFERS_CACHE_TTL_MS / 1000))
    }

    return offers || []
  } catch (error) {
    logger.warn('catalog_offers_fetch_failed', {
      restaurantId: normalizedId,
      message: error?.message || 'unknown_error',
    })
    return []
  }
}

/**
 * BATCH FETCH (OPTIMIZED)
 * Fetch menu items AND offers in parallel for maximum throughput
 * Used during draft building to minimize sequential DB calls
 */
export async function getRestaurantCatalog(restaurantId) {
  const normalizedId = String(restaurantId || '').trim()
  if (!normalizedId) {
    return { menuItems: [], offers: [] }
  }

  try {
    const [menuItems, offers] = await Promise.all([
      getRestaurantMenuItems(normalizedId),
      getRestaurantOffers(normalizedId),
    ])

    return {
      menuItems: Array.isArray(menuItems) ? menuItems : [],
      offers: Array.isArray(offers) ? offers : [],
    }
  } catch (error) {
    logger.warn('catalog_batch_fetch_failed', {
      restaurantId: normalizedId,
      message: error?.message || 'unknown_error',
    })
    return { menuItems: [], offers: [] }
  }
}

/**
 * INVALIDATE CACHE
 * Called when menu items or offers are updated
 */
export async function invalidateCatalogCache(restaurantId) {
  const normalizedId = String(restaurantId || '').trim()
  if (!normalizedId) return

  menuItemsStore.delete(normalizedId)
  offersStore.delete(normalizedId)

  await withRedis('catalog_cache_invalidate', async (redis) => {
    await Promise.all([
      redis.del(menuItemsCacheKey(normalizedId)),
      redis.del(offersCacheKey(normalizedId)),
    ])
  }, null)

  logger.info('catalog_cache_invalidated', { restaurantId: normalizedId })
}

/**
 * CACHE STATS (for monitoring)
 */
export function getCatalogCacheStats() {
  return {
    localMenuItemsEntries: menuItemsStore.size,
    localOffersEntries: offersStore.size,
    menuItemsTTLMs: MENU_ITEMS_CACHE_TTL_MS,
    offersTTLMs: OFFERS_CACHE_TTL_MS,
  }
}
