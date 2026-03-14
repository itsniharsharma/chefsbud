import { Router } from 'express'
import { createTables, getTables } from '../controllers/tableController.js'
import { requireAuth } from '../middleware/auth.js'
import { requireOwner } from '../middleware/authorize.js'
import { requireActiveBilling } from '../middleware/billing.js'

const router = Router()

router.post('/', requireAuth, requireActiveBilling, requireOwner, createTables)
router.get('/:restaurantId', requireAuth, requireActiveBilling, requireOwner, getTables)

export default router
