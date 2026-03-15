import api from './api'

export const paymentService = {
  createCheckout(plan) {
    return api.post('/payments/checkout', { plan }).then((response) => response.data)
  },
  verifyCheckout(payload) {
    return api.post('/payments/checkout/verify', payload).then((response) => response.data)
  },
  createHybridSubscription() {
    return api.post('/payments/subscription/hybrid').then((response) => response.data)
  },
  verifyHybridSubscription(payload) {
    return api.post('/payments/subscription/hybrid/verify', payload).then((response) => response.data)
  },
  createRazorpayMeIntent(payload) {
    return api.post('/payments/razorpay-me/intent', payload).then((response) => response.data)
  },
  confirmRazorpayMePayment(payload) {
    return api.post('/payments/razorpay-me/confirm', payload).then((response) => response.data)
  },
}
