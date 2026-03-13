import { emitToRestaurant } from './socketServer.js'

export function emitOrderChanged(restaurantId, payload = {}) {
  if (!restaurantId) return

  emitToRestaurant(restaurantId, 'order:changed', {
    ...payload,
    restaurantId: String(restaurantId),
    emittedAt: new Date().toISOString(),
  })
}
