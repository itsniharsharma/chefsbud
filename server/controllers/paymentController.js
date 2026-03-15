import User from '../models/User.js'
import Order from '../models/Order.js'
import BillingEvent from '../models/BillingEvent.js'
import RestaurantPaymentEvent from '../models/RestaurantPaymentEvent.js'
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
import { buildCustomerOrderDraft } from '../services/customerOrderService.js'
import { sendBillingStatusEmail } from '../services/emailService.js'
import { emitOrderChanged } from '../realtime/orderEvents.js'
import {
  createRazorpayOrderForRestaurant,
  isRestaurantPaymentConfigComplete,
  verifyRestaurantCheckoutSignature,
  verifyRestaurantWebhookSignature,
} from '../services/restaurantPaymentService.js'
import { invalidateCacheByTags } from '../services/responseCache.js'
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
  const value = customerIdByEmailCache.get(key) || ''
  if (value) {
    customerIdByEmailCache.delete(key)
    customerIdByEmailCache.set(key, value)
  }
  return value
}

function setCachedCustomerIdByEmail(email, customerId) {
  const key = normalizeEmail(email)
  const id = String(customerId || '').trim()
  if (!key || !id) return

  if (customerIdByEmailCache.has(key)) {
    customerIdByEmailCache.delete(key)
  }

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

function buildRestaurantOrderReceipt(orderId) {
  return `rest_order_${String(orderId).slice(-8)}_${Date.now()}`
}

async function markRestaurantOrderPaid({ order, providerPaymentId = '', paymentFailureReason = '' }) {
  if (!order) return null

  const update = {
    paymentStatus: 'Paid',
    orderStatus: order.orderStatus === 'Completed' ? 'Completed' : 'Confirmed',
    hiddenFromActive: false,
    deletedByOwnerAt: null,
    paymentProvider: 'razorpay',
    paymentFailureReason: paymentFailureReason ? String(paymentFailureReason) : '',
    paymentCapturedAt: new Date(),
  }

  if (providerPaymentId) {
    update.providerPaymentId = String(providerPaymentId)
  }

  const updatedOrder = await Order.findOneAndUpdate(
    { _id: order._id, restaurantId: order.restaurantId },
    { $set: update },
    { new: true, runValidators: true },
  )

  if (!updatedOrder) return null

  invalidateCacheByTags([
    `analytics:${String(updatedOrder.restaurantId)}`,
    `orders:board:${String(updatedOrder.restaurantId)}`,
    `orders:table:${order.restaurantSlug}:${updatedOrder.tableNumber}`,
    `orders:order:${String(updatedOrder._id)}`,
  ])
  emitOrderChanged(updatedOrder.restaurantId, {
    type: 'paid',
    orderId: String(updatedOrder._id),
    orderStatus: updatedOrder.orderStatus,
    paymentStatus: updatedOrder.paymentStatus,
  })

  return updatedOrder
}

async function markRestaurantOrderFailed({ order, paymentFailureReason = '' }) {
  if (!order || order.paymentStatus === 'Paid') return order

  await Order.updateOne(
    { _id: order._id, restaurantId: order.restaurantId },
    {
      $set: {
        paymentStatus: 'Failed',
        paymentFailureReason: String(paymentFailureReason || 'Payment failed'),
        hiddenFromActive: true,
        paymentProvider: 'razorpay',
      },
    },
  )

  return null
}

export async function createRestaurantRazorpayPaymentIntent(req, res, next) {
  let pendingOrder = null

  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() })
    }

    const { restaurantSlug, tableNumber, floorNumber, items, couponCode = '' } = req.body
    const draft = await buildCustomerOrderDraft({
      restaurantSlug,
      tableNumber,
      floorNumber,
      items,
      couponCode,
    })

    if (!isRestaurantPaymentConfigComplete(draft.restaurant.paymentConfig)) {
      return res.status(409).json({ message: 'This restaurant has not enabled online payments yet' })
    }

    pendingOrder = await Order.create({
      restaurantId: draft.restaurant._id,
      restaurantSlug: draft.restaurantSlug,
      floorNumber: draft.floorNumber,
      tableNumber: draft.tableNumber,
      items: draft.orderItems,
      subtotalAmount: draft.pricing.subtotalAmount,
      discountTotal: draft.pricing.discountTotal,
      appliedOffers: draft.pricing.appliedOffers,
      couponCode: draft.pricing.couponCodeApplied,
      totalAmount: draft.pricing.totalAmount,
      paymentProvider: 'razorpay',
      paymentStatus: 'Pending',
      orderStatus: 'Pending',
      hiddenFromActive: true,
    })

    const providerOrder = await createRazorpayOrderForRestaurant({
      restaurantId: draft.restaurant._id,
      amount: Math.round(Number(draft.pricing.totalAmount || 0) * 100),
      receipt: buildRestaurantOrderReceipt(pendingOrder._id),
      notes: {
        appOrderId: String(pendingOrder._id),
        restaurantId: String(draft.restaurant._id),
        restaurantSlug: draft.restaurant.slug,
        tableNumber: String(draft.tableNumber),
      },
    })

    pendingOrder.providerOrderId = providerOrder.order.id
    await pendingOrder.save()

    return res.status(201).json({
      orderId: pendingOrder._id,
      keyId: providerOrder.keyId,
      razorpayOrderId: providerOrder.order.id,
      amount: providerOrder.order.amount,
      currency: providerOrder.order.currency || 'INR',
      restaurantName: draft.restaurant.name,
      tableNumber: draft.tableNumber,
      floorNumber: draft.floorNumber,
    })
  } catch (error) {
    if (pendingOrder?._id) {
      await markRestaurantOrderFailed({
        order: pendingOrder,
        paymentFailureReason: error.message || 'Unable to initialize payment',
      })
    }
    next(error)
  }
}

export async function confirmRestaurantRazorpayCheckout(req, res, next) {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() })
    }

    const {
      orderId,
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
    } = req.body

    const order = await Order.findOne({
      _id: orderId,
      providerOrderId: razorpayOrderId,
      paymentProvider: 'razorpay',
    }).lean()
    if (!order || order.isArchived) {
      return res.status(404).json({ message: 'Order not found' })
    }

    if (order.paymentStatus === 'Paid') {
      return res.json({ success: true, duplicate: true, order })
    }

    const valid = await verifyRestaurantCheckoutSignature({
      restaurantId: order.restaurantId,
      body: `${razorpayOrderId}|${razorpayPaymentId}`,
      signature: razorpaySignature,
    })

    if (!valid) {
      return res.status(400).json({ message: 'Invalid payment signature' })
    }

    const updatedOrder = await markRestaurantOrderPaid({
      order,
      providerPaymentId: razorpayPaymentId,
    })

    return res.json({ success: true, order: updatedOrder })
  } catch (error) {
    next(error)
  }
}

export async function handleRestaurantRazorpayWebhook(req, res, next) {
  let providerEventId = ''
  let hasDistributedLock = false

  try {
    const signature = req.get('x-razorpay-signature')
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}))
    const webhook = JSON.parse(rawBody.toString('utf8'))
    const eventType = String(webhook?.event || '').trim()
    const payload = webhook?.payload || {}
    const paymentNotes = payload?.payment?.entity?.notes || {}
    const orderNotes = payload?.order?.entity?.notes || {}
    const notes = { ...orderNotes, ...paymentNotes }
    const notedRestaurantId = String(notes?.restaurantId || '').trim()
    const notedOrderId = String(notes?.appOrderId || '').trim()
    const providerOrderId =
      String(payload?.payment?.entity?.order_id || payload?.order?.entity?.id || payload?.payment_link?.entity?.order_id || '').trim()
    const providerPaymentId = String(payload?.payment?.entity?.id || '').trim()
    const paymentFailureReason =
      payload?.payment?.entity?.error_description || payload?.payment?.entity?.description || payload?.payment?.entity?.status || ''

    const verificationRestaurantId = notedRestaurantId

    if (!verificationRestaurantId || !notedOrderId || !providerOrderId) {
      return res.status(200).json({ received: true, ignored: true })
    }

    const isSignatureValid = await verifyRestaurantWebhookSignature({
      restaurantId: verificationRestaurantId,
      rawBody,
      signature,
    })

    if (!isSignatureValid) {
      return res.status(401).json({ message: 'Invalid webhook signature' })
    }

    const order = await Order.findOne({
      _id: notedOrderId,
      restaurantId: verificationRestaurantId,
      providerOrderId,
      paymentProvider: 'razorpay',
    })
      .select('_id restaurantId restaurantSlug tableNumber paymentStatus orderStatus providerOrderId')
      .lean()

    if (!order) {
      return res.status(200).json({ received: true, ignored: true })
    }

    providerEventId =
      String(req.get('x-razorpay-event-id') || '').trim() ||
      `${eventType}:${providerOrderId || 'unknown'}:${String(webhook?.created_at || Date.now())}`

    if (await isWebhookProcessed(providerEventId)) {
      return res.status(200).json({ received: true, duplicate: true })
    }

    hasDistributedLock = await acquireWebhookLock(providerEventId)
    if (!hasDistributedLock) {
      return res.status(200).json({ received: true, processing: true })
    }

    try {
      await RestaurantPaymentEvent.create({
        provider: 'razorpay',
        providerEventId,
        eventType,
        restaurantId: order.restaurantId,
        orderId: order._id,
        providerOrderId,
        providerPaymentId,
      })
    } catch (error) {
      if (error?.code === 11000) {
        await markWebhookProcessed(providerEventId)
        return res.status(200).json({ received: true, duplicate: true })
      }
      throw error
    }

    if (['payment.captured', 'order.paid'].includes(eventType)) {
      await markRestaurantOrderPaid({
        order,
        providerPaymentId,
      })

      await RestaurantPaymentEvent.updateOne(
        { provider: 'razorpay', providerEventId },
        { $set: { processingStatus: 'processed', processedAt: new Date(), failureReason: '' } },
      )
      await markWebhookProcessed(providerEventId)
      return res.status(200).json({ received: true, processed: true })
    }

    if (eventType === 'payment.failed') {
      await markRestaurantOrderFailed({ order, paymentFailureReason })
      await RestaurantPaymentEvent.updateOne(
        { provider: 'razorpay', providerEventId },
        { $set: { processingStatus: 'processed', processedAt: new Date(), failureReason: String(paymentFailureReason || '') } },
      )
      await markWebhookProcessed(providerEventId)
      return res.status(200).json({ received: true, processed: true })
    }

    await RestaurantPaymentEvent.updateOne(
      { provider: 'razorpay', providerEventId },
      { $set: { processingStatus: 'ignored', processedAt: new Date(), failureReason: '' } },
    )
    await markWebhookProcessed(providerEventId)
    return res.status(200).json({ received: true, ignored: true })
  } catch (error) {
    if (providerEventId) {
      await RestaurantPaymentEvent.updateOne(
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
