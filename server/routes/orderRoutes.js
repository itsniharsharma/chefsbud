import { Router } from 'express'
import { body } from 'express-validator'
import {
	createOrder,
	deleteOrder,
	getOrders,
	markOrderKotPrinted,
	getPublicTableOrders,
	getPublicOrderStatus,
	updateOrderStatus,
} from '../controllers/orderController.js'
import { requireAuth } from '../middleware/auth.js'
import { requireActiveBilling } from '../middleware/billing.js'
import { validateRequest } from '../middleware/validateRequest.js'
import { cacheResponse } from '../services/responseCache.js'

const router = Router()

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
		ttlSeconds: 8,
		keyBuilder: (req) => `orders:table:${req.params.restaurantSlug}:${req.params.tableNumber}`,
		tagsBuilder: (req) => [`orders:table:${req.params.restaurantSlug}:${req.params.tableNumber}`],
	}),
	getPublicTableOrders,
)
router.get(
	'/track/:restaurantSlug/:tableNumber/:orderId',
	cacheResponse({
		ttlSeconds: 6,
		keyBuilder: (req) =>
			`orders:status:${req.params.restaurantSlug}:${req.params.tableNumber}:${req.params.orderId}`,
		tagsBuilder: (req) => [
			`orders:table:${req.params.restaurantSlug}:${req.params.tableNumber}`,
			`orders:order:${req.params.orderId}`,
		],
	}),
	getPublicOrderStatus,
)
router.get(
	'/:restaurantId',
	requireAuth,
	requireActiveBilling,
	cacheResponse({
		ttlSeconds: 10,
		keyBuilder: (req) =>
			`orders:board:${req.user._id}:${req.params.restaurantId}:v:${req.query.view || 'active'}:s:${req.query.status || 'All'}:sc:${req.query.scope || 'all'}`,
		tagsBuilder: (req) => [`orders:board:${req.params.restaurantId}`],
	}),
	getOrders,
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
router.patch('/:orderId/kot-printed', requireAuth, requireActiveBilling, markOrderKotPrinted)
router.delete('/:orderId', requireAuth, requireActiveBilling, deleteOrder)

export default router
