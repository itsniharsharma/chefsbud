import axios from 'axios'
import crypto from 'crypto'
import Restaurant from '../models/Restaurant.js'
import { decryptSecret, encryptSecret } from './secretCrypto.js'

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1'
const RAZORPAY_TIMEOUT_MS = Math.max(1000, Number(process.env.RAZORPAY_TIMEOUT_MS || 10000))

function buildConfigError(message) {
  const error = new Error(message)
  error.statusCode = 409
  return error
}

function normalizeKeyId(value) {
  return String(value || '').trim()
}

function hasEncryptedSecret(value) {
  return Boolean(String(value || '').trim())
}

function isEncryptedPayload(value) {
  const encoded = String(value || '').trim()
  if (!encoded) return false
  const parts = encoded.split(':')
  if (parts.length !== 3) return false
  return parts.every((part) => /^[0-9a-f]+$/i.test(part))
}

function resolveSecretFromStorage(value) {
  const encoded = String(value || '').trim()
  if (!encoded) return ''

  if (!isEncryptedPayload(encoded)) {
    // Backward compatibility: allow pre-encryption plaintext values and migrate on save.
    return encoded
  }

  try {
    return decryptSecret(encoded)
  } catch {
    throw buildConfigError('Payment secrets are invalid. Please re-enter key secret and webhook secret.')
  }
}

function maskKeyId(value) {
  const normalized = normalizeKeyId(value)
  if (!normalized) return ''
  if (normalized.length <= 8) return normalized
  return `${normalized.slice(0, 4)}••••${normalized.slice(-4)}`
}

function verifySignatureWithSecret({ body, signature, secret }) {
  const normalizedSignature = String(signature || '').trim()
  const normalizedSecret = String(secret || '').trim()
  if (!normalizedSignature || !normalizedSecret) return false

  const expected = crypto.createHmac('sha256', normalizedSecret).update(body).digest('hex')
  if (expected.length !== normalizedSignature.length) return false

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalizedSignature))
}

function ensurePaymentConfigReady(paymentConfig = {}) {
  const keyId = normalizeKeyId(paymentConfig?.keyId)
  const keySecretEncrypted = String(paymentConfig?.keySecretEncrypted || '').trim()
  const webhookSecretEncrypted = String(paymentConfig?.webhookSecretEncrypted || '').trim()

  if (!paymentConfig?.enabled || paymentConfig?.provider !== 'razorpay' || !keyId || !keySecretEncrypted || !webhookSecretEncrypted) {
    throw buildConfigError('Restaurant online payments are not configured')
  }

  return {
    keyId,
    keySecret: resolveSecretFromStorage(keySecretEncrypted),
    webhookSecret: resolveSecretFromStorage(webhookSecretEncrypted),
  }
}

async function getRestaurantWithPaymentConfigById(restaurantId) {
  return Restaurant.findById(restaurantId)
    .select('+paymentConfig.keySecretEncrypted +paymentConfig.webhookSecretEncrypted name slug paymentConfig')
    .lean()
}

async function razorpayPostWithCredentials({ keyId, keySecret, path, payload }) {
  try {
    const response = await axios.post(`${RAZORPAY_API_BASE}${path}`, payload, {
      auth: {
        username: keyId,
        password: keySecret,
      },
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

export function isRestaurantPaymentConfigComplete(paymentConfig = {}) {
  return Boolean(
    paymentConfig?.enabled &&
      paymentConfig?.provider === 'razorpay' &&
      normalizeKeyId(paymentConfig?.keyId) &&
      hasEncryptedSecret(paymentConfig?.keySecretEncrypted) &&
      hasEncryptedSecret(paymentConfig?.webhookSecretEncrypted),
  )
}

export function serializeRestaurantPaymentConfig(paymentConfig = {}) {
  return {
    provider: paymentConfig?.provider || 'razorpay',
    enabled: Boolean(paymentConfig?.enabled),
    keyId: normalizeKeyId(paymentConfig?.keyId),
    maskedKeyId: maskKeyId(paymentConfig?.keyId),
    hasKeySecret: hasEncryptedSecret(paymentConfig?.keySecretEncrypted),
    hasWebhookSecret: hasEncryptedSecret(paymentConfig?.webhookSecretEncrypted),
    configuredAt: paymentConfig?.configuredAt || null,
    isReady: isRestaurantPaymentConfigComplete(paymentConfig),
  }
}

export function applyRestaurantPaymentConfig(restaurant, payload = {}) {
  if (!restaurant) return restaurant

  const current = restaurant.paymentConfig || { provider: 'razorpay', enabled: false }
  const nextEnabled = typeof payload.enabled === 'boolean' ? payload.enabled : Boolean(current.enabled)
  const nextKeyId = 'keyId' in payload ? normalizeKeyId(payload.keyId) : normalizeKeyId(current.keyId)

  const currentKeySecret = String(current.keySecretEncrypted || '').trim()
  const currentWebhookSecret = String(current.webhookSecretEncrypted || '').trim()
  const normalizedCurrentKeySecret =
    currentKeySecret && !isEncryptedPayload(currentKeySecret) ? encryptSecret(currentKeySecret) : currentKeySecret
  const normalizedCurrentWebhookSecret =
    currentWebhookSecret && !isEncryptedPayload(currentWebhookSecret) ? encryptSecret(currentWebhookSecret) : currentWebhookSecret

  const nextKeySecretEncrypted =
    'keySecret' in payload && String(payload.keySecret || '').trim()
      ? encryptSecret(payload.keySecret)
      : normalizedCurrentKeySecret || ''

  const nextWebhookSecretEncrypted =
    'webhookSecret' in payload && String(payload.webhookSecret || '').trim()
      ? encryptSecret(payload.webhookSecret)
      : normalizedCurrentWebhookSecret || ''

  restaurant.paymentConfig = {
    provider: 'razorpay',
    enabled: nextEnabled,
    keyId: nextKeyId,
    keySecretEncrypted: nextKeySecretEncrypted,
    webhookSecretEncrypted: nextWebhookSecretEncrypted,
    configuredAt: new Date(),
  }

  if (nextEnabled) {
    ensurePaymentConfigReady(restaurant.paymentConfig)
  }

  return restaurant
}

export async function createRazorpayOrderForRestaurant({ restaurantId, amount, receipt, notes = {} }) {
  const restaurant = await getRestaurantWithPaymentConfigById(restaurantId)
  if (!restaurant) {
    const error = new Error('Restaurant not found')
    error.statusCode = 404
    throw error
  }

  const { keyId, keySecret } = ensurePaymentConfigReady(restaurant.paymentConfig)
  const order = await razorpayPostWithCredentials({
    keyId,
    keySecret,
    path: '/orders',
    payload: {
      amount,
      currency: 'INR',
      receipt,
      notes,
    },
  })

  return {
    restaurant,
    keyId,
    order,
  }
}

export async function verifyRestaurantCheckoutSignature({ restaurantId, body, signature }) {
  const restaurant = await getRestaurantWithPaymentConfigById(restaurantId)
  if (!restaurant) return false
  const { keySecret } = ensurePaymentConfigReady(restaurant.paymentConfig)
  return verifySignatureWithSecret({ body, signature, secret: keySecret })
}

export async function verifyRestaurantWebhookSignature({ restaurantId, rawBody, signature }) {
  const restaurant = await getRestaurantWithPaymentConfigById(restaurantId)
  if (!restaurant) return false
  const { webhookSecret } = ensurePaymentConfigReady(restaurant.paymentConfig)
  return verifySignatureWithSecret({ body: rawBody, signature, secret: webhookSecret })
}
