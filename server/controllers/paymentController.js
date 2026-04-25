import User from '../models/User.js'
import BillingEvent from '../models/BillingEvent.js'
import { validationResult } from 'express-validator'
import {
  createCustomer,
  createSubscription,
  getSubscription,
  getRazorpayKeyId,
  listCustomers,
  verifySignature,
  verifyWebhookSignature,
} from '../services/razorpayService.js'
import { enqueueBillingStatusEmailJob } from '../services/orderOutboxService.js'
import {
  acquireWebhookLock,
  isWebhookProcessed,
  markWebhookProcessed,
  releaseWebhookLock,
} from '../services/webhookIdempotencyService.js'
import { logger } from '../utils/logger.js'
import { syncRestaurantFeatureEntitlementsForOwner } from '../services/planFeatureEntitlementService.js'

const HYBRID_SETUP_AMOUNT_PAISE = 1299900
const BILLING_GRACE_DAYS = Number(process.env.BILLING_GRACE_DAYS || 7)
const HYBRID_TOTAL_COUNT = Number(process.env.RAZORPAY_HYBRID_TOTAL_COUNT || 60)
const CUSTOMER_CACHE_MAX_ENTRIES = Number(process.env.RAZORPAY_CUSTOMER_CACHE_MAX || 500)
const CUSTOMER_LOOKUP_PAGE_SIZE = Math.max(1, Math.min(Number(process.env.RAZORPAY_CUSTOMER_LOOKUP_PAGE_SIZE || 100), 100))
const CUSTOMER_LOOKUP_MAX_PAGES = Math.max(1, Math.min(Number(process.env.RAZORPAY_CUSTOMER_LOOKUP_MAX_PAGES || 3), 50))
const SUBSCRIPTION_REUSE_STALE_MS = Math.max(5 * 60 * 1000, Number(process.env.RAZORPAY_SUBSCRIPTION_REUSE_STALE_MS || 45 * 60 * 1000))
const customerIdByEmailCache = new Map()
const BILLING_PLAN_CODE_CORE = 'core'
const BILLING_PLAN_CODE_PRO = 'pro'
const BILLING_CYCLE_MONTHLY = 'monthly'
const BILLING_CYCLE_YEARLY = 'yearly'

function getBillingPlanCatalog() {
  return {
    [BILLING_PLAN_CODE_CORE]: {
      code: BILLING_PLAN_CODE_CORE,
      name: 'Growth Plan',
      setupAmountPaise: HYBRID_SETUP_AMOUNT_PAISE,
      monthlyAmountPaise: 69900,
      featureHighlights: [
        'Owner dashboard with menu, orders, tables, and billing controls',
        'QR-based customer ordering with real-time order visibility',
        'AI-assisted menu setup with offer controls',
      ],
      billingCycles: {
        [BILLING_CYCLE_MONTHLY]: {
          cycle: BILLING_CYCLE_MONTHLY,
          planId: process.env.RAZORPAY_HYBRID_CORE_MONTHLY_PLAN_ID || '',
          recurringAmountPaise: 69900,
          recurringIntervalLabel: 'month',
          discountPercent: 0,
        },
        [BILLING_CYCLE_YEARLY]: {
          cycle: BILLING_CYCLE_YEARLY,
          planId: process.env.RAZORPAY_HYBRID_CORE_YEARLY_PLAN_ID || '',
          recurringAmountPaise: 713000,
          recurringIntervalLabel: 'year',
          discountPercent: 15,
        },
      },
    },
    [BILLING_PLAN_CODE_PRO]: {
      code: BILLING_PLAN_CODE_PRO,
      name: 'Scale Plan',
      setupAmountPaise: HYBRID_SETUP_AMOUNT_PAISE,
      monthlyAmountPaise: 129900,
      featureHighlights: [
        'Everything in Growth Plan',
        'Advanced analytics module',
        'Inventory management module',
      ],
      billingCycles: {
        [BILLING_CYCLE_MONTHLY]: {
          cycle: BILLING_CYCLE_MONTHLY,
          planId: process.env.RAZORPAY_HYBRID_PRO_MONTHLY_PLAN_ID || '',
          recurringAmountPaise: 129900,
          recurringIntervalLabel: 'month',
          discountPercent: 0,
        },
        [BILLING_CYCLE_YEARLY]: {
          cycle: BILLING_CYCLE_YEARLY,
          planId: process.env.RAZORPAY_HYBRID_PRO_YEARLY_PLAN_ID || '',
          recurringAmountPaise: 1247000,
          recurringIntervalLabel: 'year',
          discountPercent: 20,
        },
      },
    },
  }
}

function normalizePlanCode(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === BILLING_PLAN_CODE_CORE || normalized === BILLING_PLAN_CODE_PRO) {
    return normalized
  }
  return BILLING_PLAN_CODE_CORE
}

function normalizeBillingCycle(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === BILLING_CYCLE_YEARLY) {
    return BILLING_CYCLE_YEARLY
  }
  return BILLING_CYCLE_MONTHLY
}

function resolveSelectedPlan({ planCatalog, planCode, billingCycle }) {
  const selectedBasePlan = planCatalog?.[planCode]
  if (!selectedBasePlan) return null

  const selectedCycle = selectedBasePlan.billingCycles?.[billingCycle]
  if (!selectedCycle) return null

  const annualMonthlyEquivalentPaise = Number(selectedBasePlan.monthlyAmountPaise || 0) * 12
  const savedAmountPaise =
    billingCycle === BILLING_CYCLE_YEARLY
      ? Math.max(0, annualMonthlyEquivalentPaise - Number(selectedCycle.recurringAmountPaise || 0))
      : 0

  return {
    ...selectedBasePlan,
    billingCycle,
    planId: selectedCycle.planId,
    recurringAmountPaise: selectedCycle.recurringAmountPaise,
    recurringIntervalLabel: selectedCycle.recurringIntervalLabel,
    discountPercent: Number(selectedCycle.discountPercent || 0),
    savedAmountPaise,
  }
}

function isReusableSubscriptionStatus(status) {
  const normalized = String(status || '').trim().toLowerCase()
  return ['created', 'authenticated', 'active'].includes(normalized)
}

function isTerminalSubscriptionStatus(status) {
  const normalized = String(status || '').trim().toLowerCase()
  return ['cancelled', 'completed', 'expired', 'halted'].includes(normalized)
}

function isStaleCreatedSubscription(subscription) {
  const status = String(subscription?.status || '').trim().toLowerCase()
  if (status !== 'created' && status !== 'authenticated') {
    return false
  }

  const createdAtSeconds = Number(subscription?.created_at || 0)
  if (!Number.isFinite(createdAtSeconds) || createdAtSeconds <= 0) {
    return false
  }

  return Date.now() - createdAtSeconds * 1000 > SUBSCRIPTION_REUSE_STALE_MS
}

function buildPlanSummary(plan) {
  const setupAmountPaise = Number(plan?.setupAmountPaise || HYBRID_SETUP_AMOUNT_PAISE)
  const recurringAmountPaise = Number(plan?.recurringAmountPaise || plan?.monthlyAmountPaise || 0)
  return {
    setupAmountPaise,
    firstMonthAmountPaise: recurringAmountPaise,
    totalDueTodayPaise: setupAmountPaise + recurringAmountPaise,
    recurringAmountPaise,
    recurringIntervalLabel: plan?.recurringIntervalLabel || 'month',
    billingCycle: plan?.billingCycle || BILLING_CYCLE_MONTHLY,
    discountPercent: Number(plan?.discountPercent || 0),
    savedAmountPaise: Number(plan?.savedAmountPaise || 0),
  }
}

function buildCheckoutResponse({ subscriptionId, customerId, plan }) {
  return {
    keyId: getRazorpayKeyId(),
    subscriptionId,
    customerId: customerId || '',
    selectedPlan: {
      code: plan.code,
      name: plan.name,
      billingCycle: plan.billingCycle || BILLING_CYCLE_MONTHLY,
      recurringIntervalLabel: plan.recurringIntervalLabel || 'month',
      featureHighlights: Array.isArray(plan.featureHighlights) ? plan.featureHighlights : [],
    },
    planSummary: buildPlanSummary(plan),
  }
}

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
    patch['billing.status'] = 'cancelled'
    patch['billing.graceEndsAt'] = null
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
    const graceEndsAt = fallbackGraceDate
    patch['billing.status'] = 'past_due'
    patch['billing.graceEndsAt'] = graceEndsAt
    return patch
  }

  return null
}

function shouldNotifyStatus(nextStatus) {
  return ['grace_period', 'past_due', 'cancelled', 'active'].includes(nextStatus)
}

function normalizeId(value) {
  return String(value || '').trim()
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

  for (let page = 0; page < CUSTOMER_LOOKUP_MAX_PAGES; page += 1) {
    const response = await listCustomers({
      count: CUSTOMER_LOOKUP_PAGE_SIZE,
      skip: page * CUSTOMER_LOOKUP_PAGE_SIZE,
    })
    const items = Array.isArray(response?.items) ? response.items : []
    const found = items.find((item) => normalizeEmail(item?.email) === normalizedEmail) || null
    if (found?.id) {
      setCachedCustomerIdByEmail(normalizedEmail, found.id)
      return found
    }

    if (items.length < CUSTOMER_LOOKUP_PAGE_SIZE) {
      break
    }
  }

  return null
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

    return res.status(410).json({
      message: 'Legacy setup checkout is disabled. Use subscription activation flow instead.',
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

    return res.status(410).json({
      message: 'Legacy setup checkout verification is disabled. Use subscription activation flow instead.',
    })
  } catch (error) {
    next(error)
  }
}

export async function createHybridSubscription(req, res, next) {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() })
    }

    const planCatalog = getBillingPlanCatalog()
    const selectedPlanCode = normalizePlanCode(req.body?.planCode)
    const selectedBillingCycle = normalizeBillingCycle(req.body?.billingCycle)
    const selectedPlan = resolveSelectedPlan({
      planCatalog,
      planCode: selectedPlanCode,
      billingCycle: selectedBillingCycle,
    })
    const hybridPlanId = selectedPlan?.planId

    if (!hybridPlanId) {
      return res.status(500).json({
        message:
          selectedPlanCode === BILLING_PLAN_CODE_PRO
            ? selectedBillingCycle === BILLING_CYCLE_YEARLY
              ? 'RAZORPAY_HYBRID_PRO_YEARLY_PLAN_ID is missing in server environment'
              : 'RAZORPAY_HYBRID_PRO_MONTHLY_PLAN_ID is missing in server environment'
            : selectedBillingCycle === BILLING_CYCLE_YEARLY
              ? 'RAZORPAY_HYBRID_CORE_YEARLY_PLAN_ID is missing in server environment'
              : 'RAZORPAY_HYBRID_CORE_MONTHLY_PLAN_ID is missing in server environment',
      })
    }

    const user = await getUserOrThrow(req.user._id)
    const existingSubscriptionId = String(user.billing?.razorpaySubscriptionId || '').trim()

    if (existingSubscriptionId) {
      try {
        const existingSubscription = await getSubscription(existingSubscriptionId)
        const existingStatus = String(existingSubscription?.status || '').trim().toLowerCase()
        const existingPlanId = normalizeId(existingSubscription?.plan_id)
        const selectedPlanId = normalizeId(hybridPlanId)
        const planMismatch = Boolean(existingPlanId && selectedPlanId && existingPlanId !== selectedPlanId)

        if (planMismatch) {
          user.billing = {
            ...user.billing,
            status: user.billing?.status === 'active' ? 'active' : 'pending',
            razorpaySubscriptionId: '',
          }
          await user.save()
        }

        if (!planMismatch && isReusableSubscriptionStatus(existingStatus) && !isStaleCreatedSubscription(existingSubscription)) {
          return res.status(200).json(
            buildCheckoutResponse({
              subscriptionId: existingSubscriptionId,
              customerId: user.billing?.razorpayCustomerId,
              plan: selectedPlan,
            }),
          )
        }

        if (isTerminalSubscriptionStatus(existingStatus) || isStaleCreatedSubscription(existingSubscription)) {
          user.billing = {
            ...user.billing,
            status: user.billing?.status === 'active' ? 'active' : 'pending',
            razorpaySubscriptionId: '',
          }
          await user.save()
        }
      } catch (subscriptionError) {
        const statusCode = Number(subscriptionError?.statusCode || 0)
        if (statusCode === 404) {
          user.billing = {
            ...user.billing,
            status: user.billing?.status === 'active' ? 'active' : 'pending',
            razorpaySubscriptionId: '',
          }
          await user.save()
        } else {
          logger.warn('hybrid_subscription_lookup_failed', {
            userId: String(user._id),
            subscriptionId: existingSubscriptionId,
            message: subscriptionError?.message || 'subscription_lookup_failed',
          })
        }
      }
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
      addons: [
        {
          item: {
            name: "Chef's Bud setup fee",
            amount: HYBRID_SETUP_AMOUNT_PAISE,
            currency: 'INR',
          },
        },
      ],
      notes: {
        userId: String(user._id),
        plan: 'hybrid',
        planCode: selectedPlan.code,
        billingCycle: selectedPlan.billingCycle,
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
      planCode: selectedPlan.code,
      billingCycle: selectedPlan.billingCycle,
      status: 'pending',
      razorpayCustomerId: customerId,
      razorpaySubscriptionId: subscription.id,
    }
    await user.save()
    void syncRestaurantFeatureEntitlementsForOwner({
      ownerId: user._id,
      planCode: selectedPlan.code,
      source: 'subscription_create_pending',
    }).catch((error) => {
      logger.warn('restaurant_feature_entitlement_sync_failed', {
        userId: String(user._id || ''),
        planCode: selectedPlan.code,
        message: error?.message || 'restaurant feature entitlement sync failed',
      })
    })

    return res.status(201).json({
      ...buildCheckoutResponse({
        subscriptionId: subscription.id,
        customerId,
        plan: selectedPlan,
      }),
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
      planCode,
      billingCycle,
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

    const selectedPlanCode = normalizePlanCode(planCode)
    const selectedBillingCycle = normalizeBillingCycle(billingCycle)

    const user = await getUserOrThrow(req.user._id)
    user.billing = {
      ...user.billing,
      planType: 'hybrid',
      planCode: selectedPlanCode,
      billingCycle: selectedBillingCycle,
      status: 'active',
      setupPaymentId: paymentId,
      razorpaySubscriptionId: subscriptionId,
      activatedAt: new Date(),
      graceEndsAt: null,
      cancelledAt: null,
      lastBillingEventAt: new Date(),
    }

    await user.save()
    void syncRestaurantFeatureEntitlementsForOwner({
      ownerId: user._id,
      planCode: selectedPlanCode,
      source: 'subscription_verify_active',
    }).catch((error) => {
      logger.warn('restaurant_feature_entitlement_sync_failed', {
        userId: String(user._id || ''),
        planCode: selectedPlanCode,
        message: error?.message || 'restaurant feature entitlement sync failed',
      })
    })

    void enqueueBillingStatusEmailJob({
      to: user.email,
      name: user.name,
      status: user.billing.status,
      planType: user.billing.planType,
      graceEndsAt: user.billing.graceEndsAt,
      currentPeriodEnd: user.billing.currentPeriodEnd,
      eventKey: `EMAIL_BILLING_STATUS:${String(user.email || '').trim().toLowerCase()}:${String(user.billing?.status || '')}:${Date.now()}`,
    }).catch((mailError) => {
      logger.warn('subscription_activation_email_enqueue_failed', {
        userId: String(user._id),
        message: mailError?.message || 'Subscription activation email enqueue failed',
      })
    })

    return res.json({
      message: 'Subscription activated successfully',
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
      { returnDocument: 'after', projection: { email: 1, name: 1, billing: 1 } },
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
      void enqueueBillingStatusEmailJob({
        to: user.email,
        name: user.name,
        status: user.billing.status,
        planType: user.billing.planType,
        graceEndsAt: user.billing.graceEndsAt,
        currentPeriodEnd: user.billing.currentPeriodEnd,
        eventKey: `EMAIL_BILLING_STATUS:${String(providerEventId || '')}`,
      }).catch((mailError) => {
        logger.warn('billing_status_email_enqueue_failed', {
          userId: String(user._id),
          eventType,
          message: mailError?.message || 'Billing status email enqueue failed',
        })
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
