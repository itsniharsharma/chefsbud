import { emitToMenu } from './socketServer.js'

const DETAILED_MENU_EVENTS_ENABLED = String(process.env.MENU_REALTIME_DETAILED_EVENTS || 'false').toLowerCase() === 'true'
const MENU_REFRESH_DEBOUNCE_MS = Number(process.env.MENU_REALTIME_REFRESH_DEBOUNCE_MS || 1200)
const pendingRefreshBySlug = new Map()

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase()
}

function scheduleRefreshEmit(slug, reason) {
  if (!slug) return
  if (pendingRefreshBySlug.has(slug)) return

  const timer = setTimeout(() => {
    pendingRefreshBySlug.delete(slug)
    emitToMenu(slug, 'menu:refresh-required', {
      restaurantSlug: slug,
      reason: String(reason || 'menu-changed'),
      emittedAt: new Date().toISOString(),
    })
  }, Math.max(100, MENU_REFRESH_DEBOUNCE_MS))

  pendingRefreshBySlug.set(slug, timer)
}

export function emitMenuItemCreated(restaurantSlug, item = {}) {
  const slug = normalizeSlug(restaurantSlug)
  if (!slug) return

  scheduleRefreshEmit(slug, 'item-created')
  if (!DETAILED_MENU_EVENTS_ENABLED) return

  emitToMenu(slug, 'menu:item-created', {
    restaurantSlug: slug,
    item: {
      _id: String(item._id || ''),
      categoryId: String(item.categoryId || ''),
      name: String(item.name || ''),
      description: String(item.description || ''),
      price: Number(item.price || 0),
      available: item.available !== false,
      isVeg: item.isVeg !== false,
      bestseller: Boolean(item.bestseller),
    },
    emittedAt: new Date().toISOString(),
  })
}

export function emitMenuItemUpdated(restaurantSlug, itemId, patch = {}) {
  const slug = normalizeSlug(restaurantSlug)
  const normalizedId = String(itemId || '').trim()
  if (!slug || !normalizedId) return

  scheduleRefreshEmit(slug, 'item-updated')
  if (!DETAILED_MENU_EVENTS_ENABLED) return

  const safePatch = {}
  const allowedFields = ['categoryId', 'name', 'description', 'price', 'available', 'isVeg', 'bestseller']
  for (const field of allowedFields) {
    if (!(field in patch)) continue

    if (field === 'price') {
      safePatch[field] = Number(patch[field] || 0)
      continue
    }

    if (field === 'available' || field === 'isVeg' || field === 'bestseller') {
      safePatch[field] = Boolean(patch[field])
      continue
    }

    safePatch[field] = String(patch[field] || '')
  }

  emitToMenu(slug, 'menu:item-updated', {
    restaurantSlug: slug,
    itemId: normalizedId,
    patch: safePatch,
    changedFields: Object.keys(safePatch),
    emittedAt: new Date().toISOString(),
  })
}

export function emitMenuItemDeleted(restaurantSlug, itemId) {
  const slug = normalizeSlug(restaurantSlug)
  const normalizedId = String(itemId || '').trim()
  if (!slug || !normalizedId) return

  scheduleRefreshEmit(slug, 'item-deleted')
  if (!DETAILED_MENU_EVENTS_ENABLED) return

  emitToMenu(slug, 'menu:item-deleted', {
    restaurantSlug: slug,
    itemId: normalizedId,
    emittedAt: new Date().toISOString(),
  })
}

export function emitMenuRefreshRequired(restaurantSlug, reason = 'menu-changed') {
  const slug = normalizeSlug(restaurantSlug)
  if (!slug) return
  scheduleRefreshEmit(slug, reason)
}
