import mongoose from 'mongoose'
import RecipeVersion from '../models/RecipeVersion.js'

const CACHE_TTL_MS = 15 * 1000
const CACHE_MAX_ENTRIES = 5000

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

    if (fetchIds.length) {
      const batchPromise = fetchLatestRecipeVersionsFromDb({
        restaurantId: tenantId,
        menuItemIds: fetchIds,
        session: null,
      })

      for (const menuItemId of fetchIds) {
        inflightByKey.set(cacheKey(tenantId, menuItemId), batchPromise.then((rows) => rows.get(menuItemId) || null))
      }

      let batchRows = new Map()
      try {
        batchRows = await batchPromise
      } finally {
        for (const menuItemId of fetchIds) {
          inflightByKey.delete(cacheKey(tenantId, menuItemId))
        }
      }

      for (const menuItemId of fetchIds) {
        const key = cacheKey(tenantId, menuItemId)
        const row = batchRows.get(menuItemId) || null
        setCacheEntry(key, row)
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

  for (const menuItemId of ids) {
    const key = cacheKey(tenantId, menuItemId)
    recipeVersionCache.delete(key)
    inflightByKey.delete(key)
  }
}
