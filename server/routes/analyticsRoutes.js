import { Router } from 'express'
import { body } from 'express-validator'
import {
  getAnalytics,
  getDecisionAnalytics,
  getDashboard,
  getAnalyticsIntegrity,
  trackPublicAddToCart,
  trackPublicMenuExposure,
} from '../controllers/analyticsController.js'
import { requireAuth } from '../middleware/auth.js'
import { requireOwner } from '../middleware/authorize.js'
import { requireActiveBilling } from '../middleware/billing.js'
import { requireAnalyticsEnabled } from '../middleware/featureAccess.js'
import { createRateLimiter } from '../middleware/rateLimit.js'
import { validateRequest } from '../middleware/validateRequest.js'
import { cacheResponse } from '../services/responseCache.js'

const router = Router()

const publicAnalyticsLimiter = createRateLimiter({
  id: 'analytics-public-track',
  capacity: Number(process.env.RATE_LIMIT_ANALYTICS_PUBLIC_CAPACITY || 180),
  windowMs: Number(process.env.RATE_LIMIT_ANALYTICS_PUBLIC_WINDOW_MS || 60_000),
  keyFn: (req) => req.ip,
})

router.get(
  '/dashboard/:restaurantId',
  requireAuth,
  requireActiveBilling,
  requireOwner,
  requireAnalyticsEnabled,
  cacheResponse({
    ttlSeconds: 120,
    keyBuilder: (req) => `analytics:dashboard:${req.user._id}:${req.params.restaurantId}`,
    tagsBuilder: (req) => [`analytics:${req.params.restaurantId}`],
  }),
  getDashboard,
)

router.get(
  '/decision/:restaurantId',
  requireAuth,
  requireActiveBilling,
  requireOwner,
  requireAnalyticsEnabled,
  cacheResponse({
    ttlSeconds: 60,
    keyBuilder: (req) =>
      `analytics:decision:${req.user._id}:${req.params.restaurantId}:range:${req.query.range || req.query.rangeDays || '14d'}`,
    tagsBuilder: (req) => [`analytics:${req.params.restaurantId}`],
  }),
  getDecisionAnalytics,
)

router.get(
  '/integrity/:restaurantId',
  requireAuth,
  requireActiveBilling,
  requireOwner,
  requireAnalyticsEnabled,
  getAnalyticsIntegrity,
)

router.get(
  '/:restaurantId',
  requireAuth,
  requireActiveBilling,
  requireOwner,
  requireAnalyticsEnabled,
  cacheResponse({
    ttlSeconds: 60,
    keyBuilder: (req) =>
      `analytics:detail:${req.user._id}:${req.params.restaurantId}:range:${req.query.range || req.query.rangeDays || '14d'}`,
    tagsBuilder: (req) => [`analytics:${req.params.restaurantId}`],
  }),
  getAnalytics,
)

router.post(
  '/track/menu-view',
  publicAnalyticsLimiter,
  [
    body('restaurantSlug').isString().trim().isLength({ min: 1, max: 140 }),
    body('sessionId').isString().trim().isLength({ min: 8, max: 120 }),
    body('eventId').optional().isString().trim().isLength({ min: 6, max: 220 }),
    body('menuItemIds').isArray({ min: 1, max: 50 }),
    body('menuItemIds.*').isMongoId(),
  ],
  validateRequest,
  trackPublicMenuExposure,
)

router.post(
  '/track/add-to-cart',
  publicAnalyticsLimiter,
  [
    body('restaurantSlug').isString().trim().isLength({ min: 1, max: 140 }),
    body('eventId').optional().isString().trim().isLength({ min: 6, max: 220 }),
    body('menuItemId').isMongoId(),
    body('quantity').optional().isInt({ min: 1, max: 20 }),
  ],
  validateRequest,
  trackPublicAddToCart,
)

export default router
