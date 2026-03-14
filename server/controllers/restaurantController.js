import Restaurant from '../models/Restaurant.js'
import StaffAccount from '../models/StaffAccount.js'
import bcrypt from 'bcrypt'
import { uniqueSlug } from '../utils/slugify.js'

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
    const restaurant = await Restaurant.findOne({ ownerId: req.user._id }).lean()
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }
    return res.json(restaurant)
  } catch (error) {
    next(error)
  }
}

export async function updateMyRestaurant(req, res, next) {
  try {
    const restaurant = await Restaurant.findOne({ ownerId: req.user._id })
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
    return res.json(restaurant)
  } catch (error) {
    next(error)
  }
}

export async function getRestaurantBySlug(req, res, next) {
  try {
    const restaurant = await Restaurant.findOne({ slug: req.params.restaurantSlug })
      .select('_id name slug address phone')
      .lean()
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    return res.json(restaurant)
  } catch (error) {
    next(error)
  }
}

export async function listMyStaffAccounts(req, res, next) {
  try {
    const restaurant = await Restaurant.findOne({ ownerId: req.user._id })
      .select('_id')
      .lean()
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
    const restaurant = await Restaurant.findOne({ ownerId: req.user._id })
      .select('_id')
      .lean()
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
    const restaurant = await Restaurant.findOne({ ownerId: req.user._id })
      .select('_id')
      .lean()
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
