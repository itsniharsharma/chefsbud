import api from './api'

export const analyticsService = {
  dashboard(restaurantId) {
    return api.get(`/analytics/dashboard/${restaurantId}`).then((response) => response.data)
  },
  decision(restaurantId, params = {}) {
    return api.get(`/analytics/decision/${restaurantId}`, { params }).then((response) => response.data)
  },
  analytics(restaurantId, params = {}) {
    return api.get(`/analytics/${restaurantId}`, { params }).then((response) => response.data)
  },
  trackMenuExposure(payload) {
    return api.post('/analytics/track/menu-view', payload).then((response) => response.data)
  },
  trackAddToCart(payload) {
    return api.post('/analytics/track/add-to-cart', payload).then((response) => response.data)
  },
}
