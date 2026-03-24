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

function sanitizeEnum(value, allowed = [], fallback = '') {
  const normalized = String(value || '').trim()
  return allowed.includes(normalized) ? normalized : fallback
}

function toObjectId(value) {
  return String(value || '').trim()
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

    try {
      await invalidateCacheByTags([`inventory:purchases:${String(restaurant._id)}`])
    } catch (cacheError) {
      console.warn('[Inventory] Cache invalidation warning for purchases:', cacheError.message)
    }

    return res.status(201).json(responsePayload)
  } catch (error) {
    next(error)
  }
}

export async function listInventoryPurchaseRows(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const limit = parseLimit(req.query?.limit, 100, 300)
    const paymentType = sanitizeEnum(req.query?.paymentType, ['Unpaid', 'Paid'])
    const sourceType = sanitizeEnum(req.query?.sourceType, ['Supplier', 'Restaurant', 'Kitchen'])

    const match = { restaurantId: restaurant._id }
    if (paymentType) {
      match.paymentType = paymentType
    }
    if (sourceType) {
      match.sourceType = sourceType
    }

    const purchaseWindow = Math.min(limit * 4, 1200)

    const rows = await InventoryPurchase.aggregate([
      { $match: match },
      { $sort: { createdAt: -1, _id: -1 } },
      { $limit: purchaseWindow },
      {
        $project: {
          _id: 1,
          invoiceDate: 1,
          invoiceNumber: 1,
          sourceType: 1,
          supplierNameSnapshot: 1,
          paymentType: 1,
          items: 1,
          updatedAt: 1,
          createdAt: 1,
        },
      },
      { $unwind: { path: '$items', includeArrayIndex: 'itemIndex' } },
      {
        $project: {
          _id: 0,
          purchaseId: '$_id',
          itemIndex: '$itemIndex',
          invoiceDate: '$invoiceDate',
          invoiceNumber: '$invoiceNumber',
          sourceType: '$sourceType',
          supplierName: '$supplierNameSnapshot',
          paymentType: '$paymentType',
          itemId: '$items.itemId',
          itemName: '$items.itemName',
          quantity: '$items.quantity',
          unit: '$items.unit',
          rate: '$items.rate',
          amount: '$items.amount',
          updatedAt: '$updatedAt',
          createdAt: '$createdAt',
        },
      },
      { $limit: limit },
    ])

    return res.json({ rows })
  } catch (error) {
    next(error)
  }
}

export async function updateInventoryPurchaseItem(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const purchaseId = toObjectId(req.params?.purchaseId)
    const itemIndex = Number(req.params?.itemIndex)

    if (!Number.isInteger(itemIndex) || itemIndex < 0) {
      return res.status(400).json({ message: 'Invalid item index' })
    }

    const purchase = await InventoryPurchase.findOne({
      _id: purchaseId,
      restaurantId: restaurant._id,
    }).select(
      '_id restaurantId sourceType supplierNameSnapshot invoiceDate invoiceNumber gstNo cgstPercent sgstPercent igstPercent deliveryCharge discountType discountValue paymentType items subtotalAmount taxableAmount cgstAmount sgstAmount igstAmount grandTotalAmount',
    )

    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' })
    }

    const currentItems = Array.isArray(purchase.items) ? purchase.items : []
    if (itemIndex >= currentItems.length) {
      return res.status(400).json({ message: 'Item row not found for update' })
    }

    const quantity = req.body?.quantity == null ? currentItems[itemIndex].quantity : Number(req.body.quantity)
    const rate = req.body?.rate == null ? currentItems[itemIndex].rate : Number(req.body.rate)
    const unit = String(req.body?.unit || currentItems[itemIndex].unit || 'Unit').trim()
    const paymentType = String(req.body?.paymentType || purchase.paymentType || 'Unpaid').trim()

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ message: 'Quantity must be greater than 0' })
    }

    if (!Number.isFinite(rate) || rate < 0) {
      return res.status(400).json({ message: 'Rate must be greater than or equal to 0' })
    }

    const draftItems = currentItems.map((row, index) => {
      if (index !== itemIndex) return row
      return {
        itemId: String(row.itemId || ''),
        itemName: row.itemName,
        quantity,
        unit,
        rate,
      }
    })

    const composed = composePurchasePayload({
      payload: {
        sourceType: purchase.sourceType,
        invoiceDate: purchase.invoiceDate,
        invoiceNumber: purchase.invoiceNumber,
        gstNo: purchase.gstNo,
        cgstPercent: purchase.cgstPercent,
        sgstPercent: purchase.sgstPercent,
        igstPercent: purchase.igstPercent,
        deliveryCharge: purchase.deliveryCharge,
        discountType: purchase.discountType,
        discountValue: purchase.discountValue,
        paymentType,
        items: draftItems,
      },
      itemById: new Map(),
      supplierName: purchase.supplierNameSnapshot,
    })

    purchase.paymentType = composed.paymentType
    purchase.items = composed.items
    purchase.subtotalAmount = composed.subtotalAmount
    purchase.taxableAmount = composed.taxableAmount
    purchase.cgstAmount = composed.cgstAmount
    purchase.sgstAmount = composed.sgstAmount
    purchase.igstAmount = composed.igstAmount
    purchase.grandTotalAmount = composed.grandTotalAmount
    purchase.totalDiscountAmount = composed.totalDiscountAmount
    purchase.discountType = composed.discountType
    purchase.discountValue = composed.discountValue
    purchase.cgstPercent = composed.cgstPercent
    purchase.sgstPercent = composed.sgstPercent
    purchase.igstPercent = composed.igstPercent
    purchase.deliveryCharge = composed.deliveryCharge

    await purchase.save()

    try {
      await invalidateCacheByTags([`inventory:purchases:${String(restaurant._id)}`])
    } catch (cacheError) {
      console.warn('[Inventory] Cache invalidation warning for purchases:', cacheError.message)
    }

    const updatedRow = purchase.items?.[itemIndex]

    return res.json({
      purchaseId: purchase._id,
      itemIndex,
      row: {
        purchaseId: purchase._id,
        itemIndex,
        invoiceDate: purchase.invoiceDate,
        invoiceNumber: purchase.invoiceNumber,
        sourceType: purchase.sourceType,
        supplierName: purchase.supplierNameSnapshot,
        paymentType: purchase.paymentType,
        itemId: updatedRow?.itemId,
        itemName: updatedRow?.itemName,
        quantity: updatedRow?.quantity,
        unit: updatedRow?.unit,
        rate: updatedRow?.rate,
        amount: updatedRow?.amount,
        updatedAt: purchase.updatedAt,
        createdAt: purchase.createdAt,
      },
    })
  } catch (error) {
    next(error)
  }
}

export async function deleteInventoryPurchaseItem(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const purchaseId = toObjectId(req.params?.purchaseId)
    const itemIndex = Number(req.params?.itemIndex)

    if (!Number.isInteger(itemIndex) || itemIndex < 0) {
      return res.status(400).json({ message: 'Invalid item index' })
    }

    const purchase = await InventoryPurchase.findOne({
      _id: purchaseId,
      restaurantId: restaurant._id,
    }).select(
      '_id restaurantId sourceType supplierNameSnapshot invoiceDate invoiceNumber gstNo cgstPercent sgstPercent igstPercent deliveryCharge discountType discountValue paymentType items subtotalAmount taxableAmount cgstAmount sgstAmount igstAmount grandTotalAmount',
    )

    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' })
    }

    const currentItems = Array.isArray(purchase.items) ? purchase.items : []
    if (itemIndex >= currentItems.length) {
      return res.status(400).json({ message: 'Item row not found for deletion' })
    }

    const remainingItems = currentItems
      .filter((_row, index) => index !== itemIndex)
      .map((row) => ({
        itemId: String(row.itemId || ''),
        itemName: String(row.itemName || '').trim(),
        quantity: Number(row.quantity || 0),
        unit: String(row.unit || 'Unit').trim() || 'Unit',
        rate: Number(row.rate || 0),
      }))

    if (remainingItems.length === 0) {
      await InventoryPurchase.deleteOne({ _id: purchase._id, restaurantId: restaurant._id })

      try {
        await invalidateCacheByTags([`inventory:purchases:${String(restaurant._id)}`])
      } catch (cacheError) {
        console.warn('[Inventory] Cache invalidation warning for purchases:', cacheError.message)
      }

      return res.json({
        deleted: true,
        purchaseDeleted: true,
        purchaseId: purchase._id,
        itemIndex,
      })
    }

    const composed = composePurchasePayload({
      payload: {
        sourceType: purchase.sourceType,
        invoiceDate: purchase.invoiceDate,
        invoiceNumber: purchase.invoiceNumber,
        gstNo: purchase.gstNo,
        cgstPercent: purchase.cgstPercent,
        sgstPercent: purchase.sgstPercent,
        igstPercent: purchase.igstPercent,
        deliveryCharge: purchase.deliveryCharge,
        discountType: purchase.discountType,
        discountValue: purchase.discountValue,
        paymentType: purchase.paymentType,
        items: remainingItems,
      },
      itemById: new Map(),
      supplierName: purchase.supplierNameSnapshot,
    })

    purchase.items = composed.items
    purchase.subtotalAmount = composed.subtotalAmount
    purchase.taxableAmount = composed.taxableAmount
    purchase.cgstAmount = composed.cgstAmount
    purchase.sgstAmount = composed.sgstAmount
    purchase.igstAmount = composed.igstAmount
    purchase.grandTotalAmount = composed.grandTotalAmount
    purchase.totalDiscountAmount = composed.totalDiscountAmount
    purchase.discountType = composed.discountType
    purchase.discountValue = composed.discountValue
    purchase.cgstPercent = composed.cgstPercent
    purchase.sgstPercent = composed.sgstPercent
    purchase.igstPercent = composed.igstPercent
    purchase.deliveryCharge = composed.deliveryCharge

    await purchase.save()

    try {
      await invalidateCacheByTags([`inventory:purchases:${String(restaurant._id)}`])
    } catch (cacheError) {
      console.warn('[Inventory] Cache invalidation warning for purchases:', cacheError.message)
    }

    return res.json({
      deleted: true,
      purchaseDeleted: false,
      purchaseId: purchase._id,
      itemIndex,
      remainingItemCount: purchase.items.length,
    })
  } catch (error) {
    next(error)
  }
}
