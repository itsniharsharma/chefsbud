import InventoryItem from '../models/InventoryItem.js'
import InventoryPurchase from '../models/InventoryPurchase.js'
import InventorySupplier from '../models/InventorySupplier.js'
import { composePurchasePayload } from '../services/inventoryPurchaseService.js'
import { invalidateCacheByTags } from '../services/responseCache.js'
import { resolveRequestRestaurant } from '../utils/requestRestaurant.js'

const supplierProjection = '_id name gstNo phone email address isActive createdAt updatedAt'
const itemProjection = '_id name defaultUnit isActive createdAt updatedAt'
const purchaseProjection =
  '_id sourceType supplierId supplierNameSnapshot invoiceDate invoiceNumber gstNo cgstPercent sgstPercent igstPercent deliveryCharge discountType discountValue totalDiscountAmount paymentType items subtotalAmount taxableAmount cgstAmount sgstAmount igstAmount grandTotalAmount createdAt updatedAt'

function isValidDate(value) {
  const date = new Date(value)
  return !Number.isNaN(date.getTime())
}

function normalizeSearchTerm(value = '') {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseLimit(value, fallback = 250, max = 500) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, max)
}

export async function listInventorySuppliers(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const q = normalizeSearchTerm(req.query?.q)
    const limit = parseLimit(req.query?.limit)
    const query = {
      restaurantId: restaurant._id,
      isActive: true,
    }

    if (q) {
      query.normalizedName = { $regex: `^${escapeRegex(q)}` }
    }

    const suppliers = await InventorySupplier.find({
      ...query,
    })
      .sort({ name: 1 })
      .limit(limit)
      .select(supplierProjection)
      .lean()

    return res.json({ suppliers })
  } catch (error) {
    next(error)
  }
}

export async function createInventorySupplier(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const supplier = await InventorySupplier.create({
      restaurantId: restaurant._id,
      name: req.body.name,
      gstNo: req.body.gstNo || '',
      phone: req.body.phone || '',
      email: req.body.email || '',
      address: req.body.address || '',
    })

    try {
      await invalidateCacheByTags([`inventory:suppliers:${String(restaurant._id)}`])
    } catch (cacheError) {
      console.warn('[Inventory] Cache invalidation warning for suppliers:', cacheError.message)
    }

    return res.status(201).json(supplier)
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Supplier already exists' })
    }
    if (error?.name === 'ValidationError') {
      const messages = Object.entries(error.errors)
        .map(([field, err]) => `${field}: ${err.message}`)
        .join(', ')
      console.warn('[Inventory] Supplier validation error:', messages)
      return res.status(400).json({ message: `Validation failed: ${messages}` })
    }
    console.error('[Inventory] Error creating supplier:', error.message, error.stack)
    next(error)
  }
}

export async function listInventoryItems(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const q = normalizeSearchTerm(req.query?.q)
    const limit = parseLimit(req.query?.limit)
    const query = {
      restaurantId: restaurant._id,
      isActive: true,
    }

    if (q) {
      query.normalizedName = { $regex: `^${escapeRegex(q)}` }
    }

    const items = await InventoryItem.find({
      ...query,
    })
      .sort({ name: 1 })
      .limit(limit)
      .select(itemProjection)
      .lean()

    return res.json({ items })
  } catch (error) {
    next(error)
  }
}

export async function createInventoryItem(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const item = await InventoryItem.create({
      restaurantId: restaurant._id,
      name: req.body.name,
      defaultUnit: req.body.defaultUnit || 'Unit',
    })

    try {
      await invalidateCacheByTags([`inventory:items:${String(restaurant._id)}`])
    } catch (cacheError) {
      console.warn('[Inventory] Cache invalidation warning for items:', cacheError.message)
    }

    return res.status(201).json(item)
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Item already exists' })
    }
    if (error?.name === 'ValidationError') {
      const messages = Object.entries(error.errors)
        .map(([field, err]) => `${field}: ${err.message}`)
        .join(', ')
      console.warn('[Inventory] Item validation error:', messages)
      return res.status(400).json({ message: `Validation failed: ${messages}` })
    }
    console.error('[Inventory] Error creating item:', error.message, error.stack)
    next(error)
  }
}

export async function createInventoryPurchase(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const sourceType = String(req.body?.sourceType || '').trim()
    const supplierId = req.body?.supplierId ? String(req.body.supplierId) : ''
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : []

    if (!isValidDate(req.body?.invoiceDate)) {
      return res.status(400).json({ message: 'Valid invoice date is required' })
    }

    if (!String(req.body?.invoiceNumber || '').trim()) {
      return res.status(400).json({ message: 'Invoice number is required' })
    }

    if (!rawItems.length) {
      return res.status(400).json({ message: 'At least one purchase item is required' })
    }

    const uniqueItemIds = [...new Set(rawItems.map((row) => String(row?.itemId || '').trim()).filter(Boolean))]
    const items = await InventoryItem.find({
      restaurantId: restaurant._id,
      _id: { $in: uniqueItemIds },
      isActive: true,
    })
      .select('_id name defaultUnit')
      .lean()
    const itemById = new Map(items.map((item) => [String(item._id), item]))

    if (itemById.size !== uniqueItemIds.length) {
      return res.status(400).json({ message: 'One or more selected items are invalid' })
    }

    let supplier = null
    if (sourceType === 'Supplier') {
      if (!supplierId) {
        return res.status(400).json({ message: 'Supplier is required for source type Supplier' })
      }

      supplier = await InventorySupplier.findOne({
        restaurantId: restaurant._id,
        _id: supplierId,
        isActive: true,
      })
        .select('_id name')
        .lean()

      if (!supplier) {
        return res.status(400).json({ message: 'Selected supplier is invalid' })
      }
    }

    const composed = composePurchasePayload({
      payload: req.body,
      itemById,
      supplierName: supplier?.name || '',
    })

    const purchase = await InventoryPurchase.create({
      restaurantId: restaurant._id,
      sourceType: composed.sourceType,
      supplierId: supplier?._id || null,
      supplierNameSnapshot: composed.supplierNameSnapshot,
      invoiceDate: composed.invoiceDate,
      invoiceNumber: composed.invoiceNumber,
      gstNo: composed.gstNo,
      cgstPercent: composed.cgstPercent,
      sgstPercent: composed.sgstPercent,
      igstPercent: composed.igstPercent,
      deliveryCharge: composed.deliveryCharge,
      discountType: composed.discountType,
      discountValue: composed.discountValue,
      totalDiscountAmount: composed.totalDiscountAmount,
      paymentType: composed.paymentType,
      items: composed.items,
      subtotalAmount: composed.subtotalAmount,
      taxableAmount: composed.taxableAmount,
      cgstAmount: composed.cgstAmount,
      sgstAmount: composed.sgstAmount,
      igstAmount: composed.igstAmount,
      grandTotalAmount: composed.grandTotalAmount,
      createdByUserId: req.user?._id,
      createdByRole: req.user?.role === 'staff' ? 'staff' : 'owner',
    })

    const responsePayload = await InventoryPurchase.findOne({ _id: purchase._id })
      .select(purchaseProjection)
      .lean()

    return res.status(201).json(responsePayload)
  } catch (error) {
    next(error)
  }
}
