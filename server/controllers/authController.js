import bcrypt from 'bcrypt'
import { randomInt } from 'crypto'
import jwt from 'jsonwebtoken'
import { validationResult } from 'express-validator'
import User from '../models/User.js'
import Restaurant from '../models/Restaurant.js'
import PendingRegistration from '../models/PendingRegistration.js'
import StaffAccount from '../models/StaffAccount.js'
import { sendRegistrationOtpEmail } from '../services/emailService.js'
import { uniqueSlug } from '../utils/slugify.js'

const OTP_EXPIRY_MINUTES = Number(process.env.EMAIL_OTP_EXPIRY_MINUTES || 10)
const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.EMAIL_OTP_RESEND_COOLDOWN_SECONDS || 60)
const OTP_MAX_ATTEMPTS = Number(process.env.EMAIL_OTP_MAX_ATTEMPTS || 5)
const OTP_MAX_RESENDS = Number(process.env.EMAIL_OTP_MAX_RESENDS || 8)
const PENDING_TTL_MINUTES = Number(process.env.REGISTRATION_PENDING_TTL_MINUTES || 60)

function normalizeGstin(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '').trim()
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function generateOtpCode() {
  return String(randomInt(100000, 1000000))
}

async function hashOtp(code) {
  return bcrypt.hash(String(code), 10)
}

function buildPendingExpiryDate() {
  return new Date(Date.now() + PENDING_TTL_MINUTES * 60 * 1000)
}

function buildOtpExpiryDate() {
  return new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)
}

function getResendWaitSeconds(lastCodeSentAt) {
  if (!lastCodeSentAt) {
    return 0
  }

  const elapsed = Math.floor((Date.now() - new Date(lastCodeSentAt).getTime()) / 1000)
  return Math.max(0, OTP_RESEND_COOLDOWN_SECONDS - elapsed)
}

function signToken(payload) {
  if (!process.env.JWT_SECRET) {
    const error = new Error('JWT_SECRET is not configured')
    error.statusCode = 500
    throw error
  }

  return jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  )
}

async function getOwnerRestaurant(ownerId) {
  return Restaurant.findOne({ ownerId }).lean()
}

function serializeUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified !== false,
    role: user.role,
    billing: user.billing,
  }
}

function serializeStaffSessionUser({ staff, owner }) {
  return {
    id: staff._id,
    name: staff.displayName || staff.username,
    email: owner.email,
    emailVerified: owner.emailVerified !== false,
    role: 'staff',
    billing: owner.billing,
    username: staff.username,
  }
}

export async function initiateRegistration(req, res, next) {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() })
    }

    const { name, email, password, restaurantName, address = '', phone = '', gstin } = req.body
    const normalizedEmail = normalizeEmail(email)
    const normalizedGstin = normalizeGstin(gstin)

    const [existing, existingGstin, pendingByGstin] = await Promise.all([
      User.findOne({ email: normalizedEmail }).select('_id').lean(),
      Restaurant.findOne({ gstin: normalizedGstin }).select('_id').lean(),
      PendingRegistration.findOne({ gstin: normalizedGstin }).select('email').lean(),
    ])

    if (existing) {
      return res.status(409).json({ message: 'Email is already in use' })
    }

    if (existingGstin) {
      return res.status(409).json({ message: 'GSTIN is already registered' })
    }

    if (pendingByGstin && pendingByGstin.email !== normalizedEmail) {
      return res.status(409).json({ message: 'GSTIN is already being verified with another email' })
    }

    const otpCode = generateOtpCode()
    const [hashedPassword, otpHash] = await Promise.all([bcrypt.hash(String(password), 10), hashOtp(otpCode)])

    const pendingPayload = {
      name,
      email: normalizedEmail,
      passwordHash: hashedPassword,
      restaurantName: restaurantName || `${name}'s Restaurant`,
      gstin: normalizedGstin,
      address,
      phone,
      otpHash,
      otpExpiresAt: buildOtpExpiryDate(),
      otpAttempts: 0,
      lastCodeSentAt: new Date(),
      expiresAt: buildPendingExpiryDate(),
    }

    await PendingRegistration.findOneAndUpdate(
      { email: normalizedEmail },
      { $set: pendingPayload, $setOnInsert: { resendCount: 0 } },
      { upsert: true, new: true, runValidators: true },
    )

    await sendRegistrationOtpEmail({
      to: normalizedEmail,
      code: otpCode,
      expiryMinutes: OTP_EXPIRY_MINUTES,
    })

    return res.status(200).json({
      message: 'Verification code sent to your email',
      email: normalizedEmail,
      expiresInMinutes: OTP_EXPIRY_MINUTES,
    })
  } catch (error) {
    if (error?.code === 11000) {
      const duplicateFields = {
        ...error?.keyPattern,
        ...error?.keyValue,
      }

      if ('gstin' in duplicateFields) {
        return res.status(409).json({ message: 'GSTIN is already registered' })
      }

      if ('email' in duplicateFields) {
        return res.status(409).json({ message: 'Email is already in use' })
      }

      if ('slug' in duplicateFields) {
        return res.status(409).json({ message: 'Restaurant slug already exists. Please try again.' })
      }
    }
    next(error)
  }
}

export async function resendRegistrationCode(req, res, next) {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() })
    }

    const normalizedEmail = normalizeEmail(req.body.email)
    const pending = await PendingRegistration.findOne({ email: normalizedEmail })

    if (!pending) {
      return res.status(404).json({ message: 'No pending verification found for this email' })
    }

    if (pending.resendCount >= OTP_MAX_RESENDS) {
      return res.status(429).json({ message: 'Resend limit reached. Start registration again.' })
    }

    const waitSeconds = getResendWaitSeconds(pending.lastCodeSentAt)
    if (waitSeconds > 0) {
      return res.status(429).json({ message: `Please wait ${waitSeconds}s before requesting another code` })
    }

    const otpCode = generateOtpCode()
    pending.otpHash = await hashOtp(otpCode)
    pending.otpExpiresAt = buildOtpExpiryDate()
    pending.lastCodeSentAt = new Date()
    pending.resendCount = Number(pending.resendCount || 0) + 1
    pending.otpAttempts = 0
    pending.expiresAt = buildPendingExpiryDate()
    await pending.save()

    await sendRegistrationOtpEmail({
      to: normalizedEmail,
      code: otpCode,
      expiryMinutes: OTP_EXPIRY_MINUTES,
    })

    return res.json({
      message: 'A new verification code was sent',
      email: normalizedEmail,
      expiresInMinutes: OTP_EXPIRY_MINUTES,
    })
  } catch (error) {
    next(error)
  }
}

export async function verifyRegistration(req, res, next) {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() })
    }

    const normalizedEmail = normalizeEmail(req.body.email)
    const otpCode = String(req.body.code || '').trim()
    const pending = await PendingRegistration.findOne({ email: normalizedEmail })

    if (!pending) {
      return res.status(400).json({ message: 'No pending verification found. Start registration again.' })
    }

    if (pending.otpAttempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many invalid attempts. Request a new verification code.' })
    }

    if (pending.otpExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ message: 'Verification code has expired. Request a new one.' })
    }

    const isOtpValid = await bcrypt.compare(otpCode, pending.otpHash)
    if (!isOtpValid) {
      pending.otpAttempts = Number(pending.otpAttempts || 0) + 1
      await pending.save()
      return res.status(400).json({ message: 'Invalid verification code' })
    }

    const existingUser = await User.findOne({ email: normalizedEmail }).lean()
    if (existingUser) {
      await PendingRegistration.deleteOne({ _id: pending._id })
      return res.status(409).json({ message: 'Email is already in use' })
    }

    const existingGstin = await Restaurant.findOne({ gstin: pending.gstin }).lean()
    if (existingGstin) {
      await PendingRegistration.deleteOne({ _id: pending._id })
      return res.status(409).json({ message: 'GSTIN is already registered' })
    }

    const user = await User.create({
      name: pending.name,
      email: pending.email,
      password: pending.passwordHash,
      emailVerified: true,
      role: 'owner',
    })

    const slug = await uniqueSlug(pending.restaurantName || `${pending.name} restaurant`, Restaurant)
    const restaurant = await Restaurant.create({
      name: pending.restaurantName || `${pending.name}'s Restaurant`,
      slug,
      gstin: pending.gstin,
      address: pending.address,
      phone: pending.phone,
      ownerId: user._id,
    })

    await PendingRegistration.deleteOne({ _id: pending._id })

    const token = signToken({
      userId: String(user._id || user.id),
      name: user.name,
      email: user.email,
      role: user.role,
      tokenVersion: Number(user.tokenVersion || 0),
    })
    return res.status(201).json({
      token,
      user: serializeUser(user),
      restaurant,
    })
  } catch (error) {
    if (error?.code === 11000) {
      const duplicateFields = {
        ...error?.keyPattern,
        ...error?.keyValue,
      }

      if ('gstin' in duplicateFields) {
        return res.status(409).json({ message: 'GSTIN is already registered' })
      }

      if ('email' in duplicateFields) {
        return res.status(409).json({ message: 'Email is already in use' })
      }
    }
    next(error)
  }
}

export async function login(req, res, next) {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() })
    }

    const { email, password } = req.body
    const normalizedEmail = normalizeEmail(email)
    const user = await User.findOne({ email: normalizedEmail })
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }

    if (typeof user.password !== 'string' || user.password.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }

    let valid = false
    try {
      valid = await bcrypt.compare(String(password || ''), user.password)
    } catch {
      valid = false
    }

    if (!valid) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }

    if (user.emailVerified === false) {
      return res.status(403).json({ message: 'Verify your email before logging in' })
    }

    const restaurant = await getOwnerRestaurant(user._id)
    const token = signToken({
      userId: String(user._id || user.id),
      name: user.name,
      email: user.email,
      role: user.role,
      tokenVersion: Number(user.tokenVersion || 0),
    })
    return res.json({
      token,
      user: serializeUser(user),
      restaurant,
    })
  } catch (error) {
    next(error)
  }
}

export async function staffLogin(req, res, next) {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() })
    }

    const username = String(req.body?.username || '').trim().toLowerCase()
    const passkey = String(req.body?.passkey || '')

    const staff = await StaffAccount.findOne({ username, isActive: true })
      .select('_id ownerId restaurantId username displayName passkeyHash isActive')
      .lean()

    if (!staff || !staff.passkeyHash) {
      return res.status(401).json({ message: 'Invalid username or passkey' })
    }

    const valid = await bcrypt.compare(passkey, staff.passkeyHash)
    if (!valid) {
      return res.status(401).json({ message: 'Invalid username or passkey' })
    }

    const [owner, restaurant] = await Promise.all([
      User.findById(staff.ownerId)
        .select('_id name email role emailVerified tokenVersion billing')
        .lean(),
      Restaurant.findById(staff.restaurantId).lean(),
    ])

    if (!owner || !restaurant) {
      return res.status(401).json({ message: 'Staff account configuration is invalid' })
    }

    if (owner.emailVerified === false) {
      return res.status(403).json({ message: 'Manager email is not verified' })
    }

    await StaffAccount.updateOne({ _id: staff._id }, { $set: { lastLoginAt: new Date() } })

    const token = signToken({
      userId: String(owner._id),
      ownerId: String(owner._id),
      staffId: String(staff._id),
      restaurantId: String(staff.restaurantId),
      name: staff.displayName || staff.username,
      email: owner.email,
      role: 'staff',
      tokenVersion: Number(owner.tokenVersion || 0),
    })

    return res.json({
      token,
      user: serializeStaffSessionUser({ staff, owner }),
      restaurant,
    })
  } catch (error) {
    next(error)
  }
}

export async function me(req, res, next) {
  try {
    if (req.user?.role === 'staff') {
      const restaurant = await Restaurant.findById(req.user.restaurantId).lean()
      if (!restaurant) {
        return res.status(401).json({ message: 'Unauthorized' })
      }

      return res.json({
        user: {
          id: req.user.staffId,
          name: req.user.staffDisplayName || req.user.staffUsername,
          email: req.user.email,
          emailVerified: req.user.emailVerified !== false,
          role: 'staff',
          billing: req.user.billing,
          username: req.user.staffUsername,
        },
        restaurant,
      })
    }

    const currentUser = await User.findById(req.user._id).lean()
    if (!currentUser) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    const restaurant = await getOwnerRestaurant(req.user._id)
    return res.json({
      user: serializeUser(currentUser),
      restaurant,
    })
  } catch (error) {
    next(error)
  }
}

export async function logout(req, res, next) {
  try {
    if (req.user?.role === 'staff') {
      return res.json({ message: 'Logged out' })
    }

    await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } })
    return res.json({ message: 'Logged out' })
  } catch (error) {
    next(error)
  }
}
