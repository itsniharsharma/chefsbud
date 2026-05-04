import { Router } from 'express'
import { body } from 'express-validator'
import {
  initiateRegistration,
  login,
  logout,
  me,
  resendRegistrationCode,
  staffLogin,
  updateOwnerCredentials,
  verifyRegistration,
} from '../controllers/authController.js'
import { requireAuth } from '../middleware/auth.js'
import { requireOwner } from '../middleware/authorize.js'
import { createRateLimiter } from '../middleware/rateLimit.js'

const router = Router()
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

const loginLimiter = createRateLimiter({
  id: 'auth-login',
  capacity: Number(process.env.RATE_LIMIT_LOGIN_CAPACITY || 12),
  windowMs: Number(process.env.RATE_LIMIT_LOGIN_WINDOW_MS || 60_000),
  keyFn: (req) => `${req.ip}:${String(req.body?.username || '').trim().toLowerCase()}`,
})

const staffLoginLimiter = createRateLimiter({
  id: 'auth-staff-login',
  capacity: Number(process.env.RATE_LIMIT_LOGIN_CAPACITY || 12),
  windowMs: Number(process.env.RATE_LIMIT_LOGIN_WINDOW_MS || 60_000),
  keyFn: (req) => `${req.ip}:${String(req.body?.username || '').trim().toLowerCase()}`,
})

const registerLimiter = createRateLimiter({
  id: 'auth-register',
  capacity: Number(process.env.RATE_LIMIT_REGISTER_CAPACITY || 8),
  windowMs: Number(process.env.RATE_LIMIT_REGISTER_WINDOW_MS || 60_000),
  keyFn: (req) => req.ip,
})

const otpLimiter = createRateLimiter({
  id: 'auth-otp',
  capacity: Number(process.env.RATE_LIMIT_OTP_CAPACITY || 6),
  windowMs: Number(process.env.RATE_LIMIT_OTP_WINDOW_MS || 60_000),
  keyFn: (req) => `${req.ip}:${String(req.body?.email || '').trim().toLowerCase()}`,
})

router.post(
  '/register/initiate',
  registerLimiter,
  [
    body('name').trim().notEmpty().withMessage('name is required'),
    body('username').isString().trim().isLength({ min: 3, max: 40 }).withMessage('username is required'),
    body('email').isEmail().withMessage('valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('password must be at least 6 characters'),
    body('restaurantName').optional().isString(),
    body('gstin')
      .trim()
      .notEmpty()
      .withMessage('gstin is required')
      .customSanitizer((value) => String(value || '').toUpperCase().replace(/\s+/g, ''))
      .matches(GSTIN_REGEX)
      .withMessage('valid gstin is required'),
  ],
  initiateRegistration,
)

router.post(
  '/register/verify',
  otpLimiter,
  [
    body('email').isEmail().withMessage('valid email is required'),
    body('code').trim().isLength({ min: 6, max: 6 }).withMessage('6 digit verification code is required'),
  ],
  verifyRegistration,
)

router.post('/register/resend-code', otpLimiter, [body('email').isEmail().withMessage('valid email is required')], resendRegistrationCode)

router.post(
  '/login',
  loginLimiter,
  [
    body('username')
      .isString()
      .trim()
      .isLength({ min: 3, max: 80 })
      .withMessage('Email or username must be between 3 and 80 characters')
      .custom((value) => {
        const normalizedUsername = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')
        const normalizedEmail = String(value || '').trim().toLowerCase()
        const isValidEmailFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
        const isValidUsernameFormat = normalizedUsername.length >= 3 && normalizedUsername.length <= 40

        if (!isValidEmailFormat && !isValidUsernameFormat) {
          throw new Error('Please enter a valid email address or username')
        }
        return true
      }),
    body('password').notEmpty().withMessage('Passkey is required'),
  ],
  login,
)

router.post(
  '/staff/login',
  staffLoginLimiter,
  [body('username').isString().trim().isLength({ min: 3, max: 40 }), body('passkey').isString().isLength({ min: 6, max: 80 })],
  staffLogin,
)

router.get('/me', requireAuth, me)
router.put(
  '/me/credentials',
  requireAuth,
  requireOwner,
  [
    body('username').optional().isString().trim().isLength({ min: 3, max: 40 }),
    body('passkey').optional().isString().isLength({ min: 6, max: 80 }),
  ],
  updateOwnerCredentials,
)
router.post('/logout', requireAuth, logout)

export default router
