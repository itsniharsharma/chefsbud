import { Router } from 'express'
import { createTables, getTables } from '../controllers/tableController.js'
import { requireAuth } from '../middleware/auth.js'
import { requireOwner } from '../middleware/authorize.js'
import { requireActiveBilling } from '../middleware/billing.js'
import { cacheResponse } from '../services/responseCache.js'

const router = Router()

router.post('/', requireAuth, requireActiveBilling, requireOwner, createTables)
router.get(
	'/:restaurantId',
	requireAuth,
	requireActiveBilling,
	requireOwner,
	cacheResponse({
		ttlSeconds: 30,
		distributedCache: false,
		keyBuilder: (req) => `tables:${req.user._id}:${req.params.restaurantId}`,
		tagsBuilder: (req) => [`tables:${req.params.restaurantId}`],
	}),
	getTables,
)

export default router
