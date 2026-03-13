import { Router } from 'express'
import { body } from 'express-validator'
import {
	createOrder,
	deleteOrder,
	getOrders,
	getPublicTableOrders,
	getPublicOrderStatus,
	updateOrderStatus,
} from '../controllers/orderController.js'
import { requireAuth } from '../middleware/auth.js'
import { requireActiveBilling } from '../middleware/billing.js'
import { validateRequest } from '../middleware/validateRequest.js'

const router = Router()

router.post(
	'/',
	[
		body('restaurantSlug').isString().trim().isLength({ min: 1, max: 140 }),
		body('tableNumber').isInt({ min: 1, max: 500 }),
		body('items').isArray({ min: 1, max: 50 }),
		body('items.*.menuItemId').isString().trim().notEmpty(),
		body('items.*.quantity').optional().isInt({ min: 1, max: 100 }),
		body('paymentStatus').optional().isIn(['Paid', 'Unpaid']),
	],
	validateRequest,
	createOrder,
)
router.get('/track/:restaurantSlug/:tableNumber', getPublicTableOrders)
router.get('/track/:restaurantSlug/:tableNumber/:orderId', getPublicOrderStatus)
router.get('/:restaurantId', requireAuth, requireActiveBilling, getOrders)
router.patch(
	'/:orderId/status',
	requireAuth,
	requireActiveBilling,
	[
		body('orderStatus').isIn(['Pending', 'Preparing', 'Ready', 'Served', 'Completed']),
	],
	validateRequest,
	updateOrderStatus,
)
router.delete('/:orderId', requireAuth, requireActiveBilling, deleteOrder)

export default router
