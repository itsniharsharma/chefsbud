import mongoose from 'mongoose'
import InventoryItem from '../models/InventoryItem.js'
import InventoryLedger from '../models/InventoryLedger.js'
import InventoryPurchase from '../models/InventoryPurchase.js'
import Recipe from '../models/Recipe.js'

const LEDGER_TYPES = new Set([
  'PURCHASE',
  'CONSUMPTION',
  'WASTAGE',
  'ADJUSTMENT',
  'CONVERSION_IN',
  'CONVERSION_OUT',
])

function toObjectIdString(value) {
  return String(value || '').trim()
}

function round6(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1_000_000) / 1_000_000
}

function unitToBase(unit = '') {
  const normalized = String(unit || '').trim().toLowerCase()
  if (normalized === 'kg' || normalized === 'kilogram' || normalized === 'kilograms') {
    return { unit: 'g', factor: 1000 }
  }
  if (normalized === 'gram' || normalized === 'grams' || normalized === 'g') {
    return { unit: 'g', factor: 1 }
  }
  if (normalized === 'litre' || normalized === 'liter' || normalized === 'litres' || normalized === 'liters' || normalized === 'l') {
    return { unit: 'ml', factor: 1000 }
  }
  if (normalized === 'ml' || normalized === 'millilitre' || normalized === 'milliliter') {
    return { unit: 'ml', factor: 1 }
  }
  if (normalized === 'unit' || normalized === 'units' || normalized === 'packet' || normalized === 'packets') {
    return { unit: 'unit', factor: 1 }
  }

  if (normalized === 'g' || normalized === 'ml') {
    return { unit: normalized, factor: 1 }
  }

  throw new Error(`Unsupported inventory unit: ${unit}`)
}

function normalizeLedgerRow(row = {}) {
  const restaurantId = toObjectIdString(row.restaurantId)
  const inventoryItemId = toObjectIdString(row.inventoryItemId)
  const type = String(row.type || '').trim().toUpperCase()
  const directionRaw = Number(row.direction)
  const referenceType = String(row.referenceType || '').trim().toLowerCase()
  const quantityRaw = Number(row.quantity)

  if (!restaurantId || !inventoryItemId) {
    throw new Error('restaurantId and inventoryItemId are required for ledger writes')
  }
  if (!LEDGER_TYPES.has(type)) {
    throw new Error(`Invalid ledger type: ${type}`)
  }
  if (directionRaw !== 1 && directionRaw !== -1) {
    throw new Error('direction must be +1 or -1')
  }
  if (!Number.isFinite(quantityRaw) || quantityRaw <= 0) {
    throw new Error('quantity must be greater than 0')
  }
  if (!referenceType) {
    throw new Error('referenceType is required')
  }

  const base = unitToBase(row.unit)
  const quantity = round6(quantityRaw * base.factor)

  return {
    restaurantId,
    inventoryItemId,
    type,
    quantity,
    direction: directionRaw,
    unit: base.unit,
    referenceType,
    referenceId: row.referenceId || null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    createdBy: row.createdBy || null,
    idempotencyKey: String(row.idempotencyKey || '').trim(),
  }
}

function buildStockDeltaByItem(entries = []) {
  const deltas = new Map()
  for (const entry of entries) {
    const key = String(entry.inventoryItemId)
    const current = deltas.get(key) || { delta: 0, unit: entry.unit }
    if (current.unit !== entry.unit) {
      throw new Error('Cannot mix unit dimensions for same inventory item in one write batch')
    }
    current.delta = round6(current.delta + entry.direction * entry.quantity)
    deltas.set(key, current)
  }
  return deltas
}

async function assertTenantOwnership(entries = [], { session } = {}) {
  const itemIds = [...new Set(entries.map((entry) => toObjectIdString(entry.inventoryItemId)).filter(Boolean))]
  const restaurantIds = [...new Set(entries.map((entry) => toObjectIdString(entry.restaurantId)).filter(Boolean))]

  if (!itemIds.length || !restaurantIds.length || restaurantIds.length !== 1) {
    throw new Error('Invalid tenant scope for ledger entries')
  }

  const restaurantId = restaurantIds[0]

  const items = await InventoryItem.find({
    _id: { $in: itemIds },
    restaurantId,
  })
    .select('_id restaurantId currentStockUnit')
    .session(session || null)
    .lean()

  if (items.length !== itemIds.length) {
    throw new Error('One or more inventory items are invalid for this restaurant')
  }

  const itemById = new Map(items.map((item) => [String(item._id), item]))

  for (const entry of entries) {
    const item = itemById.get(toObjectIdString(entry.inventoryItemId))
    if (!item) {
      throw new Error('Inventory item tenant validation failed')
    }
    if (item.currentStockUnit && item.currentStockUnit !== entry.unit) {
      throw new Error('Inventory unit mismatch detected for ledger write')
    }
  }
}

export async function addLedgerEntries(entries = [], { session = null } = {}) {
  if (!Array.isArray(entries) || !entries.length) {
    return { insertedCount: 0, stockUpdatedCount: 0 }
  }

  const normalized = entries.map((row) => normalizeLedgerRow(row))
  await assertTenantOwnership(normalized, { session })

  const bulkOps = normalized.map((entry) => ({
    insertOne: {
      document: {
        restaurantId: entry.restaurantId,
        inventoryItemId: entry.inventoryItemId,
        type: entry.type,
        quantity: entry.quantity,
        direction: entry.direction,
        unit: entry.unit,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        metadata: entry.metadata,
        createdBy: entry.createdBy,
        idempotencyKey: entry.idempotencyKey,
      },
    },
  }))

  try {
    await InventoryLedger.bulkWrite(bulkOps, {
      ordered: true,
      session: session || undefined,
    })
  } catch (error) {
    if (error?.code === 11000) {
      return { insertedCount: 0, stockUpdatedCount: 0, duplicate: true }
    }
    throw error
  }

  const deltas = buildStockDeltaByItem(normalized)
  const stockOps = [...deltas.entries()].map(([inventoryItemId, value]) => ({
    updateOne: {
      filter: { _id: inventoryItemId },
      update: {
        $inc: { currentStock: value.delta },
        $set: { currentStockUnit: value.unit },
      },
    },
  }))

  if (stockOps.length) {
    await InventoryItem.bulkWrite(stockOps, {
      ordered: true,
      session: session || undefined,
    })
  }

  return {
    insertedCount: normalized.length,
    stockUpdatedCount: stockOps.length,
  }
}

function normalizeIngredientUnit(unit = '') {
  const raw = String(unit || '').trim()
  if (!raw) return 'Unit'
  if (raw === 'g') return 'Gram'
  if (raw === 'ml') return 'Ml'
  if (raw === 'unit') return 'Unit'
  return raw
}

export async function processOrderConsumption(order, { session = null, createdBy = null, cycle = 1 } = {}) {
  const orderId = toObjectIdString(order?._id)
  const restaurantId = toObjectIdString(order?.restaurantId)
  const items = Array.isArray(order?.items) ? order.items : []

  if (!orderId || !restaurantId || !items.length) {
    return { processed: 0, skippedMenuItemIds: [] }
  }

  const uniqueMenuItemIds = [...new Set(items.map((item) => toObjectIdString(item.menuItemId)).filter(Boolean))]
  if (!uniqueMenuItemIds.length) {
    return { processed: 0, skippedMenuItemIds: [] }
  }

  const recipes = await Recipe.find({
    restaurantId,
    menuItemId: { $in: uniqueMenuItemIds },
  })
    .select('menuItemId ingredients')
    .session(session || null)
    .lean()

  const recipeByMenuItemId = new Map(recipes.map((recipe) => [toObjectIdString(recipe.menuItemId), recipe]))
  const totalsByInventoryItem = new Map()
  const skippedMenuItemIds = []

  for (const orderItem of items) {
    const menuItemId = toObjectIdString(orderItem.menuItemId)
    const recipe = recipeByMenuItemId.get(menuItemId)
    const orderQuantity = Math.max(0, Number(orderItem.quantity || 0))

    if (!recipe || !Array.isArray(recipe.ingredients) || !recipe.ingredients.length) {
      skippedMenuItemIds.push(menuItemId)
      continue
    }

    for (const ingredient of recipe.ingredients) {
      const inventoryItemId = toObjectIdString(ingredient.inventoryItemId)
      if (!inventoryItemId) continue

      const ingredientQuantity = Math.max(0, Number(ingredient.quantity || 0))
      if (!ingredientQuantity) continue

      const unit = normalizeIngredientUnit(ingredient.unit)
      const totalQty = round6(ingredientQuantity * orderQuantity)
      if (!totalQty) continue

      const key = inventoryItemId
      const current = totalsByInventoryItem.get(key) || {
        quantity: 0,
        unit,
        sources: [],
      }

      if (current.unit !== unit) {
        throw new Error('Recipe unit mismatch for same inventory item')
      }

      current.quantity = round6(current.quantity + totalQty)
      current.sources.push({
        menuItemId,
        orderQuantity,
        ingredientQuantity,
      })
      totalsByInventoryItem.set(key, current)
    }
  }

  const ledgerEntries = [...totalsByInventoryItem.entries()].map(([inventoryItemId, entry]) => ({
    restaurantId,
    inventoryItemId,
    type: 'CONSUMPTION',
    quantity: entry.quantity,
    direction: -1,
    unit: entry.unit,
    referenceType: 'order',
    referenceId: orderId,
    metadata: {
      reason: 'order_completed_consumption',
      cycle: Number(cycle || 1),
      sourceCount: entry.sources.length,
      sources: entry.sources,
    },
    createdBy,
    idempotencyKey: `order:${orderId}:cycle:${Number(cycle || 1)}:consumption:${inventoryItemId}`,
  }))

  if (!ledgerEntries.length) {
    return { processed: 0, skippedMenuItemIds }
  }

  const result = await addLedgerEntries(ledgerEntries, { session })
  return { processed: ledgerEntries.length, skippedMenuItemIds, duplicate: Boolean(result.duplicate) }
}

export async function reverseOrderConsumption(order, { session = null, createdBy = null, cycle = 1 } = {}) {
  const orderId = toObjectIdString(order?._id)
  const restaurantId = toObjectIdString(order?.restaurantId)

  if (!orderId || !restaurantId) {
    return { reversed: 0 }
  }

  const consumedRows = await InventoryLedger.find({
    restaurantId,
    referenceType: 'order',
    referenceId: orderId,
    type: 'CONSUMPTION',
    direction: -1,
    'metadata.cycle': Number(cycle || 1),
  })
    .select('inventoryItemId quantity unit metadata')
    .session(session || null)
    .lean()

  if (!consumedRows.length) {
    return { reversed: 0 }
  }

  const reverseEntries = consumedRows.map((row) => ({
    restaurantId,
    inventoryItemId: row.inventoryItemId,
    type: 'CONSUMPTION',
    quantity: row.quantity,
    direction: 1,
    unit: row.unit,
    referenceType: 'order_reverse',
    referenceId: orderId,
    metadata: {
      reason: 'order_completion_reversed',
      cycle: Number(cycle || 1),
      consumedLedgerMetadata: row.metadata || {},
    },
    createdBy,
    idempotencyKey: `order:${orderId}:cycle:${Number(cycle || 1)}:reverse:${toObjectIdString(row.inventoryItemId)}`,
  }))

  const result = await addLedgerEntries(reverseEntries, { session })
  return { reversed: reverseEntries.length, duplicate: Boolean(result.duplicate) }
}

export async function getCurrentStock({ inventoryItemId, restaurantId, preferCached = true, session = null }) {
  const itemId = toObjectIdString(inventoryItemId)
  const tenantId = toObjectIdString(restaurantId)

  if (!itemId || !tenantId) {
    throw new Error('inventoryItemId and restaurantId are required')
  }

  if (preferCached) {
    const item = await InventoryItem.findOne({
      _id: itemId,
      restaurantId: tenantId,
    })
      .select('_id currentStock currentStockUnit')
      .session(session || null)
      .lean()

    if (!item) {
      throw new Error('Inventory item not found')
    }

    return {
      inventoryItemId: item._id,
      quantity: Number(item.currentStock || 0),
      unit: String(item.currentStockUnit || 'unit'),
      source: 'cache',
    }
  }

  const totals = await InventoryLedger.aggregate([
    {
      $match: {
        restaurantId: new mongoose.Types.ObjectId(tenantId),
        inventoryItemId: new mongoose.Types.ObjectId(itemId),
      },
    },
    {
      $group: {
        _id: '$unit',
        quantity: {
          $sum: {
            $multiply: ['$quantity', '$direction'],
          },
        },
      },
    },
  ]).session(session || null)

  if (!totals.length) {
    return {
      inventoryItemId: itemId,
      quantity: 0,
      unit: 'unit',
      source: 'ledger',
    }
  }

  if (totals.length > 1) {
    throw new Error('Inventory item has inconsistent unit dimensions')
  }

  return {
    inventoryItemId: itemId,
    quantity: Number(totals[0].quantity || 0),
    unit: String(totals[0]._id || 'unit'),
    source: 'ledger',
  }
}

function buildBootstrapPurchaseEntries({ restaurantId, purchase, createdBy = null }) {
  const rows = Array.isArray(purchase?.items) ? purchase.items : []
  return rows
    .map((row, index) => {
      const inventoryItemId = toObjectIdString(row?.itemId)
      const quantity = Number(row?.quantity)
      const unit = String(row?.unit || '').trim()
      if (!inventoryItemId || !Number.isFinite(quantity) || quantity <= 0 || !unit) {
        return null
      }

      return {
        restaurantId,
        inventoryItemId,
        type: 'PURCHASE',
        quantity,
        direction: 1,
        unit,
        referenceType: 'purchase',
        referenceId: purchase?._id || null,
        metadata: {
          bootstrap: true,
          purchaseId: String(purchase?._id || ''),
          invoiceNumber: String(purchase?.invoiceNumber || ''),
          sourceType: String(purchase?.sourceType || ''),
          itemIndex: index,
        },
        createdBy,
        // Reuse the same idempotency namespace as runtime purchase writes.
        idempotencyKey: purchase?._id
          ? `purchase:${String(purchase._id)}:item:${inventoryItemId}:${index}`
          : '',
      }
    })
    .filter(Boolean)
}

async function filterExistingIdempotencyRows(restaurantId, rows = [], { session = null } = {}) {
  if (!rows.length) return []

  const keys = [...new Set(rows.map((row) => String(row?.idempotencyKey || '').trim()).filter(Boolean))]
  if (!keys.length) return rows

  const existing = await InventoryLedger.find({
    restaurantId,
    idempotencyKey: { $in: keys },
  })
    .select('idempotencyKey')
    .session(session || null)
    .lean()

  if (!existing.length) return rows

  const existingSet = new Set(existing.map((doc) => String(doc.idempotencyKey || '').trim()))
  return rows.filter((row) => {
    const key = String(row?.idempotencyKey || '').trim()
    return !key || !existingSet.has(key)
  })
}

export async function bootstrapStockFromSavedPurchases({ restaurantId, createdBy = null, batchSize = 200 } = {}) {
  const tenantId = toObjectIdString(restaurantId)
  if (!tenantId) {
    throw new Error('restaurantId is required for bootstrap')
  }

  const safeBatchSize = Math.max(25, Math.min(Number(batchSize || 200), 1000))
  let cursorCreatedAt = null
  let cursorId = null
  let scannedPurchases = 0
  let attemptedLedgerRows = 0
  let insertedLedgerRows = 0
  let duplicateBatches = 0

  while (true) {
    const query = { restaurantId: tenantId }
    if (cursorCreatedAt && cursorId) {
      query.$or = [
        { createdAt: { $gt: cursorCreatedAt } },
        { createdAt: cursorCreatedAt, _id: { $gt: cursorId } },
      ]
    }

    const purchases = await InventoryPurchase.find(query)
      .sort({ createdAt: 1, _id: 1 })
      .limit(safeBatchSize)
      .select('_id sourceType invoiceNumber items createdAt')
      .lean()

    if (!purchases.length) {
      break
    }

    for (const purchase of purchases) {
      scannedPurchases += 1
      const rawRows = buildBootstrapPurchaseEntries({
        restaurantId: tenantId,
        purchase,
        createdBy,
      })

      attemptedLedgerRows += rawRows.length
      if (!rawRows.length) continue

      const rows = await filterExistingIdempotencyRows(tenantId, rawRows)
      if (!rows.length) {
        duplicateBatches += 1
        continue
      }

      const result = await addLedgerEntries(rows)
      if (result?.duplicate) {
        duplicateBatches += 1
      } else {
        insertedLedgerRows += Number(result?.insertedCount || 0)
        if (rows.length !== rawRows.length) {
          duplicateBatches += 1
        }
      }
    }

    const last = purchases[purchases.length - 1]
    cursorCreatedAt = last.createdAt
    cursorId = last._id
  }

  return {
    scannedPurchases,
    attemptedLedgerRows,
    insertedLedgerRows,
    duplicateBatches,
  }
}

export async function reconcileStockFromSavedPurchases({ restaurantId, createdBy = null } = {}) {
  const tenantId = toObjectIdString(restaurantId)
  if (!tenantId) {
    throw new Error('restaurantId is required for reconciliation')
  }

  const EPSILON = 0.000001
  const aggregateRows = await InventoryPurchase.aggregate([
    { $match: { restaurantId: new mongoose.Types.ObjectId(tenantId) } },
    { $unwind: '$items' },
    {
      $project: {
        _id: 0,
        inventoryItemId: '$items.itemId',
        quantity: '$items.quantity',
        unit: '$items.unit',
      },
    },
    {
      $group: {
        _id: { inventoryItemId: '$inventoryItemId', unit: '$unit' },
        quantity: { $sum: '$quantity' },
      },
    },
  ])

  const expectedByItem = new Map()
  for (const row of aggregateRows) {
    const itemId = toObjectIdString(row?._id?.inventoryItemId)
    if (!itemId) continue

    const qty = Number(row?.quantity)
    if (!Number.isFinite(qty) || qty <= 0) continue

    const base = unitToBase(String(row?._id?.unit || ''))
    const convertedQty = round6(qty * base.factor)
    const current = expectedByItem.get(itemId)

    if (!current) {
      expectedByItem.set(itemId, { quantity: convertedQty, unit: base.unit, conflict: false })
      continue
    }

    if (current.unit !== base.unit) {
      current.conflict = true
      expectedByItem.set(itemId, current)
      continue
    }

    current.quantity = round6(current.quantity + convertedQty)
    expectedByItem.set(itemId, current)
  }

  const items = await InventoryItem.find({ restaurantId: tenantId })
    .select('_id currentStock currentStockUnit')
    .lean()

  const conflictItemIds = []
  const unitAlignOps = []
  const adjustmentEntries = []
  const runReference = new mongoose.Types.ObjectId()

  for (const item of items) {
    const itemId = toObjectIdString(item._id)
    const expected = expectedByItem.get(itemId)
    const currentQty = Number(item.currentStock || 0)
    const currentUnit = String(item.currentStockUnit || 'unit')

    if (expected?.conflict) {
      conflictItemIds.push(itemId)
      continue
    }

    const expectedUnit = String(expected?.unit || currentUnit)

    if (Math.abs(currentQty) <= EPSILON && expectedUnit !== currentUnit) {
      unitAlignOps.push({
        updateOne: {
          filter: { _id: item._id },
          update: { $set: { currentStockUnit: expectedUnit } },
        },
      })
    }
  }

  if (unitAlignOps.length) {
    await InventoryItem.bulkWrite(unitAlignOps, { ordered: false })
  }

  const alignedUnitByItemId = new Map(
    unitAlignOps.map((op) => [
      toObjectIdString(op?.updateOne?.filter?._id),
      String(op?.updateOne?.update?.$set?.currentStockUnit || ''),
    ]),
  )

  const refreshedItems = items.map((item) => {
    const itemId = toObjectIdString(item._id)
    const alignedUnit = alignedUnitByItemId.get(itemId)
    if (!alignedUnit) return item
    return {
      ...item,
      currentStockUnit: alignedUnit,
    }
  })

  for (const item of refreshedItems) {
    const itemId = toObjectIdString(item._id)
    const expected = expectedByItem.get(itemId)
    const currentQty = Number(item.currentStock || 0)
    const currentUnit = String(item.currentStockUnit || 'unit')

    if (expected?.conflict) continue

    const expectedQty = Number(expected?.quantity || 0)
    const expectedUnit = String(expected?.unit || currentUnit)

    if (expectedUnit !== currentUnit) {
      conflictItemIds.push(itemId)
      continue
    }

    const delta = round6(expectedQty - currentQty)
    if (Math.abs(delta) <= EPSILON) continue

    adjustmentEntries.push({
      restaurantId: tenantId,
      inventoryItemId: itemId,
      type: 'ADJUSTMENT',
      quantity: Math.abs(delta),
      direction: delta > 0 ? 1 : -1,
      unit: expectedUnit,
      referenceType: 'stock_reconcile',
      referenceId: runReference,
      metadata: {
        reason: 'saved_purchases_reconcile',
        expectedQty,
        previousQty: currentQty,
      },
      createdBy,
      idempotencyKey: `reconcile:${String(runReference)}:${itemId}`,
    })
  }

  let insertedAdjustments = 0
  if (adjustmentEntries.length) {
    const result = await addLedgerEntries(adjustmentEntries)
    insertedAdjustments = Number(result?.insertedCount || 0)
  }

  return {
    scannedPurchases: await InventoryPurchase.countDocuments({ restaurantId: tenantId }),
    adjustedItems: insertedAdjustments,
    conflictItems: conflictItemIds.length,
    conflictItemIds,
  }
}
