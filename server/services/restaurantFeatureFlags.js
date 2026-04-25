import Restaurant from '../models/Restaurant.js'

const FEATURE_FLAGS_CACHE_TTL_MS = Math.max(5_000, Number(process.env.FEATURE_FLAGS_CACHE_TTL_MS || 30_000))
const FEATURE_FLAGS_CACHE_MAX_ENTRIES = Math.max(200, Number(process.env.FEATURE_FLAGS_CACHE_MAX_ENTRIES || 5000))
const FEATURE_FLAG_LIST_CACHE_TTL_MS = Math.max(5_000, Number(process.env.FEATURE_FLAG_LIST_CACHE_TTL_MS || 30_000))
const featureCache = new Map()
const featureListCache = new Map()

function normalizeFlags(source) {
  const config = source?.featureConfig || source || {}
  return {
    inventoryEnabled: config?.inventoryEnabled !== false,
    analyticsEnabled: config?.analyticsEnabled !== false,
  }
}

function readCache(restaurantId) {
  const key = String(restaurantId || '').trim()
  if (!key) return null
  const entry = featureCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    featureCache.delete(key)
    return null
  }
  return entry.flags
}

function writeCache(restaurantId, flags) {
  const key = String(restaurantId || '').trim()
  if (!key) return
  if (featureCache.size >= FEATURE_FLAGS_CACHE_MAX_ENTRIES) {
    const oldestKey = featureCache.keys().next().value
    if (oldestKey) featureCache.delete(oldestKey)
  }
  featureCache.set(key, {
    flags,
    expiresAt: Date.now() + FEATURE_FLAGS_CACHE_TTL_MS,
  })
}

export function getRestaurantFeatureFlagsFromEntity(entity) {
  return normalizeFlags(entity)
}

export async function getRestaurantFeatureFlagsById(restaurantId) {
  const cached = readCache(restaurantId)
  if (cached) return cached

  const restaurant = await Restaurant.findById(restaurantId)
    .select('featureConfig')
    .lean()
  const flags = normalizeFlags(restaurant)
  writeCache(restaurantId, flags)
  return flags
}

export async function isInventoryEnabledForRestaurantId(restaurantId) {
  const flags = await getRestaurantFeatureFlagsById(restaurantId)
  return flags.inventoryEnabled
}

export async function isAnalyticsEnabledForRestaurantId(restaurantId) {
  const flags = await getRestaurantFeatureFlagsById(restaurantId)
  return flags.analyticsEnabled
}

export function invalidateRestaurantFeatureFlagsCache(restaurantId) {
  const key = String(restaurantId || '').trim()
  if (!key) return
  featureCache.delete(key)
  featureListCache.clear()
}

export async function listEnabledRestaurantIdsForFeature(featureName) {
  const featureKey = String(featureName || '').trim()
  if (featureKey !== 'inventoryEnabled' && featureKey !== 'analyticsEnabled') {
    return []
  }

  const cached = featureListCache.get(featureKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ids
  }

  const query = {}
  query[`featureConfig.${featureKey}`] = { $ne: false }
  const rows = await Restaurant.find(query).select('_id').lean()
  const ids = rows.map((row) => row._id).filter(Boolean)
  featureListCache.set(featureKey, {
    ids,
    expiresAt: Date.now() + FEATURE_FLAG_LIST_CACHE_TTL_MS,
  })
  return ids
}
