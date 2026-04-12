import mongoose from 'mongoose'
import RecipeVersion from '../models/RecipeVersion.js'
import { withRedis } from '../config/redis.js'

const CACHE_TTL_MS = 15 * 1000
const CACHE_MAX_ENTRIES = 5000
const CACHE_TTL_SECONDS = Math.max(1, Math.ceil(CACHE_TTL_MS / 1000))
const RECIPE_CACHE_NAMESPACE = 'recipe-version-cache:v1'

const recipeVersionCache = new Map()
const inflightByKey = new Map()

function nowMs() {
  return Date.now()
}

function normalizeId(value) {
  return String(value || '').trim()
}

function cacheKey(restaurantId, menuItemId) {
  return `${normalizeId(restaurantId)}:${normalizeId(menuItemId)}`
}

function redisCacheKey(key) {
  return `${RECIPE_CACHE_NAMESPACE}:${key}`
}

function pruneCacheIfNeeded() {
  if (recipeVersionCache.size <= CACHE_MAX_ENTRIES) return
  const keys = recipeVersionCache.keys()
  while (recipeVersionCache.size > CACHE_MAX_ENTRIES) {
    const next = keys.next()
    if (next.done) break
    recipeVersionCache.delete(next.value)
  }
}

function getFreshCacheEntry(key) {
  const entry = recipeVersionCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= nowMs()) {
    recipeVersionCache.delete(key)
    return null
  }
  return entry.value
}

function setCacheEntry(key, value) {
  recipeVersionCache.set(key, {
    value,
    expiresAt: nowMs() + CACHE_TTL_MS,
  })
}

async function readRedisCacheEntry(key) {
  const raw = await withRedis('recipe_runtime_cache_read', (redis) => redis.get(redisCacheKey(key)), null)
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

async function writeRedisCacheEntry(key, value) {
  await withRedis(
    'recipe_runtime_cache_write',
    (redis) => redis.set(redisCacheKey(key), JSON.stringify(value), { ex: CACHE_TTL_SECONDS }),
    null,
  )
}

async function deleteRedisCacheEntries(keys = []) {
  const normalizedKeys = [...new Set((Array.isArray(keys) ? keys : []).filter(Boolean).map(redisCacheKey))]
  if (!normalizedKeys.length) return
  await withRedis('recipe_runtime_cache_delete', (redis) => redis.del(...normalizedKeys), null)
}

async function fetchLatestRecipeVersionsFromDb({ restaurantId, menuItemIds = [], session = null }) {
  const tenantId = normalizeId(restaurantId)
  const validMenuIds = [...new Set(menuItemIds.map(normalizeId).filter((id) => mongoose.isValidObjectId(id)))]
  if (!tenantId || !validMenuIds.length) {
    return new Map()
  }

  const rows = await RecipeVersion.aggregate([
    {
      $match: {
        restaurantId: new mongoose.Types.ObjectId(tenantId),
        menuItemId: {
          $in: validMenuIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
      },
    },
    { $sort: { menuItemId: 1, version: -1, createdAt: -1 } },
    {
      $group: {
        _id: '$menuItemId',
        menuItemId: { $first: '$menuItemId' },
        version: { $first: '$version' },
        ingredients: { $first: '$ingredients' },
      },
    },
  ]).session(session || null)

  return new Map(rows.map((row) => [normalizeId(row.menuItemId || row._id), row]))
}

async function getLatestRecipeVersionForKey({ restaurantId, menuItemId }) {
  const key = cacheKey(restaurantId, menuItemId)
  const cached = getFreshCacheEntry(key)
  if (cached !== null) return cached

  const redisCached = await readRedisCacheEntry(key)
  if (redisCached !== null) {
    setCacheEntry(key, redisCached)
    pruneCacheIfNeeded()
    return redisCached
  }

  if (inflightByKey.has(key)) {
    return inflightByKey.get(key)
  }

  const promise = (async () => {
    const resultMap = await fetchLatestRecipeVersionsFromDb({
      restaurantId,
      menuItemIds: [menuItemId],
      session: null,
    })
    const row = resultMap.get(normalizeId(menuItemId)) || null
    setCacheEntry(key, row)
    await writeRedisCacheEntry(key, row)
    pruneCacheIfNeeded()
    return row
  })()

  inflightByKey.set(key, promise)
  try {
    return await promise
  } finally {
    inflightByKey.delete(key)
  }
}

export async function loadLatestRecipeVersionsByMenuItem({ restaurantId, menuItemIds = [], session = null }) {
  const tenantId = normalizeId(restaurantId)
  const ids = [...new Set(menuItemIds.map(normalizeId).filter(Boolean))]
  if (!tenantId || !ids.length) {
    return new Map()
  }

  if (session) {
    return fetchLatestRecipeVersionsFromDb({ restaurantId: tenantId, menuItemIds: ids, session })
  }

  const found = new Map()
  const missing = []

  for (const menuItemId of ids) {
    const key = cacheKey(tenantId, menuItemId)
    const cached = getFreshCacheEntry(key)
    if (cached !== null) {
      if (cached) found.set(menuItemId, cached)
      continue
    }

    const inflight = inflightByKey.get(key)
    if (inflight) {
      missing.push({ menuItemId, key, inflight: true })
      continue
    }

    missing.push({ menuItemId, key, inflight: false })
  }

  if (missing.length) {
    const inflightRows = await Promise.all(
      missing
        .filter((entry) => entry.inflight)
        .map(async (entry) => {
          const row = await inflightByKey.get(entry.key)
          return [entry.menuItemId, row]
        }),
    )

    for (const [menuItemId, row] of inflightRows) {
      if (row) found.set(menuItemId, row)
    }

    const fetchIds = missing
      .filter((entry) => !entry.inflight)
      .map((entry) => entry.menuItemId)

    const redisRows = await Promise.all(
      fetchIds.map(async (menuItemId) => {
        const key = cacheKey(tenantId, menuItemId)
        const row = await readRedisCacheEntry(key)
        return [menuItemId, row]
      }),
    )

    const redisHitIds = new Set()
    for (const [menuItemId, row] of redisRows) {
      if (row === null) continue
      const key = cacheKey(tenantId, menuItemId)
      setCacheEntry(key, row)
      if (row) found.set(menuItemId, row)
      redisHitIds.add(menuItemId)
    }

    const fetchIdsFromDb = fetchIds.filter((menuItemId) => !redisHitIds.has(menuItemId))

    if (fetchIdsFromDb.length) {
      const batchPromise = fetchLatestRecipeVersionsFromDb({
        restaurantId: tenantId,
        menuItemIds: fetchIdsFromDb,
        session: null,
      })

      for (const menuItemId of fetchIdsFromDb) {
        inflightByKey.set(cacheKey(tenantId, menuItemId), batchPromise.then((rows) => rows.get(menuItemId) || null))
      }

      let batchRows = new Map()
      try {
        batchRows = await batchPromise
      } finally {
        for (const menuItemId of fetchIdsFromDb) {
          inflightByKey.delete(cacheKey(tenantId, menuItemId))
        }
      }

      for (const menuItemId of fetchIdsFromDb) {
        const key = cacheKey(tenantId, menuItemId)
        const row = batchRows.get(menuItemId) || null
        setCacheEntry(key, row)
        await writeRedisCacheEntry(key, row)
        if (row) found.set(menuItemId, row)
      }
      pruneCacheIfNeeded()
    }
  }

  return found
}

export function invalidateRecipeVersionRuntimeCache({ restaurantId, menuItemIds = [] } = {}) {
  const tenantId = normalizeId(restaurantId)
  if (!tenantId) return

  const ids = [...new Set(menuItemIds.map(normalizeId).filter(Boolean))]
  if (!ids.length) {
    for (const key of recipeVersionCache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        recipeVersionCache.delete(key)
      }
    }
    for (const key of inflightByKey.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        inflightByKey.delete(key)
      }
    }
    return
  }

  const redisKeys = []
  for (const menuItemId of ids) {
    const key = cacheKey(tenantId, menuItemId)
    recipeVersionCache.delete(key)
    inflightByKey.delete(key)
    redisKeys.push(key)
  }

  void deleteRedisCacheEntries(redisKeys)
}
