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
  markKotPrinted(orderId, payload = {}) {
    return api.patch(`/orders/${orderId}/kot-printed`, payload).then((response) => response.data)
  },
  markBillPrinted(orderId, payload = {}) {
    return api.patch(`/orders/${orderId}/bill-printed`, payload).then((response) => response.data)
  },
  delete(orderId) {
    return api.delete(`/orders/${orderId}`).then((response) => response.data)
  },
  create(payload) {
    return api.post('/orders', payload).then((response) => response.data)
  },
  track(restaurantSlug, tableNumber, orderId) {
    return api
      .get(`/orders/track/${restaurantSlug}/${tableNumber}/${orderId}`)
      .then((response) => response.data)
  },
  trackTable(restaurantSlug, tableNumber) {
    return api.get(`/orders/track/${restaurantSlug}/${tableNumber}`).then((response) => response.data)
  },
}
