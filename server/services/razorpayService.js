import axios from 'axios'
import crypto from 'crypto'

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1'
const RAZORPAY_TIMEOUT_MS = Math.max(1000, Number(process.env.RAZORPAY_TIMEOUT_MS || 10000))

function getRazorpayAuth() {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET

  if (!keyId || !keySecret) {
    const error = new Error('Razorpay keys are not configured')
    error.statusCode = 500
    throw error
  }

  return {
    keyId,
    auth: {
      username: keyId,
      password: keySecret,
    },
  }
}

async function razorpayPost(path, payload) {
  const { auth } = getRazorpayAuth()
  try {
    const response = await axios.post(`${RAZORPAY_API_BASE}${path}`, payload, {
      auth,
      timeout: RAZORPAY_TIMEOUT_MS,
    })
    return response.data
  } catch (error) {
    const statusCode = Number(error?.response?.status || error?.status || 500)
    const providerMessage =
      error?.response?.data?.error?.description ||
      error?.response?.data?.error?.reason ||
      error?.response?.data?.error?.code ||
      error?.response?.data?.message ||
      error?.message ||
      'Razorpay request failed'

    const normalized = new Error(providerMessage)
    normalized.statusCode = statusCode
    throw normalized
  }
}

async function razorpayGet(path, params = {}) {
  const { auth } = getRazorpayAuth()
  try {
    const response = await axios.get(`${RAZORPAY_API_BASE}${path}`, {
      auth,
      params,
      timeout: RAZORPAY_TIMEOUT_MS,
    })
    return response.data
  } catch (error) {
    const statusCode = Number(error?.response?.status || error?.status || 500)
    const providerMessage =
      error?.response?.data?.error?.description ||
      error?.response?.data?.error?.reason ||
      error?.response?.data?.error?.code ||
      error?.response?.data?.message ||
      error?.message ||
      'Razorpay request failed'

    const normalized = new Error(providerMessage)
    normalized.statusCode = statusCode
    throw normalized
  }
}

export function getRazorpayKeyId() {
  const { keyId } = getRazorpayAuth()
  return keyId
}

export function verifySignature({ body, signature }) {
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keySecret) {
    return false
  }
  const expected = crypto.createHmac('sha256', keySecret).update(body).digest('hex')
  return expected === signature
}

export function verifyWebhookSignature({ rawBody, signature }) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET
  if (!webhookSecret || !signature) {
    return false
  }

  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex')
  const received = String(signature).trim()

  if (expected.length !== received.length) {
    return false
  }

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))
}

export function createOrder(payload) {
  return razorpayPost('/orders', payload)
}

export function createCustomer(payload) {
  return razorpayPost('/customers', payload)
}

export function listCustomers(params = {}) {
  return razorpayGet('/customers', params)
}

export function createSubscription(payload) {
  return razorpayPost('/subscriptions', payload)
}
