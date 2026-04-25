import { Router } from 'express'
import { body } from 'express-validator'
import { requireAuth } from '../middleware/auth.js'
import { requireOwner } from '../middleware/authorize.js'
import {
  createCheckout,
  createHybridSubscription,
  handleRazorpayWebhook,
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

router.post('/webhook', webhookLimiter, handleRazorpayWebhook)

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

router.post(
  '/subscription/hybrid',
  requireAuth,
  requireOwner,
  paymentLimiter,
  [
    body('planCode').optional().isIn(['core', 'pro']).withMessage('planCode must be core or pro'),
    body('billingCycle').optional().isIn(['monthly', 'yearly']).withMessage('billingCycle must be monthly or yearly'),
  ],
  createHybridSubscription,
)

router.post(
  '/subscription/hybrid/verify',
  requireAuth,
  requireOwner,
  paymentLimiter,
  [
    body('razorpay_payment_id').notEmpty().withMessage('razorpay_payment_id is required'),
    body('razorpay_subscription_id').notEmpty().withMessage('razorpay_subscription_id is required'),
    body('razorpay_signature').notEmpty().withMessage('razorpay_signature is required'),
    body('planCode').optional().isIn(['core', 'pro']).withMessage('planCode must be core or pro'),
    body('billingCycle').optional().isIn(['monthly', 'yearly']).withMessage('billingCycle must be monthly or yearly'),
  ],
  verifyHybridSubscription,
)

export default router
