import { Router } from 'express'
import { body } from 'express-validator'
import {
  analyzeMenuWithAI,
  createCategory,
  createMenuItem,
  deleteMenuItem,
  getMenuBySlug,
  importMenuDraft,
  updateMenuItem,
} from '../controllers/menuController.js'
import { requireAuth } from '../middleware/auth.js'
import { requireActiveBilling } from '../middleware/billing.js'
import { cacheResponse } from '../services/responseCache.js'
import { validateRequest } from '../middleware/validateRequest.js'

const router = Router()

router.get(
  '/:restaurantSlug',
  cacheResponse({
    ttlSeconds: 120,
    keyBuilder: (req) => `menu:${req.params.restaurantSlug}`,
    tagsBuilder: (req) => [`menu:${req.params.restaurantSlug}`],
  }),
  getMenuBySlug,
)
router.post('/ai/analyze', requireAuth, requireActiveBilling, analyzeMenuWithAI)
router.post('/import-draft', requireAuth, requireActiveBilling, importMenuDraft)
router.post(
  '/category',
  requireAuth,
  requireActiveBilling,
  [
    body('name').isString().trim().isLength({ min: 1, max: 120 }),
    body('orderIndex').optional().isInt({ min: 0, max: 10000 }),
  ],
  validateRequest,
  createCategory,
)
router.post(
  '/item',
  requireAuth,
  requireActiveBilling,
  [
    body('categoryId').isMongoId(),
    body('name').isString().trim().isLength({ min: 1, max: 160 }),
    body('description').optional().isString().trim().isLength({ max: 2000 }),
    body('price').isFloat({ min: 0, max: 100000 }),
    body('available').optional().isBoolean(),
    body('isVeg').optional().isBoolean(),
    body('bestseller').optional().isBoolean(),
  ],
  validateRequest,
  createMenuItem,
)
router.put(
  '/item/:id',
  requireAuth,
  requireActiveBilling,
  [
    body('categoryId').optional().isMongoId(),
    body('name').optional().isString().trim().isLength({ min: 1, max: 160 }),
    body('description').optional().isString().trim().isLength({ max: 2000 }),
    body('price').optional().isFloat({ min: 0, max: 100000 }),
    body('available').optional().isBoolean(),
    body('isVeg').optional().isBoolean(),
    body('bestseller').optional().isBoolean(),
  ],
  validateRequest,
  updateMenuItem,
)
router.delete('/item/:id', requireAuth, requireActiveBilling, deleteMenuItem)

export default router
