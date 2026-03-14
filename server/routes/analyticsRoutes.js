import { Router } from 'express'
import { getDashboard } from '../controllers/analyticsController.js'
import { requireAuth } from '../middleware/auth.js'
import { requireOwner } from '../middleware/authorize.js'
import { requireActiveBilling } from '../middleware/billing.js'
import { cacheResponse } from '../services/responseCache.js'

const router = Router()

router.get(
	'/dashboard/:restaurantId',
	requireAuth,
	requireActiveBilling,
	requireOwner,
	cacheResponse({
		ttlSeconds: 60,
		keyBuilder: (req) => `analytics:dashboard:${req.user._id}:${req.params.restaurantId}`,
		tagsBuilder: (req) => [`analytics:${req.params.restaurantId}`],
	}),
	getDashboard,
)
/* Analytics detail route — disabled until AWS data pipeline is ready
router.get(
	'/:restaurantId',
	requireAuth,
	requireActiveBilling,
	cacheResponse({
		ttlSeconds: 60,
		keyBuilder: (req) => `analytics:detail:${req.user._id}:${req.params.restaurantId}`,
		tagsBuilder: (req) => [`analytics:${req.params.restaurantId}`],
	}),
	getAnalytics,
)
*/

export default router
