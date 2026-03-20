import api from './api'

export const menuService = {
  getBySlug(slug) {
    return api.get(`/menu/${slug}`).then((response) => response.data)
  },
  getManagedMenu(restaurantId) {
    return api.get(`/menu/manage/${restaurantId}`).then((response) => response.data)
  },
  analyzeWithAI(payload) {
    return api.post('/menu/ai/analyze', payload).then((response) => response.data)
  },
  importDraft(payload) {
    return api.post('/menu/import-draft', payload).then((response) => response.data)
  },
  createCategory(payload) {
    return api.post('/menu/category', payload).then((response) => response.data)
  },
  createItem(payload) {
    return api.post('/menu/item', payload).then((response) => response.data)
  },
  updateItem(id, payload) {
    return api.put(`/menu/item/${id}`, payload).then((response) => response.data)
  },
  deleteItem(id) {
    return api.delete(`/menu/item/${id}`).then((response) => response.data)
  },
}
