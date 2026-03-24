import api from './api'

export const inventoryService = {
  listSuppliers() {
    return api.get('/inventory/suppliers').then((response) => response.data)
  },
  createSupplier(payload) {
    return api.post('/inventory/suppliers', payload).then((response) => response.data)
  },
  listItems() {
    return api.get('/inventory/items').then((response) => response.data)
  },
  createItem(payload) {
    return api.post('/inventory/items', payload).then((response) => response.data)
  },
  createPurchase(payload) {
    return api.post('/inventory/purchases', payload).then((response) => response.data)
  },
}
