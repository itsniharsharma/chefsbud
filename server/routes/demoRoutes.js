import { Router } from 'express'
import { body } from 'express-validator'
import { bookDemo } from '../controllers/demoController.js'
import { validateRequest } from '../middleware/validateRequest.js'

const router = Router()

router.post(
  '/book',
  [
    body('fullName').isString().trim().isLength({ min: 2, max: 120 }),
    body('phoneNumber').isString().trim().matches(/^[+]?[0-9\s()-]{8,20}$/),
    body('restaurantName').isString().trim().isLength({ min: 2, max: 160 }),
    body('state').isString().trim().isLength({ min: 2, max: 120 }),
    body('city').isString().trim().isLength({ min: 2, max: 120 }),
    body('email').isEmail().normalizeEmail(),
    body('note').optional().isString().trim().isLength({ max: 800 }),
  ],
  validateRequest,
  bookDemo,
)

export default router
