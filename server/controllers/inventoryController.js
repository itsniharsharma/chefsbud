import mongoose from 'mongoose'
import InventoryItem from '../models/InventoryItem.js'
import InventoryPurchase from '../models/InventoryPurchase.js'
import InventorySupplier from '../models/InventorySupplier.js'
import MenuItem from '../models/MenuItem.js'
import Recipe from '../models/Recipe.js'
import {
  addLedgerEntries,
  bootstrapStockFromSavedPurchases,
  getCurrentStock,
  reconcileStockFromSavedPurchases,
} from '../services/inventoryService.js'
import { composePurchasePayload } from '../services/inventoryPurchaseService.js'
import { invalidateCacheByTags } from '../services/responseCache.js'
import { resolveRequestRestaurant } from '../utils/requestRestaurant.js'

const supplierProjection = '_id name gstNo phone email address isActive createdAt updatedAt'
const itemProjection = '_id name defaultUnit currentStock currentStockUnit isActive createdAt updatedAt'
const purchaseProjection =
  '_id sourceType supplierId supplierNameSnapshot invoiceDate invoiceNumber gstNo cgstPercent sgstPercent igstPercent deliveryCharge discountType discountValue totalDiscountAmount paymentType items subtotalAmount taxableAmount cgstAmount sgstAmount igstAmount grandTotalAmount createdAt updatedAt'

function purchaseCacheTags(restaurantId) {
  const id = String(restaurantId)
  return [`inventory:purchases:${id}`, `inventory:items:${id}`]
}

async function invalidateInventoryCaches(restaurantId) {
  try {
    await invalidateCacheByTags(purchaseCacheTags(restaurantId))
  } catch (cacheError) {
    console.warn('[Inventory] Cache invalidation warning:', cacheError.message)
  }
}

function applyComposedPurchaseToDoc(purchase, composed) {
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
}

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

function safeNumber(value, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function round6(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1_000_000) / 1_000_000
}

function resolveBaseUnit(unit = 'Unit') {
  const normalized = String(unit || 'Unit').trim().toLowerCase()
  if (normalized === 'kg' || normalized === 'gram' || normalized === 'g') return 'g'
  if (normalized === 'litre' || normalized === 'liter' || normalized === 'ml') return 'ml'
  return 'unit'
}

function buildPurchaseLedgerEntries({ restaurantId, purchase, createdBy, referenceType = 'purchase' }) {
  const rows = Array.isArray(purchase?.items) ? purchase.items : []
  return rows
    .map((row, index) => {
      const itemId = String(row?.itemId || '').trim()
      const quantity = safeNumber(row?.quantity)
      const unit = String(row?.unit || '').trim()
      if (!itemId || quantity <= 0 || !unit) return null

      return {
        restaurantId,
        inventoryItemId: itemId,
        type: 'PURCHASE',
        quantity,
        direction: 1,
        unit,
        referenceType,
        referenceId: purchase?._id || null,
        metadata: {
          purchaseId: String(purchase?._id || ''),
          invoiceNumber: String(purchase?.invoiceNumber || ''),
          sourceType: String(purchase?.sourceType || ''),
          itemIndex: index,
        },
        createdBy,
        idempotencyKey: purchase?._id
          ? `purchase:${String(purchase._id)}:item:${itemId}:${index}`
          : '',
      }
    })
    .filter(Boolean)
}

function buildPurchaseAdjustmentEntries({
  restaurantId,
  purchaseId,
  oldRow,
  newRow,
  itemIndex,
  createdBy,
}) {
  const result = []

  const oldQty = safeNumber(oldRow?.quantity)
  const newQty = safeNumber(newRow?.quantity)

  if (oldRow?.itemId && oldQty > 0 && oldRow?.unit) {
    result.push({
      restaurantId,
      inventoryItemId: String(oldRow.itemId),
      type: 'ADJUSTMENT',
      quantity: oldQty,
      direction: -1,
      unit: String(oldRow.unit),
      referenceType: 'purchase_update',
      referenceId: purchaseId,
      metadata: {
        purchaseId: String(purchaseId || ''),
        itemIndex,
        mode: 'revert_old_row',
      },
      createdBy,
    })
  }

  if (newRow?.itemId && newQty > 0 && newRow?.unit) {
    result.push({
      restaurantId,
      inventoryItemId: String(newRow.itemId),
      type: 'ADJUSTMENT',
      quantity: newQty,
      direction: 1,
      unit: String(newRow.unit),
      referenceType: 'purchase_update',
      referenceId: purchaseId,
      metadata: {
        purchaseId: String(purchaseId || ''),
        itemIndex,
        mode: 'apply_new_row',
      },
      createdBy,
    })
  }

  return result
}

function normalizeRecipeIngredientRows(rows = []) {
  return rows
    .map((row) => ({
      inventoryItemId: String(row?.inventoryItemId || '').trim(),
      quantity: round6(Math.max(0, safeNumber(row?.quantity))),
      unit: String(row?.unit || '').trim(),
    }))
    .filter((row) => row.inventoryItemId && row.quantity > 0 && row.unit)
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

export async function updateInventoryItemDefaultUnit(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const inventoryItemId = String(req.params?.inventoryItemId || '').trim()
    const defaultUnit = String(req.body?.defaultUnit || '').trim()

    if (!inventoryItemId) {
      return res.status(400).json({ message: 'inventoryItemId is required' })
    }

    if (!defaultUnit) {
      return res.status(400).json({ message: 'defaultUnit is required' })
    }

    const item = await InventoryItem.findOne({
      _id: inventoryItemId,
      restaurantId: restaurant._id,
    })

    if (!item) {
      return res.status(404).json({ message: 'Inventory item not found' })
    }

    const currentStock = Number(item.currentStock || 0)
    const nextBaseUnit = resolveBaseUnit(defaultUnit)
    const currentBaseUnit = String(item.currentStockUnit || resolveBaseUnit(item.defaultUnit || 'Unit'))

    // Prevent changing dimensional family while stock exists (mass -> volume, etc.).
    if (Math.abs(currentStock) > 0.000001 && nextBaseUnit !== currentBaseUnit) {
      return res.status(400).json({
        message:
          'Cannot change default unit across measurement dimensions while stock is non-zero. Please consume/adjust stock first.',
      })
    }

    item.defaultUnit = defaultUnit
    await item.save()

    await invalidateInventoryCaches(restaurant._id)

    return res.json(item)
  } catch (error) {
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

    const session = await mongoose.startSession()
    let purchase = null

    try {
      await session.withTransaction(async () => {
        purchase = await InventoryPurchase.create(
          [
            {
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
            },
          ],
          { session },
        )

        purchase = purchase[0]

        const ledgerEntries = buildPurchaseLedgerEntries({
          restaurantId: restaurant._id,
          purchase,
          createdBy: req.user?._id || null,
        })

        if (ledgerEntries.length) {
          await addLedgerEntries(ledgerEntries, { session })
        }
      })
    } finally {
      session.endSession()
    }

    const responsePayload = await InventoryPurchase.findOne({ _id: purchase._id })
      .select(purchaseProjection)
      .lean()

    await invalidateInventoryCaches(restaurant._id)

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

    const previousRow = currentItems[itemIndex]
    const updatedRow = composed.items?.[itemIndex]

    const session = await mongoose.startSession()

    try {
      await session.withTransaction(async () => {
        applyComposedPurchaseToDoc(purchase, composed)

        await purchase.save({ session })

        const adjustmentEntries = buildPurchaseAdjustmentEntries({
          restaurantId: restaurant._id,
          purchaseId: purchase._id,
          oldRow: previousRow,
          newRow: updatedRow,
          itemIndex,
          createdBy: req.user?._id || null,
        })

        if (adjustmentEntries.length) {
          await addLedgerEntries(adjustmentEntries, { session })
        }
      })
    } finally {
      session.endSession()
    }

    await invalidateInventoryCaches(restaurant._id)

    const updatedRowResponse = purchase.items?.[itemIndex]

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
        itemId: updatedRowResponse?.itemId,
        itemName: updatedRowResponse?.itemName,
        quantity: updatedRowResponse?.quantity,
        unit: updatedRowResponse?.unit,
        rate: updatedRowResponse?.rate,
        amount: updatedRowResponse?.amount,
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

    const removedRow = currentItems[itemIndex]

    if (remainingItems.length === 0) {
      const session = await mongoose.startSession()

      try {
        await session.withTransaction(async () => {
          await InventoryPurchase.deleteOne({ _id: purchase._id, restaurantId: restaurant._id }).session(session)

          const adjustmentEntries = buildPurchaseAdjustmentEntries({
            restaurantId: restaurant._id,
            purchaseId: purchase._id,
            oldRow: removedRow,
            newRow: null,
            itemIndex,
            createdBy: req.user?._id || null,
          })

          if (adjustmentEntries.length) {
            await addLedgerEntries(adjustmentEntries, { session })
          }
        })
      } finally {
        session.endSession()
      }

      await invalidateInventoryCaches(restaurant._id)

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

    const session = await mongoose.startSession()

    try {
      await session.withTransaction(async () => {
        applyComposedPurchaseToDoc(purchase, composed)

        await purchase.save({ session })

        const adjustmentEntries = buildPurchaseAdjustmentEntries({
          restaurantId: restaurant._id,
          purchaseId: purchase._id,
          oldRow: removedRow,
          newRow: null,
          itemIndex,
          createdBy: req.user?._id || null,
        })

        if (adjustmentEntries.length) {
          await addLedgerEntries(adjustmentEntries, { session })
        }
      })
    } finally {
      session.endSession()
    }

    await invalidateInventoryCaches(restaurant._id)

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

export async function upsertRecipe(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const menuItemId = String(req.body?.menuItemId || '').trim()
    const ingredients = normalizeRecipeIngredientRows(req.body?.ingredients)

    if (!menuItemId) {
      return res.status(400).json({ message: 'menuItemId is required' })
    }

    const menuItem = await MenuItem.findOne({
      _id: menuItemId,
      restaurantId: restaurant._id,
    })
      .select('_id name')
      .lean()

    if (!menuItem) {
      return res.status(400).json({ message: 'Menu item not found for this restaurant' })
    }

    if (!ingredients.length) {
      return res.status(400).json({ message: 'At least one ingredient is required' })
    }

    const inventoryIds = [...new Set(ingredients.map((row) => row.inventoryItemId))]
    const validInventoryItems = await InventoryItem.find({
      _id: { $in: inventoryIds },
      restaurantId: restaurant._id,
      isActive: true,
    })
      .select('_id')
      .lean()

    if (validInventoryItems.length !== inventoryIds.length) {
      return res.status(400).json({ message: 'One or more ingredients are invalid for this restaurant' })
    }

    const existingRecipe = await Recipe.findOne({
      restaurantId: restaurant._id,
      menuItemId,
    })

    let recipe = null
    if (!existingRecipe) {
      recipe = await Recipe.create({
        restaurantId: restaurant._id,
        menuItemId,
        ingredients,
        version: 1,
      })
    } else {
      existingRecipe.ingredients = ingredients
      existingRecipe.version = Math.max(1, Number(existingRecipe.version || 1) + 1)
      recipe = await existingRecipe.save()
    }

    return res.status(201).json(recipe)
  } catch (error) {
    next(error)
  }
}

export async function listRecipes(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const recipes = await Recipe.find({ restaurantId: restaurant._id })
      .sort({ updatedAt: -1 })
      .select('_id menuItemId ingredients version createdAt updatedAt')
      .lean()

    return res.json({ recipes })
  } catch (error) {
    next(error)
  }
}

export async function createInventoryWastage(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const inventoryItemId = String(req.body?.inventoryItemId || '').trim()
    const quantity = safeNumber(req.body?.quantity)
    const unit = String(req.body?.unit || '').trim()
    const reason = String(req.body?.reason || '').trim()

    if (!inventoryItemId || quantity <= 0 || !unit) {
      return res.status(400).json({ message: 'inventoryItemId, quantity and unit are required' })
    }

    await addLedgerEntries(
      [
        {
          restaurantId: restaurant._id,
          inventoryItemId,
          type: 'WASTAGE',
          quantity,
          direction: -1,
          unit,
          referenceType: 'wastage',
          referenceId: null,
          metadata: { reason },
          createdBy: req.user?._id || null,
        },
      ],
      {},
    )

    await invalidateInventoryCaches(restaurant._id)

    return res.status(201).json({ success: true })
  } catch (error) {
    next(error)
  }
}

export async function createInventoryConversion(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const fromInventoryItemId = String(req.body?.fromInventoryItemId || '').trim()
    const fromQuantity = safeNumber(req.body?.fromQuantity)
    const fromUnit = String(req.body?.fromUnit || '').trim()

    const toInventoryItemId = String(req.body?.toInventoryItemId || '').trim()
    const toQuantity = safeNumber(req.body?.toQuantity)
    const toUnit = String(req.body?.toUnit || '').trim()

    const note = String(req.body?.note || '').trim()

    if (!fromInventoryItemId || !toInventoryItemId) {
      return res.status(400).json({ message: 'fromInventoryItemId and toInventoryItemId are required' })
    }

    if (fromQuantity <= 0 || toQuantity <= 0) {
      return res.status(400).json({ message: 'fromQuantity and toQuantity must be greater than 0' })
    }

    if (!fromUnit || !toUnit) {
      return res.status(400).json({ message: 'fromUnit and toUnit are required' })
    }

    const conversionReference = new mongoose.Types.ObjectId()

    await addLedgerEntries(
      [
        {
          restaurantId: restaurant._id,
          inventoryItemId: fromInventoryItemId,
          type: 'CONVERSION_OUT',
          quantity: fromQuantity,
          direction: -1,
          unit: fromUnit,
          referenceType: 'conversion',
          referenceId: conversionReference,
          metadata: {
            direction: 'from',
            toInventoryItemId,
            toQuantity,
            toUnit,
            note,
          },
          createdBy: req.user?._id || null,
        },
        {
          restaurantId: restaurant._id,
          inventoryItemId: toInventoryItemId,
          type: 'CONVERSION_IN',
          quantity: toQuantity,
          direction: 1,
          unit: toUnit,
          referenceType: 'conversion',
          referenceId: conversionReference,
          metadata: {
            direction: 'to',
            fromInventoryItemId,
            fromQuantity,
            fromUnit,
            note,
          },
          createdBy: req.user?._id || null,
        },
      ],
      {},
    )

    await invalidateInventoryCaches(restaurant._id)

    return res.status(201).json({ success: true, conversionId: conversionReference })
  } catch (error) {
    next(error)
  }
}

export async function getInventoryItemStock(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const inventoryItemId = String(req.params?.inventoryItemId || '').trim()
    if (!inventoryItemId) {
      return res.status(400).json({ message: 'inventoryItemId is required' })
    }

    const stock = await getCurrentStock({
      inventoryItemId,
      restaurantId: restaurant._id,
      preferCached: req.query?.source !== 'ledger',
    })

    return res.json(stock)
  } catch (error) {
    next(error)
  }
}

export async function bootstrapInventoryStock(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const mode = String(req.body?.mode || 'bootstrap_and_reconcile').trim()
    let bootstrapResult = null
    let reconcileResult = null

    if (mode !== 'reconcile_only') {
      bootstrapResult = await bootstrapStockFromSavedPurchases({
        restaurantId: restaurant._id,
        createdBy: req.user?._id || null,
        batchSize: Number(req.body?.batchSize || 200),
      })
    }

    if (mode !== 'bootstrap_only') {
      reconcileResult = await reconcileStockFromSavedPurchases({
        restaurantId: restaurant._id,
        createdBy: req.user?._id || null,
      })
    }

    await invalidateInventoryCaches(restaurant._id)

    return res.json({
      success: true,
      summary: {
        mode,
        bootstrap: bootstrapResult,
        reconcile: reconcileResult,
      },
      message: 'Inventory stock sync completed',
    })
  } catch (error) {
    next(error)
  }
}
