import { Router } from 'express'
import {
  createMyStaffAccount,
  deleteMyStaffAccount,
  getMyRestaurant,
  getMyRestaurantPaymentConfig,
  getRestaurantBySlug,
  listMyStaffAccounts,
  updateMyKotReprintConfig,
  updateMyRestaurant,
  updateMyRestaurantPaymentConfig,
} from '../controllers/restaurantController.js'
import { requireAuth } from '../middleware/auth.js'
import { requireOwner } from '../middleware/authorize.js'
import { requireActiveBilling } from '../middleware/billing.js'

const router = Router()

router.get('/me', requireAuth, requireActiveBilling, requireOwner, getMyRestaurant)
router.put('/me', requireAuth, requireActiveBilling, requireOwner, updateMyRestaurant)
router.put('/me/kot-reprint-config', requireAuth, requireActiveBilling, requireOwner, updateMyKotReprintConfig)
router.get('/me/payment-config', requireAuth, requireActiveBilling, requireOwner, getMyRestaurantPaymentConfig)
router.put('/me/payment-config', requireAuth, requireActiveBilling, requireOwner, updateMyRestaurantPaymentConfig)
router.get('/me/staff', requireAuth, requireActiveBilling, requireOwner, listMyStaffAccounts)
router.post('/me/staff', requireAuth, requireActiveBilling, requireOwner, createMyStaffAccount)
router.delete('/me/staff/:staffId', requireAuth, requireActiveBilling, requireOwner, deleteMyStaffAccount)
router.get('/slug/:restaurantSlug', getRestaurantBySlug)

export default router
