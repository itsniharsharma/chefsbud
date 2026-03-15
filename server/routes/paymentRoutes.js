import { Router } from 'express'
import { body } from 'express-validator'
import { requireAuth } from '../middleware/auth.js'
import { requireOwner } from '../middleware/authorize.js'
import {
  confirmRestaurantRazorpayCheckout,
  createCheckout,
  createHybridSubscription,
  createRestaurantRazorpayPaymentIntent,
  handleRazorpayWebhook,
  handleRestaurantRazorpayWebhook,
  verifyHybridSubscription,
  verifyOrder,
} from '../controllers/paymentController.js'
import { createRateLimiter } from '../middleware/rateLimit.js'

const router = Router()

const webhookLimiter = createRateLimiter({
  id: 'payments-webhook',
  capacity: Number(process.env.RATE_LIMIT_WEBHOOK_CAPACITY || 180),
  windowMs: Number(process.env.RATE_LIMIT_WEBHOOK_WINDOW_MS || 60_000),
  keyFn: (req) => req.ip,
})

const paymentLimiter = createRateLimiter({
  id: 'payments-auth',
  capacity: Number(process.env.RATE_LIMIT_PAYMENTS_CAPACITY || 60),
  windowMs: Number(process.env.RATE_LIMIT_PAYMENTS_WINDOW_MS || 60_000),
  keyFn: (req) => req.user?._id || req.ip,
})

const publicPaymentLimiter = createRateLimiter({
  id: 'payments-public',
  capacity: Number(process.env.RATE_LIMIT_PUBLIC_PAYMENTS_CAPACITY || 40),
  windowMs: Number(process.env.RATE_LIMIT_PUBLIC_PAYMENTS_WINDOW_MS || 60_000),
  keyFn: (req) => req.ip,
})

router.post('/webhook', webhookLimiter, handleRazorpayWebhook)
router.post('/razorpay/webhook', webhookLimiter, handleRestaurantRazorpayWebhook)
router.post(
  '/razorpay/order-intent',
  publicPaymentLimiter,
  [
    body('restaurantSlug').isString().trim().isLength({ min: 1, max: 140 }),
    body('tableNumber').isInt({ min: 1, max: 500 }),
    body('floorNumber').optional().isInt({ min: 1, max: 500 }),
    body('items').isArray({ min: 1, max: 50 }),
    body('items.*.menuItemId').isString().trim().notEmpty(),
    body('items.*.quantity').optional().isInt({ min: 1, max: 100 }),
    body('couponCode').optional().isString().trim().isLength({ max: 40 }),
  ],
  createRestaurantRazorpayPaymentIntent,
)
router.post(
  '/razorpay/checkout/confirm',
  publicPaymentLimiter,
  [
    body('orderId').isString().trim().notEmpty(),
    body('razorpay_order_id').isString().trim().notEmpty(),
    body('razorpay_payment_id').isString().trim().notEmpty(),
    body('razorpay_signature').isString().trim().notEmpty(),
  ],
  confirmRestaurantRazorpayCheckout,
)

router.post(
  '/checkout',
  requireAuth,
  requireOwner,
  paymentLimiter,
  [body('plan').isIn(['hybrid']).withMessage('plan must be hybrid')],
  createCheckout,
)

router.post(
  '/checkout/verify',
  requireAuth,
  requireOwner,
  paymentLimiter,
  [
    body('plan').isIn(['hybrid']).withMessage('plan must be hybrid'),
    body('razorpay_order_id').notEmpty().withMessage('razorpay_order_id is required'),
    body('razorpay_payment_id').notEmpty().withMessage('razorpay_payment_id is required'),
    body('razorpay_signature').notEmpty().withMessage('razorpay_signature is required'),
  ],
  verifyOrder,
)

router.post('/subscription/hybrid', requireAuth, requireOwner, paymentLimiter, createHybridSubscription)

router.post(
  '/subscription/hybrid/verify',
  requireAuth,
  requireOwner,
  paymentLimiter,
  [
    body('razorpay_payment_id').notEmpty().withMessage('razorpay_payment_id is required'),
    body('razorpay_subscription_id').notEmpty().withMessage('razorpay_subscription_id is required'),
    body('razorpay_signature').notEmpty().withMessage('razorpay_signature is required'),
  ],
  verifyHybridSubscription,
)

export default router
