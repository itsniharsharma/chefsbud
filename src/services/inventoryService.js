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
  listPurchaseRows(params = {}) {
    const sanitizedParams = {}
    const limit = Number(params?.limit)
    if (Number.isInteger(limit) && limit > 0) {
      sanitizedParams.limit = limit
    }

    const paymentType = String(params?.paymentType || '').trim()
    if (paymentType) {
      sanitizedParams.paymentType = paymentType
    }

    const sourceType = String(params?.sourceType || '').trim()
    if (sourceType) {
      sanitizedParams.sourceType = sourceType
    }

    return api.get('/inventory/purchases', { params: sanitizedParams }).then((response) => response.data)
  },
  updatePurchaseItemRow({ purchaseId, itemIndex, payload }) {
    return api
      .patch(`/inventory/purchases/${purchaseId}/items/${itemIndex}`, payload)
      .then((response) => response.data)
  },
  deletePurchaseItemRow({ purchaseId, itemIndex }) {
    return api
      .delete(`/inventory/purchases/${purchaseId}/items/${itemIndex}`)
      .then((response) => response.data)
  },
}
