import User from '../models/User.js'
import BillingEvent from '../models/BillingEvent.js'
import { validationResult } from 'express-validator'
import {
  createCustomer,
  createOrder,
  createSubscription,
  getRazorpayKeyId,
  listCustomers,
  verifySignature,
  verifyWebhookSignature,
} from '../services/razorpayService.js'
import { sendBillingStatusEmail } from '../services/emailService.js'
import {
  acquireWebhookLock,
  isWebhookProcessed,
  markWebhookProcessed,
  releaseWebhookLock,
} from '../services/webhookIdempotencyService.js'

const HYBRID_SETUP_AMOUNT_PAISE = 1000000
const BILLING_GRACE_DAYS = Number(process.env.BILLING_GRACE_DAYS || 3)
const HYBRID_TOTAL_COUNT = Number(process.env.RAZORPAY_HYBRID_TOTAL_COUNT || 60)
const CUSTOMER_CACHE_MAX_ENTRIES = Number(process.env.RAZORPAY_CUSTOMER_CACHE_MAX || 500)
const customerIdByEmailCache = new Map()

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function getCachedCustomerIdByEmail(email) {
  const key = normalizeEmail(email)
  if (!key) return ''
  return customerIdByEmailCache.get(key) || ''
}

function setCachedCustomerIdByEmail(email, customerId) {
  const key = normalizeEmail(email)
  const id = String(customerId || '').trim()
  if (!key || !id) return

  // Bound map size to avoid unbounded memory growth.
  if (customerIdByEmailCache.size >= CUSTOMER_CACHE_MAX_ENTRIES) {
    const firstKey = customerIdByEmailCache.keys().next().value
    if (firstKey) {
      customerIdByEmailCache.delete(firstKey)
    }
  }

  customerIdByEmailCache.set(key, id)
}

function toDateFromEpochSeconds(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null
  }
  return new Date(numeric * 1000)
}

function extractSubscriptionContext(payload = {}) {
  const subscription = payload?.subscription?.entity || null
  const invoice = payload?.invoice?.entity || null
  const payment = payload?.payment?.entity || null

  const subscriptionId =
    subscription?.id || invoice?.subscription_id || payment?.subscription_id || payment?.notes?.subscription_id || ''

  const currentPeriodEnd =
    toDateFromEpochSeconds(subscription?.current_end) || toDateFromEpochSeconds(invoice?.period_end) || null

  const cancelledAt =
    toDateFromEpochSeconds(subscription?.cancelled_at) ||
    toDateFromEpochSeconds(subscription?.ended_at) ||
    toDateFromEpochSeconds(invoice?.ended_at) ||
    null

  return {
    subscriptionId,
    currentPeriodEnd,
    cancelledAt,
    entityStatus: subscription?.status || invoice?.status || payment?.status || '',
  }
}

function computeBillingPatch(eventType, context) {
  const now = Date.now()
  const fallbackGraceDate = new Date(now + BILLING_GRACE_DAYS * 24 * 60 * 60 * 1000)
  const currentPeriodEnd = context.currentPeriodEnd

  const patch = {
    'billing.lastBillingEventAt': new Date(now),
    'billing.currentPeriodEnd': currentPeriodEnd,
  }

  if (eventType === 'subscription.cancelled' || eventType === 'subscription.paused' || eventType === 'subscription.completed') {
    const accessEnd = currentPeriodEnd && currentPeriodEnd.getTime() > now ? currentPeriodEnd : null
    patch['billing.status'] = accessEnd ? 'grace_period' : 'cancelled'
    patch['billing.graceEndsAt'] = accessEnd
    patch['billing.cancelledAt'] = context.cancelledAt || new Date(now)
    return patch
  }

  if (eventType === 'subscription.resumed' || eventType === 'invoice.paid' || eventType === 'payment.captured') {
    patch['billing.status'] = 'active'
    patch['billing.graceEndsAt'] = null
    patch['billing.cancelledAt'] = null
    return patch
  }

  if (eventType === 'invoice.payment_failed' || eventType === 'payment.failed') {
    const graceEndsAt =
      currentPeriodEnd && currentPeriodEnd.getTime() > now
        ? currentPeriodEnd
        : fallbackGraceDate
    patch['billing.status'] = 'past_due'
    patch['billing.graceEndsAt'] = graceEndsAt
    return patch
  }

  return null
}

function shouldNotifyStatus(nextStatus) {
  return ['grace_period', 'past_due', 'cancelled', 'active'].includes(nextStatus)
}

function buildReceipt(userId, type) {
  return `${type}_${String(userId).slice(-8)}_${Date.now()}`
}

async function resolveExistingCustomerByEmail(email) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    return null
  }

  const cachedId = getCachedCustomerIdByEmail(normalizedEmail)
  if (cachedId) {
    return { id: cachedId, email: normalizedEmail }
  }

  const response = await listCustomers({ count: 100 })
  const items = Array.isArray(response?.items) ? response.items : []
  const found = items.find((item) => normalizeEmail(item?.email) === normalizedEmail) || null
  if (found?.id) {
    setCachedCustomerIdByEmail(normalizedEmail, found.id)
  }
  return found
}

async function getUserOrThrow(userId) {
  const user = await User.findById(userId)
  if (!user) {
    const error = new Error('User not found')
    error.statusCode = 404
    throw error
  }
  return user
}

export async function createCheckout(req, res, next) {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() })
    }

    const { plan } = req.body
    if (plan !== 'hybrid') {
      return res.status(400).json({ message: 'Only hybrid plan is supported' })
    }

    const user = await getUserOrThrow(req.user._id)
    if (user.billing?.planType === 'hybrid' && user.billing?.status === 'setup_paid') {
      return res.status(409).json({
        message: 'Setup payment is already completed. Continue with autopay authorization.',
      })
    }

    const amount = HYBRID_SETUP_AMOUNT_PAISE
    const order = await createOrder({
      amount,
      currency: 'INR',
      receipt: buildReceipt(req.user._id, plan),
      notes: {
        userId: String(req.user._id),
        plan,
      },
    })

    return res.status(201).json({
      keyId: getRazorpayKeyId(),
      plan,
      amount,
      currency: 'INR',
      orderId: order.id,
    })
  } catch (error) {
    next(error)
  }
}

export async function verifyOrder(req, res, next) {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() })
    }

    const { plan, razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body

    if (plan !== 'hybrid' || !orderId || !paymentId || !signature) {
      return res.status(400).json({ message: 'Payment verification payload is incomplete' })
    }

    const valid = verifySignature({
      body: `${orderId}|${paymentId}`,
      signature,
    })

    if (!valid) {
      return res.status(400).json({ message: 'Invalid payment signature' })
    }

    const user = await getUserOrThrow(req.user._id)
    user.billing = {
      ...user.billing,
      planType: 'hybrid',
      status: 'setup_paid',
      setupPaymentId: paymentId,
    }

    await user.save()

    return res.json({
      message: 'Payment verified',
      billing: user.billing,
    })
  } catch (error) {
    next(error)
  }
}

export async function createHybridSubscription(req, res, next) {
  try {
    const hybridPlanId = process.env.RAZORPAY_HYBRID_MONTHLY_PLAN_ID
    if (!hybridPlanId) {
      return res.status(500).json({
        message: 'RAZORPAY_HYBRID_MONTHLY_PLAN_ID is missing in server environment',
      })
    }

    const user = await getUserOrThrow(req.user._id)

    if (user.billing?.planType !== 'hybrid' || user.billing?.status !== 'setup_paid') {
      return res.status(400).json({
        message: 'Pay setup amount before starting auto-payment subscription',
      })
    }

    if (user.billing?.razorpaySubscriptionId) {
      return res.status(200).json({
        keyId: getRazorpayKeyId(),
        subscriptionId: user.billing.razorpaySubscriptionId,
        customerId: user.billing?.razorpayCustomerId || '',
      })
    }

    let customerId = user.billing?.razorpayCustomerId
    if (!customerId) {
      customerId = getCachedCustomerIdByEmail(user.email)
    }
    if (!customerId) {
      try {
        const customer = await createCustomer({
          name: user.name,
          email: user.email,
          // Reuse existing Razorpay customer for the same merchant/email instead of failing.
          fail_existing: 0,
          notes: {
            userId: String(user._id),
          },
        })
        customerId = customer.id
        setCachedCustomerIdByEmail(user.email, customerId)
      } catch (error) {
        const message = String(error?.message || '').toLowerCase()
        const duplicateCustomer = message.includes('customer already exists')
        if (!duplicateCustomer) {
          throw error
        }

        const existingCustomer = await resolveExistingCustomerByEmail(user.email)
        if (!existingCustomer?.id) {
          throw error
        }

        customerId = existingCustomer.id
        setCachedCustomerIdByEmail(user.email, customerId)
      }
    }

    const totalCount = Number.isFinite(HYBRID_TOTAL_COUNT) && HYBRID_TOTAL_COUNT > 0 ? HYBRID_TOTAL_COUNT : 60

    const basePayload = {
      plan_id: hybridPlanId,
      customer_notify: 1,
      total_count: totalCount,
      notes: {
        userId: String(user._id),
        plan: 'hybrid',
      },
    }

    let subscription
    try {
      subscription = await createSubscription({
        ...basePayload,
        customer_id: customerId,
      })
    } catch (error) {
      // Some Razorpay accounts reject customer_id for subscription create.
      // Retry with a minimal payload to keep hybrid activation reliable.
      if (Number(error?.statusCode || error?.status) !== 400) {
        throw error
      }

      subscription = await createSubscription(basePayload)
    }

    user.billing = {
      ...user.billing,
      planType: 'hybrid',
      razorpayCustomerId: customerId,
      razorpaySubscriptionId: subscription.id,
    }
    await user.save()

    return res.status(201).json({
      keyId: getRazorpayKeyId(),
      subscriptionId: subscription.id,
      customerId,
    })
  } catch (error) {
    next(error)
  }
}

export async function verifyHybridSubscription(req, res, next) {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() })
    }

    const {
      razorpay_payment_id: paymentId,
      razorpay_subscription_id: subscriptionId,
      razorpay_signature: signature,
    } = req.body

    if (!paymentId || !subscriptionId || !signature) {
      return res.status(400).json({ message: 'Subscription verification payload is incomplete' })
    }

    const valid = verifySignature({
      body: `${paymentId}|${subscriptionId}`,
      signature,
    })

    if (!valid) {
      return res.status(400).json({ message: 'Invalid subscription signature' })
    }

    const user = await getUserOrThrow(req.user._id)
    user.billing = {
      ...user.billing,
      planType: 'hybrid',
      status: 'active',
      razorpaySubscriptionId: subscriptionId,
      activatedAt: new Date(),
    }

    await user.save()

    return res.json({
      message: 'Subscription verified',
      billing: user.billing,
    })
  } catch (error) {
    next(error)
  }
}

export async function handleRazorpayWebhook(req, res, next) {
  let providerEventId = ''
  let hasDistributedLock = false

  try {
    const signature = req.get('x-razorpay-signature')
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}))

    const isSignatureValid = verifyWebhookSignature({ rawBody, signature })
    if (!isSignatureValid) {
      return res.status(401).json({ message: 'Invalid webhook signature' })
    }

    const webhook = JSON.parse(rawBody.toString('utf8'))
    const eventType = String(webhook?.event || '').trim()
    const payload = webhook?.payload || {}
    const context = extractSubscriptionContext(payload)

    providerEventId =
      String(req.get('x-razorpay-event-id') || '').trim() ||
      `${eventType}:${context.subscriptionId || 'unknown'}:${String(webhook?.created_at || Date.now())}`

    if (await isWebhookProcessed(providerEventId)) {
      return res.status(200).json({ received: true, duplicate: true })
    }

    hasDistributedLock = await acquireWebhookLock(providerEventId)
    if (!hasDistributedLock) {
      return res.status(200).json({ received: true, processing: true })
    }

    try {
      await BillingEvent.create({
        provider: 'razorpay',
        providerEventId,
        eventType,
        subscriptionId: context.subscriptionId,
        metadata: {
          createdAtEpoch: Number(webhook?.created_at) || null,
          entityStatus: context.entityStatus,
        },
      })
    } catch (error) {
      if (error?.code === 11000) {
        await markWebhookProcessed(providerEventId)
        return res.status(200).json({ received: true, duplicate: true })
      }
      throw error
    }

    const patch = computeBillingPatch(eventType, context)
    if (!patch || !context.subscriptionId) {
      await BillingEvent.updateOne(
        { provider: 'razorpay', providerEventId },
        {
          $set: {
            processingStatus: 'ignored',
            processedAt: new Date(),
            failureReason: context.subscriptionId ? '' : 'subscription id missing in webhook payload',
          },
        },
      )
      await markWebhookProcessed(providerEventId)
      return res.status(200).json({ received: true, ignored: true })
    }

    const user = await User.findOneAndUpdate(
      { 'billing.razorpaySubscriptionId': context.subscriptionId },
      { $set: patch },
      { new: true, projection: { email: 1, name: 1, billing: 1 } },
    ).lean()

    if (!user) {
      await BillingEvent.updateOne(
        { provider: 'razorpay', providerEventId },
        {
          $set: {
            processingStatus: 'ignored',
            processedAt: new Date(),
            failureReason: 'no matching user for subscription id',
          },
        },
      )
      await markWebhookProcessed(providerEventId)
      return res.status(200).json({ received: true, ignored: true })
    }

    await BillingEvent.updateOne(
      { provider: 'razorpay', providerEventId },
      {
        $set: {
          processingStatus: 'processed',
          processedAt: new Date(),
          userId: user._id,
          failureReason: '',
        },
      },
    )

    if (shouldNotifyStatus(user?.billing?.status)) {
      void sendBillingStatusEmail({
        to: user.email,
        name: user.name,
        status: user.billing.status,
        planType: user.billing.planType,
        graceEndsAt: user.billing.graceEndsAt,
        currentPeriodEnd: user.billing.currentPeriodEnd,
      }).catch((mailError) => {
        console.error('Billing status email failed', mailError)
      })
    }

    await markWebhookProcessed(providerEventId)

    return res.status(200).json({ received: true, processed: true })
  } catch (error) {
    if (providerEventId) {
      await BillingEvent.updateOne(
        { provider: 'razorpay', providerEventId },
        {
          $set: {
            processingStatus: 'failed',
            processedAt: new Date(),
            failureReason: error.message || 'webhook processing failed',
          },
        },
      )
    }
    next(error)
  } finally {
    if (hasDistributedLock && providerEventId) {
      await releaseWebhookLock(providerEventId)
    }
  }
}
