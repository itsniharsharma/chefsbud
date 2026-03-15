import api from './api'

let razorpayScriptPromise = null

export function loadRazorpayCheckoutScript() {
  if (typeof window === 'undefined') {
    return Promise.resolve(false)
  }

  if (window.Razorpay) {
    return Promise.resolve(true)
  }

  if (razorpayScriptPromise) {
    return razorpayScriptPromise
  }

  razorpayScriptPromise = new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })

  return razorpayScriptPromise
}

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
  createRestaurantOrderIntent(payload) {
    return api.post('/payments/razorpay/order-intent', payload).then((response) => response.data)
  },
  confirmRestaurantCheckout(payload) {
    return api.post('/payments/razorpay/checkout/confirm', payload).then((response) => response.data)
  },
}
