import { emitToRestaurant } from './socketServer.js'

const INVENTORY_EVENT_DEBOUNCE_MS = Math.max(
  400,
  Number(process.env.INVENTORY_REALTIME_DEBOUNCE_MS || 1200),
)

const pendingInventoryEmitByRestaurant = new Map()

function normalizeRestaurantId(value) {
  return String(value || '').trim()
}

export function emitInventoryChanged(restaurantId, payload = {}) {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId)
  if (!normalizedRestaurantId) return

  if (pendingInventoryEmitByRestaurant.has(normalizedRestaurantId)) {
    return
  }

  const timer = setTimeout(() => {
    pendingInventoryEmitByRestaurant.delete(normalizedRestaurantId)

    emitToRestaurant(normalizedRestaurantId, 'inventory:changed', {
      restaurantId: normalizedRestaurantId,
      ...payload,
      emittedAt: new Date().toISOString(),
    })
  }, INVENTORY_EVENT_DEBOUNCE_MS)

  pendingInventoryEmitByRestaurant.set(normalizedRestaurantId, timer)
}
