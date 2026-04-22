import api from './api'

export const orderService = {
  list(restaurantId, params = {}) {
    return api.get(`/orders/${restaurantId}`, { params }).then((response) => response.data)
  },
  listBoard(restaurantId, params = {}) {
    return api
      .get(`/orders/${restaurantId}`, { params: { ...params, view: 'active' } })
      .then((response) => response.data)
      .then((activeOrders) => ({ activeOrders: Array.isArray(activeOrders) ? activeOrders : [] }))
  },
  updateStatus(orderId, orderStatus) {
    return api.patch(`/orders/${orderId}/status`, { orderStatus }).then((response) => response.data)
  },
  shiftTable(payload) {
    return api.patch('/orders/shift-table', payload).then((response) => response.data)
  },
  markPrintBundle(orderId, payload = {}) {
    return api.patch(`/orders/${orderId}/print-bundle`, payload).then((response) => response.data)
  },
  delete(orderId) {
    return api.delete(`/orders/${orderId}`).then((response) => response.data)
  },
  create(payload) {
    const idempotencyKey = String(payload?.idempotencyKey || '').trim()
    const requestConfig = idempotencyKey
      ? { headers: { 'x-idempotency-key': idempotencyKey } }
      : undefined
    return api.post('/orders', payload, requestConfig).then((response) => response.data)
  },
  track(restaurantSlug, tableNumber, orderId) {
    return api
      .get(`/orders/track/${restaurantSlug}/${tableNumber}/${orderId}`)
      .then((response) => response.data)
  },
  trackTable(restaurantSlug, tableNumber) {
    return api.get(`/orders/track/${restaurantSlug}/${tableNumber}`).then((response) => response.data)
  },
  ratePublicOrder({ restaurantSlug, tableNumber, orderId, rating }) {
    return api
      .post(`/orders/track/${restaurantSlug}/${tableNumber}/${orderId}/rating`, { rating })
      .then((response) => response.data)
  },
}
