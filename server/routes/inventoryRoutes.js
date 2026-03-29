import { Router } from 'express'
import { body } from 'express-validator'
import { param } from 'express-validator'
import { query } from 'express-validator'
import {
  bootstrapInventoryStock,
  createInventoryConversion,
  createInventoryItem,
  createInventoryPurchase,
  createInventorySupplier,
  createInventoryWastage,
  deleteInventoryPurchaseItem,
  getInventoryAnalyticsOverview,
  getInventoryItemStock,
  listInventoryPurchaseRows,
  listInventoryItems,
  listRecipes,
  listInventorySuppliers,
  upsertRecipe,
  updateInventoryItemDefaultUnit,
  updateInventoryPurchaseItem,
} from '../controllers/inventoryController.js'
import {
  findOrdersWithInconsistencies,
  generateReconciliationReport,
  clearOrderInconsistencies,
  getViolationAnalytics,
} from '../services/inventoryReconciliationService.js'
import {
  getAllCircuitBreakerStatus,
  resetCircuitBreaker,
  resetAllCircuitBreakers,
} from '../services/circuitBreaker.js'
import { requireAuth } from '../middleware/auth.js'
import { requireOwner } from '../middleware/authorize.js'
import { requireActiveBilling } from '../middleware/billing.js'
import { validateRequest } from '../middleware/validateRequest.js'
import { cacheResponse } from '../services/responseCache.js'
import { logger } from '../utils/logger.js'

const router = Router()

router.use(requireAuth, requireActiveBilling)

router.get(
  '/suppliers',
  [
    query('q').optional().isString().trim().isLength({ max: 120 }),
    query('limit').optional().isInt({ min: 1, max: 500 }),
  ],
  validateRequest,
  cacheResponse({
    ttlSeconds: 30,
    keyBuilder: (req) => {
      const restaurantId = String(req.restaurant?._id || req.user?._id || '')
      const q = String(req.query?.q || '').trim().toLowerCase()
      const limit = Number(req.query?.limit || 250)
      return `inventory:suppliers:${restaurantId}:q:${q}:l:${limit}`
    },
    tagsBuilder: (req) => [
      `inventory:suppliers:${String(req.restaurant?._id || req.user?._id || '')}`,
    ],
  }),
  listInventorySuppliers,
)
router.post(
  '/suppliers',
  [
    body('name').isString().trim().isLength({ min: 2, max: 160 }),
    body('gstNo').optional().isString().trim().isLength({ max: 32 }),
    body('phone').optional().isString().trim().isLength({ max: 20 }),
    body('email').optional().isString().trim().isLength({ max: 160 }),
    body('address').optional().isString().trim().isLength({ max: 400 }),
  ],
  validateRequest,
  createInventorySupplier,
)

router.get(
  '/items',
  [
    query('q').optional().isString().trim().isLength({ max: 120 }),
    query('limit').optional().isInt({ min: 1, max: 500 }),
  ],
  validateRequest,
  cacheResponse({
    ttlSeconds: 30,
    keyBuilder: (req) => {
      const restaurantId = String(req.restaurant?._id || req.user?._id || '')
      const q = String(req.query?.q || '').trim().toLowerCase()
      const limit = Number(req.query?.limit || 250)
      return `inventory:items:${restaurantId}:q:${q}:l:${limit}`
    },
    tagsBuilder: (req) => [`inventory:items:${String(req.restaurant?._id || req.user?._id || '')}`],
  }),
  listInventoryItems,
)

router.get(
  '/analytics/overview',
  cacheResponse({
    ttlSeconds: 45,
    keyBuilder: (req) => {
      const restaurantId = String(req.restaurant?._id || req.user?._id || '')
      return `inventory:analytics:${restaurantId}`
    },
    tagsBuilder: (req) => [`inventory:analytics:${String(req.restaurant?._id || req.user?._id || '')}`],
  }),
  getInventoryAnalyticsOverview,
)

router.post(
  '/items',
  [
    body('name').isString().trim().isLength({ min: 2, max: 160 }),
    body('defaultUnit').optional().isIn(['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet']),
  ],
  validateRequest,
  createInventoryItem,
)

router.patch(
  '/items/:inventoryItemId/default-unit',
  [
    param('inventoryItemId').isMongoId(),
    body('defaultUnit').isIn(['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet']),
  ],
  validateRequest,
  updateInventoryItemDefaultUnit,
)

router.get(
  '/items/:inventoryItemId/stock',
  [param('inventoryItemId').isMongoId(), query('source').optional().isIn(['cache', 'ledger'])],
  validateRequest,
  getInventoryItemStock,
)

router.post(
  '/stock/bootstrap',
  [
    body('batchSize').optional().isInt({ min: 25, max: 1000 }),
    body('mode').optional().isIn(['bootstrap_only', 'reconcile_only', 'bootstrap_and_reconcile']),
  ],
  validateRequest,
  requireOwner,
  bootstrapInventoryStock,
)

router.get(
  '/recipes',
  cacheResponse({
    ttlSeconds: 30,
    keyBuilder: (req) => {
      const restaurantId = String(req.restaurant?._id || req.user?._id || '')
      return `inventory:recipes:${restaurantId}`
    },
    tagsBuilder: (req) => [`inventory:recipes:${String(req.restaurant?._id || req.user?._id || '')}`],
  }),
  listRecipes,
)
router.post(
  '/recipes',
  [
    body('menuItemId').isMongoId(),
    body('ingredients').isArray({ min: 1, max: 200 }),
    body('ingredients.*.inventoryItemId').isMongoId(),
    body('ingredients.*.quantity').isFloat({ min: 0.000001, max: 100000000 }),
    body('ingredients.*.unit').isIn(['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet', 'g', 'ml', 'unit']),
  ],
  validateRequest,
  upsertRecipe,
)

router.post(
  '/wastage',
  [
    body('inventoryItemId').isMongoId(),
    body('quantity').isFloat({ min: 0.000001, max: 100000000 }),
    body('unit').isIn(['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet', 'g', 'ml', 'unit']),
    body('reason').optional().isString().trim().isLength({ max: 280 }),
  ],
  validateRequest,
  createInventoryWastage,
)

router.post(
  '/convert',
  [
    body('fromInventoryItemId').isMongoId(),
    body('fromQuantity').isFloat({ min: 0.000001, max: 100000000 }),
    body('fromUnit').isIn(['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet', 'g', 'ml', 'unit']),
    body('toInventoryItemId').isMongoId(),
    body('toQuantity').isFloat({ min: 0.000001, max: 100000000 }),
    body('toUnit').isIn(['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet', 'g', 'ml', 'unit']),
    body('note').optional().isString().trim().isLength({ max: 280 }),
  ],
  validateRequest,
  createInventoryConversion,
)

router.post(
  '/purchases',
  [
    body('sourceType').isIn(['Supplier', 'Restaurant', 'Kitchen']),
    body('supplierId').optional({ values: 'falsy' }).isMongoId(),
    body('invoiceDate').isISO8601(),
    body('invoiceNumber').isString().trim().isLength({ min: 1, max: 80 }),
    body('gstNo').optional().isString().trim().isLength({ max: 32 }),
    body('cgstPercent').optional().isFloat({ min: 0, max: 100 }),
    body('sgstPercent').optional().isFloat({ min: 0, max: 100 }),
    body('igstPercent').optional().isFloat({ min: 0, max: 100 }),
    body('deliveryCharge').optional().isFloat({ min: 0, max: 100000000 }),
    body('discountType').optional().isIn(['Fixed', 'Percentage']),
    body('discountValue').optional().isFloat({ min: 0, max: 100000000 }),
    body('paymentType').optional().isIn(['Unpaid', 'Paid']),
    body('items').isArray({ min: 1, max: 200 }),
    body('items.*.itemId').isMongoId(),
    body('items.*.quantity').isFloat({ min: 0.0001, max: 100000000 }),
    body('items.*.unit').isIn(['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet']),
    body('items.*.rate').isFloat({ min: 0, max: 100000000 }),
  ],
  validateRequest,
  createInventoryPurchase,
)

router.get(
  '/purchases',
  [
    query('limit').optional().isInt({ min: 1, max: 300 }),
    query('paymentType').optional().isIn(['Unpaid', 'Paid']),
    query('sourceType').optional().isIn(['Supplier', 'Restaurant', 'Kitchen']),
  ],
  validateRequest,
  cacheResponse({
    ttlSeconds: 20,
    keyBuilder: (req) => {
      const restaurantId = String(req.restaurant?._id || req.user?._id || '')
      const limit = Number(req.query?.limit || 100)
      const paymentType = String(req.query?.paymentType || '').trim()
      const sourceType = String(req.query?.sourceType || '').trim()
      return `inventory:purchases:${restaurantId}:l:${limit}:p:${paymentType}:s:${sourceType}`
    },
    tagsBuilder: (req) => [`inventory:purchases:${String(req.restaurant?._id || req.user?._id || '')}`],
  }),
  listInventoryPurchaseRows,
)

router.patch(
  '/purchases/:purchaseId/items/:itemIndex',
  [
    param('purchaseId').isMongoId(),
    param('itemIndex').isInt({ min: 0, max: 999 }),
    body('quantity').optional().isFloat({ min: 0.0001, max: 100000000 }),
    body('rate').optional().isFloat({ min: 0, max: 100000000 }),
    body('unit').optional().isIn(['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet']),
    body('paymentType').optional().isIn(['Unpaid', 'Paid']),
  ],
  validateRequest,
  updateInventoryPurchaseItem,
)

router.delete(
  '/purchases/:purchaseId/items/:itemIndex',
  [param('purchaseId').isMongoId(), param('itemIndex').isInt({ min: 0, max: 999 })],
  validateRequest,
  deleteInventoryPurchaseItem,
)

// Monitoring endpoints
router.get(
  '/monitoring/circuit-breakers',
  requireAuth,
  requireOwner,
  (req, res) => {
    res.json({
      timestamp: new Date(),
      breakers: getAllCircuitBreakerStatus(),
    })
  },
)

router.post(
  '/monitoring/circuit-breakers/:name/reset',
  [param('name').isString().trim()],
  validateRequest,
  requireAuth,
  requireOwner,
  (req, res) => {
    try {
      resetCircuitBreaker(req.params.name)
      res.json({ success: true, message: `Circuit breaker ${req.params.name} reset` })
    } catch (error) {
      res.status(400).json({ error: error.message })
    }
  },
)

router.post(
  '/monitoring/circuit-breakers/reset-all',
  requireAuth,
  requireOwner,
  (req, res) => {
    try {
      resetAllCircuitBreakers()
      res.json({ success: true, message: 'All circuit breakers reset' })
    } catch (error) {
      res.status(400).json({ error: error.message })
    }
  },
)

// Reconciliation endpoints for inventory inconsistency detection
router.get(
  '/reconciliation/report',
  [query('limit').optional().isInt({ min: 1, max: 500 })],
  validateRequest,
  requireAuth,
  requireOwner, // Owner/admin only
  async (req, res) => {
    try {
      const restaurantId = req.restaurant?._id || req.user?._id
      if (!restaurantId) {
        return res.status(400).json({ error: 'Restaurant not found' })
      }

      const limit = Math.min(Number(req.query?.limit) || 50, 500)
      const report = await generateReconciliationReport(restaurantId, { limit })

      res.json(report)
    } catch (error) {
      logger.error('reconciliation_report_request_failed', {
        userId: String(req.user?._id || ''),
        restaurantId: String(req.restaurant?._id || ''),
        error: error.message,
      })
      res.status(500).json({ error: 'Failed to generate reconciliation report. Contact support.' })
    }
  },
)

router.get(
  '/reconciliation/violations-analytics',
  [query('daysBack').optional().isInt({ min: 1, max: 365 })],
  validateRequest,
  requireAuth,
  requireOwner, // Owner/admin only
  async (req, res) => {
    try {
      const restaurantId = req.restaurant?._id || req.user?._id
      if (!restaurantId) {
        return res.status(400).json({ error: 'Restaurant not found' })
      }

      const daysBack = Math.min(Number(req.query?.daysBack) || 30, 365)
      const analytics = await getViolationAnalytics(restaurantId, { daysBack })

      res.json(analytics)
    } catch (error) {
      logger.error('violation_analytics_request_failed', {
        userId: String(req.user?._id || ''),
        restaurantId: String(req.restaurant?._id || ''),
        error: error.message,
      })
      res.status(500).json({ error: 'Failed to retrieve violation analytics. Contact support.' })
    }
  },
)

router.get(
  '/reconciliation/orders',
  [query('limit').optional().isInt({ min: 1, max: 500 })],
  validateRequest,
  requireAuth,
  requireOwner, // Owner/admin only
  async (req, res) => {
    try {
      const restaurantId = req.restaurant?._id || req.user?._id
      if (!restaurantId) {
        return res.status(400).json({ error: 'Restaurant not found' })
      }

      const limit = Math.min(Number(req.query?.limit) || 100, 500)
      const orders = await findOrdersWithInconsistencies(restaurantId, { limit })

      res.json({ count: orders.length, orders })
    } catch (error) {
      logger.error('inconsistent_orders_request_failed', {
        userId: String(req.user?._id || ''),
        restaurantId: String(req.restaurant?._id || ''),
        error: error.message,
      })
      res.status(500).json({ error: 'Failed to retrieve inconsistent orders. Contact support.' })
    }
  },
)

router.post(
  '/reconciliation/orders/:orderId/clear',
  [param('orderId').isMongoId()],
  validateRequest,
  requireAuth,
  requireOwner, // Owner/admin only
  async (req, res) => {
    try {
      const restaurantId = req.restaurant?._id || req.user?._id
      if (!restaurantId) {
        return res.status(400).json({ error: 'Restaurant not found' })
      }

      const order = await clearOrderInconsistencies(req.params.orderId, restaurantId, req.user?._id)
      res.json({ success: true, order })
    } catch (error) {
      logger.error('clear_inconsistencies_request_failed', {
        userId: String(req.user?._id || ''),
        restaurantId: String(req.restaurant?._id || ''),
        orderId: req.params.orderId,
        error: error.message,
      })
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: 'Order not found' })
      }
      
      res.status(500).json({ error: 'Failed to clear inconsistencies. Contact support.' })
    }
  },
)

export default router
