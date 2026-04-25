import api from './api'

export const paymentService = {
  createCheckout(plan) {
    return api.post('/payments/checkout', { plan }).then((response) => response.data)
  },
  verifyCheckout(payload) {
    return api.post('/payments/checkout/verify', payload).then((response) => response.data)
  },
  createHybridSubscription(planCode = 'core', billingCycle = 'monthly') {
    return api.post('/payments/subscription/hybrid', { planCode, billingCycle }).then((response) => response.data)
  },
  verifyHybridSubscription(payload, planCode = 'core', billingCycle = 'monthly') {
    return api.post('/payments/subscription/hybrid/verify', { ...payload, planCode, billingCycle }).then((response) => response.data)
  },
}
