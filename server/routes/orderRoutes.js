import { Router } from 'express'
import { body } from 'express-validator'
import {
	createOrder,
	deleteOrder,
	getOrders,
	markOrderBillPrinted,
	markOrderKotPrinted,
	getPublicTableOrders,
	getPublicOrderStatus,
	ratePublicOrder,
	shiftTableOrders,
	updateOrderStatus,
} from '../controllers/orderController.js'
import { requireAuth } from '../middleware/auth.js'
import { requireActiveBilling } from '../middleware/billing.js'
import { createRateLimiter } from '../middleware/rateLimit.js'
import { validateRequest } from '../middleware/validateRequest.js'
import { cacheResponse } from '../services/responseCache.js'

const router = Router()

const publicOrderRatingLimiter = createRateLimiter({
	id: 'orders-public-rating',
	capacity: Number(process.env.RATE_LIMIT_PUBLIC_ORDER_RATING_CAPACITY || 20),
	windowMs: Number(process.env.RATE_LIMIT_PUBLIC_ORDER_RATING_WINDOW_MS || 60_000),
	keyFn: (req) => req.ip,
})

router.post(
	'/',
	[
		body('restaurantSlug').isString().trim().isLength({ min: 1, max: 140 }),
		body('tableNumber').isInt({ min: 1, max: 500 }),
		body('floorNumber').optional().isInt({ min: 1, max: 500 }),
		body('items').isArray({ min: 1, max: 50 }),
		body('items.*.menuItemId').isString().trim().notEmpty(),
		body('items.*.quantity').optional().isInt({ min: 1, max: 100 }),
		body('couponCode').optional().isString().trim().isLength({ max: 40 }),
		body('customerNote').optional().isString().trim().isLength({ max: 500 }),
	],
	validateRequest,
	createOrder,
)
router.get(
	'/track/:restaurantSlug/:tableNumber',
	cacheResponse({
		ttlSeconds: 20,
		keyBuilder: (req) => `orders:table:${req.params.restaurantSlug}:${req.params.tableNumber}`,
		tagsBuilder: (req) => [`orders:table:${req.params.restaurantSlug}:${req.params.tableNumber}`],
	}),
	getPublicTableOrders,
)
router.get(
	'/track/:restaurantSlug/:tableNumber/:orderId',
	cacheResponse({
		ttlSeconds: 15,
		keyBuilder: (req) =>
			`orders:status:${req.params.restaurantSlug}:${req.params.tableNumber}:${req.params.orderId}`,
		tagsBuilder: (req) => [
			`orders:table:${req.params.restaurantSlug}:${req.params.tableNumber}`,
			`orders:order:${req.params.orderId}`,
		],
	}),
	getPublicOrderStatus,
)
router.post(
	'/track/:restaurantSlug/:tableNumber/:orderId/rating',
	publicOrderRatingLimiter,
	[
		body('rating').isInt({ min: 1, max: 5 }),
	],
	validateRequest,
	ratePublicOrder,
)
router.get(
	'/:restaurantId',
	requireAuth,
	requireActiveBilling,
	cacheResponse({
		ttlSeconds: 20,
		keyBuilder: (req) =>
			`orders:board:${req.user._id}:${req.params.restaurantId}:v:${req.query.view || 'active'}:s:${req.query.status || 'All'}:sc:${req.query.scope || 'all'}:f:${req.query.floorNumber || 'all'}`,
		tagsBuilder: (req) => [`orders:board:${req.params.restaurantId}`],
	}),
	getOrders,
)
router.patch(
	'/shift-table',
	requireAuth,
	requireActiveBilling,
	[
		body('sourceFloorNumber').isInt({ min: 1, max: 500 }),
		body('sourceTableNumber').isInt({ min: 1, max: 500 }),
		body('targetFloorNumber').isInt({ min: 1, max: 500 }),
		body('targetTableNumber').isInt({ min: 1, max: 500 }),
	],
	validateRequest,
	shiftTableOrders,
)
router.patch(
	'/:orderId/status',
	requireAuth,
	requireActiveBilling,
	[
		body('orderStatus').isIn(['Pending', 'Confirmed', 'Preparing', 'Ready', 'Served', 'Completed']),
	],
	validateRequest,
	updateOrderStatus,
)
router.patch(
	'/:orderId/kot-printed',
	requireAuth,
	requireActiveBilling,
	[
		body('reprintPasskey').optional().isString().isLength({ min: 6, max: 80 }),
		body('reprintReason').optional().isString().trim().isLength({ min: 3, max: 240 }),
	],
	validateRequest,
	markOrderKotPrinted,
)
router.patch(
	'/:orderId/bill-printed',
	requireAuth,
	requireActiveBilling,
	[
		body('billAdjustments').optional().isArray({ max: 50 }),
	],
	validateRequest,
	markOrderBillPrinted,
)
router.delete('/:orderId', requireAuth, requireActiveBilling, deleteOrder)

export default router
