import Restaurant from '../models/Restaurant.js'
import StaffAccount from '../models/StaffAccount.js'
import bcrypt from 'bcrypt'
import {
  applyRestaurantPaymentConfig,
  isRestaurantPaymentConfigComplete,
  serializeRestaurantPaymentConfig,
} from '../services/restaurantPaymentService.js'
import { uniqueSlug } from '../utils/slugify.js'
import { resolveRequestRestaurant } from '../utils/requestRestaurant.js'

function serializeRestaurantForOwner(restaurant) {
  if (!restaurant) return null

  const source = typeof restaurant.toObject === 'function' ? restaurant.toObject() : restaurant
  return {
    ...source,
    hasKotReprintPasskey: Boolean(source?.kotReprintConfig?.passkeyHash),
    kotReprintConfig: {
      updatedAt: source?.kotReprintConfig?.updatedAt || null,
    },
    paymentConfig: serializeRestaurantPaymentConfig(source.paymentConfig),
  }
}

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
}

function serializeStaffAccount(staff) {
  return {
    id: staff._id,
    username: staff.username,
    displayName: staff.displayName || '',
    isActive: Boolean(staff.isActive),
    lastLoginAt: staff.lastLoginAt,
    createdAt: staff.createdAt,
  }
}

export async function getMyRestaurant(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }
    return res.json(serializeRestaurantForOwner(restaurant))
  } catch (error) {
    next(error)
  }
}

export async function updateMyRestaurant(req, res, next) {
  try {
    const currentRestaurant = await resolveRequestRestaurant(req)
    if (!currentRestaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const restaurant = await Restaurant.findById(currentRestaurant._id)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const { name, address, phone } = req.body

    if (typeof name === 'string' && name.trim() && name.trim() !== restaurant.name) {
      restaurant.name = name.trim()
      restaurant.slug = await uniqueSlug(name, Restaurant)
    }

    if (typeof address === 'string') restaurant.address = address
    if (typeof phone === 'string') restaurant.phone = phone

    await restaurant.save()
    return res.json(serializeRestaurantForOwner(restaurant))
  } catch (error) {
    next(error)
  }
}

export async function updateMyKotReprintConfig(req, res, next) {
  try {
    const currentRestaurant = await resolveRequestRestaurant(req)
    if (!currentRestaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const restaurant = await Restaurant.findById(currentRestaurant._id)
      .select('kotReprintConfig paymentConfig name slug address phone ownerId')
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const passkey = String(req.body?.passkey || '').trim()
    if (passkey.length < 6 || passkey.length > 80) {
      return res.status(400).json({ message: 'KOT reprint passkey must be between 6 and 80 characters.' })
    }

    restaurant.kotReprintConfig = {
      passkeyHash: await bcrypt.hash(passkey, 10),
      updatedAt: new Date(),
    }

    await restaurant.save()
    return res.json(serializeRestaurantForOwner(restaurant))
  } catch (error) {
    next(error)
  }
}

export async function getRestaurantBySlug(req, res, next) {
  try {
    const restaurant = await Restaurant.findOne({ slug: req.params.restaurantSlug })
      .select('name slug address phone paymentConfig')
      .lean()
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    return res.json({
      _id: restaurant._id,
      name: restaurant.name,
      slug: restaurant.slug,
      address: restaurant.address,
      phone: restaurant.phone,
      acceptsOnlinePayments: isRestaurantPaymentConfigComplete(restaurant.paymentConfig),
    })
  } catch (error) {
    next(error)
  }
}

export async function getMyRestaurantPaymentConfig(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    return res.json(serializeRestaurantPaymentConfig(restaurant.paymentConfig))
  } catch (error) {
    next(error)
  }
}

export async function updateMyRestaurantPaymentConfig(req, res, next) {
  try {
    const currentRestaurant = await resolveRequestRestaurant(req)
    if (!currentRestaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const restaurant = await Restaurant.findById(currentRestaurant._id)
      .select('paymentConfig')
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    applyRestaurantPaymentConfig(restaurant, {
      enabled: req.body?.enabled,
      razorpayMeLink: req.body?.razorpayMeLink,
    })

    await restaurant.save()
    return res.json(serializeRestaurantPaymentConfig(restaurant.paymentConfig))
  } catch (error) {
    next(error)
  }
}

export async function listMyStaffAccounts(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const staffAccounts = await StaffAccount.find({
      ownerId: req.user._id,
      restaurantId: restaurant._id,
      isActive: true,
    })
      .select('_id username displayName isActive lastLoginAt createdAt')
      .sort({ createdAt: -1 })
      .lean()

    return res.json(staffAccounts.map(serializeStaffAccount))
  } catch (error) {
    next(error)
  }
}

export async function createMyStaffAccount(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const username = normalizeUsername(req.body?.username)
    const passkey = String(req.body?.passkey || '')
    const displayName = String(req.body?.displayName || '').trim()

    if (username.length < 3 || username.length > 40) {
      return res.status(400).json({ message: 'Username must be between 3 and 40 characters.' })
    }

    if (passkey.length < 6 || passkey.length > 80) {
      return res.status(400).json({ message: 'Passkey must be between 6 and 80 characters.' })
    }

    const passkeyHash = await bcrypt.hash(passkey, 10)

    const staff = await StaffAccount.create({
      ownerId: req.user._id,
      restaurantId: restaurant._id,
      username,
      displayName,
      passkeyHash,
      isActive: true,
      createdBy: req.user._id,
    })

    return res.status(201).json(serializeStaffAccount(staff))
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Username already exists. Choose a different username.' })
    }
    next(error)
  }
}

export async function deleteMyStaffAccount(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const deleted = await StaffAccount.findOneAndDelete({
      _id: req.params.staffId,
      ownerId: req.user._id,
      restaurantId: restaurant._id,
    }).lean()

    if (!deleted) {
      return res.status(404).json({ message: 'Staff account not found' })
    }

    return res.json({ success: true })
  } catch (error) {
    next(error)
  }
}
