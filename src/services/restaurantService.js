import api from './api'

export const restaurantService = {
  getMine() {
    return api.get('/restaurants/me').then((response) => response.data)
  },
  updateMine(payload) {
    return api.put('/restaurants/me', payload).then((response) => response.data)
  },
  updateKotReprintConfig(payload) {
    return api.put('/restaurants/me/kot-reprint-config', payload).then((response) => response.data)
  },
  getPaymentConfig() {
    return api.get('/restaurants/me/payment-config').then((response) => response.data)
  },
  updatePaymentConfig(payload) {
    return api.put('/restaurants/me/payment-config', payload).then((response) => response.data)
  },
  listStaff() {
    return api.get('/restaurants/me/staff').then((response) => response.data)
  },
  createStaff(payload) {
    return api.post('/restaurants/me/staff', payload).then((response) => response.data)
  },
  deleteStaff(staffId) {
    return api.delete(`/restaurants/me/staff/${staffId}`).then((response) => response.data)
  },
  getBySlug(slug) {
    return api.get(`/restaurants/slug/${slug}`).then((response) => response.data)
  },
}
