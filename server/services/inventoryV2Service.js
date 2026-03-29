import mongoose from 'mongoose'
import InventoryBalance from '../models/InventoryBalance.js'
import InventoryItem from '../models/InventoryItem.js'
import InventoryLocation from '../models/InventoryLocation.js'
import InventoryReservation from '../models/InventoryReservation.js'
import Recipe from '../models/Recipe.js'
import RecipeVersion from '../models/RecipeVersion.js'
import { addLedgerEntries } from './inventoryService.js'

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
  throw new Error(`Unsupported unit conversion: ${unit}`)
}

export async function ensureDefaultInventoryLocation(restaurantId, { session = null } = {}) {
  const tenantId = toObjectIdString(restaurantId)
  if (!tenantId) {
    throw new Error('restaurantId is required')
  }

  const existingDefault = await InventoryLocation.findOne({
    restaurantId: tenantId,
    isDefault: true,
    isActive: true,
  })
    .session(session || null)
    .lean()

  if (existingDefault) {
    return existingDefault
  }

  const fallback = await InventoryLocation.findOne({
    restaurantId: tenantId,
    isActive: true,
  })
    .sort({ createdAt: 1 })
    .session(session || null)

  if (fallback) {
    fallback.isDefault = true
    await fallback.save({ session })
    return fallback.toObject()
  }

  const created = await InventoryLocation.create(
    [
      {
        restaurantId: tenantId,
        code: 'MAIN',
        name: 'Main Store',
        type: 'Store',
        isDefault: true,
        isActive: true,
      },
    ],
    { session: session || undefined },
  )

  return created[0].toObject()
}

async function ensureBalanceRow({ restaurantId, locationId, inventoryItemId, baseUnit, session = null }) {
  const tenantId = toObjectIdString(restaurantId)
  const locId = toObjectIdString(locationId)
  const itemId = toObjectIdString(inventoryItemId)

  let balance = await InventoryBalance.findOne({
    restaurantId: tenantId,
    locationId: locId,
    inventoryItemId: itemId,
  }).session(session || null)

  if (balance) return balance

  const created = await InventoryBalance.create(
    [
      {
        restaurantId: tenantId,
        locationId: locId,
        inventoryItemId: itemId,
        baseUnit,
        onHandQty: 0,
        reservedQty: 0,
        availableQty: 0,
      },
    ],
    { session: session || undefined },
  )

  return created[0]
}

async function applyBalanceDelta({
  restaurantId,
  locationId,
  inventoryItemId,
  baseUnit,
  onHandDelta = 0,
  reservedDelta = 0,
  policy = 'soft',
  session = null,
}) {
  const balance = await ensureBalanceRow({ restaurantId, locationId, inventoryItemId, baseUnit, session })

  const nextOnHand = round6(Number(balance.onHandQty || 0) + Number(onHandDelta || 0))
  const nextReserved = round6(Number(balance.reservedQty || 0) + Number(reservedDelta || 0))
  const nextAvailable = round6(nextOnHand - nextReserved)

  if (nextReserved < -0.000001) {
    throw new Error('Reserved stock cannot become negative')
  }

  if (policy === 'hard' && nextAvailable < -0.000001) {
    throw new Error('Insufficient available stock under hard policy')
  }

  if (policy === 'soft' && nextAvailable < -0.000001) {
    // allow soft negative availability while still recording full traceability
  }

  balance.onHandQty = nextOnHand
  balance.reservedQty = Math.max(0, nextReserved)
  balance.availableQty = round6(nextOnHand - balance.reservedQty)
  balance.rowVersion = Number(balance.rowVersion || 0) + 1
  await balance.save({ session: session || undefined })

  return balance
}

async function getDemandRowsFromOrderItems({ restaurantId, orderItems = [], session = null }) {
  const menuItemIds = [...new Set(orderItems.map((item) => toObjectIdString(item?.menuItemId)).filter(Boolean))]
  if (!menuItemIds.length) return []

  const recipes = await Recipe.find({
    restaurantId,
    menuItemId: { $in: menuItemIds },
  })
    .select('menuItemId ingredients version')
    .session(session || null)
    .lean()

  const recipeByMenuItemId = new Map(recipes.map((row) => [toObjectIdString(row.menuItemId), row]))

  const demandByItem = new Map()
  const recipeVersionRows = []

  for (const orderItem of orderItems) {
    const menuItemId = toObjectIdString(orderItem?.menuItemId)
    const orderQty = Number(orderItem?.quantity || 0)
    if (!menuItemId || orderQty <= 0) continue

    const recipe = recipeByMenuItemId.get(menuItemId)
    if (!recipe || !Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
      continue
    }

    const version = Math.max(1, Number(recipe.version || 1))
    const normalizedIngredients = recipe.ingredients.map((ingredient) => {
      const itemId = toObjectIdString(ingredient?.inventoryItemId)
      const ingredientQty = Number(ingredient?.quantity || 0)
      const converted = unitToBase(ingredient?.unit)
      return {
        inventoryItemId: itemId,
        quantity: round6(ingredientQty * converted.factor),
        unit: converted.unit,
      }
    }).filter((row) => row.inventoryItemId && row.quantity > 0)

    recipeVersionRows.push({
      restaurantId,
      menuItemId,
      version,
      ingredients: normalizedIngredients,
    })

    for (const ingredient of normalizedIngredients) {
      const key = ingredient.inventoryItemId
      const current = demandByItem.get(key) || {
        inventoryItemId: key,
        unit: ingredient.unit,
        quantity: 0,
        recipeVersion: version,
      }
      if (current.unit !== ingredient.unit) {
        throw new Error('Recipe ingredient unit mismatch for same inventory item')
      }
      current.quantity = round6(current.quantity + ingredient.quantity * orderQty)
      current.recipeVersion = Math.max(current.recipeVersion, version)
      demandByItem.set(key, current)
    }
  }

  if (recipeVersionRows.length) {
    const ops = recipeVersionRows.map((row) => ({
      updateOne: {
        filter: {
          restaurantId: row.restaurantId,
          menuItemId: row.menuItemId,
          version: row.version,
        },
        update: {
          $setOnInsert: {
            restaurantId: row.restaurantId,
            menuItemId: row.menuItemId,
            version: row.version,
            ingredients: row.ingredients,
          },
        },
        upsert: true,
      },
    }))

    await RecipeVersion.bulkWrite(ops, {
      ordered: false,
      session: session || undefined,
    })
  }

  return [...demandByItem.values()]
}

export async function reserveStockForOrder({
  restaurantId,
  order,
  createdBy = null,
  locationId = null,
  policy = 'soft',
  reservationTtlMinutes = 240,
  idempotencyPrefix = 'order',
  session = null,
}) {
  const tenantId = toObjectIdString(restaurantId || order?.restaurantId)
  const orderId = toObjectIdString(order?._id)
  if (!tenantId || !orderId) {
    return { reservedCount: 0, skipped: true }
  }

  const defaultLocation = locationId
    ? { _id: locationId }
    : await ensureDefaultInventoryLocation(tenantId, { session })

  const demandRows = await getDemandRowsFromOrderItems({
    restaurantId: tenantId,
    orderItems: Array.isArray(order?.items) ? order.items : [],
    session,
  })

  if (!demandRows.length) {
    return { reservedCount: 0, skipped: true }
  }

  const itemIds = demandRows.map((row) => row.inventoryItemId)
  const items = await InventoryItem.find({ _id: { $in: itemIds }, restaurantId: tenantId })
    .select('_id name defaultUnit')
    .session(session || null)
    .lean()

  const itemById = new Map(items.map((row) => [String(row._id), row]))
  const expiresAt = new Date(Date.now() + Math.max(5, Number(reservationTtlMinutes || 240)) * 60 * 1000)

  const ledgerEntries = []
  const reservationOps = []

  for (const demand of demandRows) {
    const item = itemById.get(demand.inventoryItemId)
    if (!item) continue

    await applyBalanceDelta({
      restaurantId: tenantId,
      locationId: defaultLocation._id,
      inventoryItemId: demand.inventoryItemId,
      baseUnit: demand.unit,
      reservedDelta: demand.quantity,
      onHandDelta: 0,
      policy,
      session,
    })

    const idempotencyKey = `${idempotencyPrefix}:${orderId}:reserve:${demand.inventoryItemId}`

    reservationOps.push({
      updateOne: {
        filter: { restaurantId: tenantId, idempotencyKey },
        update: {
          $setOnInsert: {
            restaurantId: tenantId,
            orderId,
            locationId: defaultLocation._id,
            inventoryItemId: demand.inventoryItemId,
            unit: demand.unit,
            reservedQty: demand.quantity,
            consumedQty: 0,
            releasedQty: 0,
            status: 'active',
            recipeVersion: demand.recipeVersion,
            idempotencyKey,
            expiresAt,
            metadata: {
              itemName: String(item.name || ''),
            },
          },
        },
        upsert: true,
      },
    })

    ledgerEntries.push({
      restaurantId: tenantId,
      locationId: defaultLocation._id,
      inventoryItemId: demand.inventoryItemId,
      type: 'RESERVATION',
      quantity: demand.quantity,
      direction: 0,
      unit: demand.unit,
      referenceType: 'order_reservation',
      referenceId: orderId,
      metadata: {
        orderId,
        recipeVersion: demand.recipeVersion,
      },
      createdBy,
      idempotencyKey,
    })
  }

  if (reservationOps.length) {
    await InventoryReservation.bulkWrite(reservationOps, {
      ordered: false,
      session: session || undefined,
    })
  }

  if (ledgerEntries.length) {
    await addLedgerEntries(ledgerEntries, { session })
  }

  return { reservedCount: ledgerEntries.length, locationId: String(defaultLocation._id) }
}

export async function releaseReservationsForOrder({
  restaurantId,
  orderId,
  createdBy = null,
  reason = 'order_cancelled',
  session = null,
}) {
  const tenantId = toObjectIdString(restaurantId)
  const normalizedOrderId = toObjectIdString(orderId)
  if (!tenantId || !normalizedOrderId) {
    return { releasedCount: 0 }
  }

  const reservations = await InventoryReservation.find({
    restaurantId: tenantId,
    orderId: normalizedOrderId,
    status: 'active',
  }).session(session || null)

  if (!reservations.length) {
    return { releasedCount: 0 }
  }

  const ledgerEntries = []

  for (const row of reservations) {
    await applyBalanceDelta({
      restaurantId: tenantId,
      locationId: row.locationId,
      inventoryItemId: row.inventoryItemId,
      baseUnit: row.unit,
      reservedDelta: -Number(row.reservedQty || 0),
      onHandDelta: 0,
      policy: 'soft',
      session,
    })

    row.releasedQty = Number(row.reservedQty || 0)
    row.status = 'released'
    await row.save({ session: session || undefined })

    ledgerEntries.push({
      restaurantId: tenantId,
      locationId: row.locationId,
      inventoryItemId: row.inventoryItemId,
      type: 'RELEASE',
      quantity: Number(row.reservedQty || 0),
      direction: 0,
      unit: row.unit,
      referenceType: 'order_reservation_release',
      referenceId: normalizedOrderId,
      metadata: { reason },
      createdBy,
      idempotencyKey: `order:${normalizedOrderId}:release:${String(row.inventoryItemId)}`,
    })
  }

  if (ledgerEntries.length) {
    await addLedgerEntries(ledgerEntries, { session })
  }

  return { releasedCount: ledgerEntries.length }
}

export async function consumeReservationsForOrder({
  restaurantId,
  orderId,
  createdBy = null,
  cycle = 1,
  policy = 'soft',
  session = null,
}) {
  const tenantId = toObjectIdString(restaurantId)
  const normalizedOrderId = toObjectIdString(orderId)
  if (!tenantId || !normalizedOrderId) {
    return { consumedCount: 0 }
  }

  const reservations = await InventoryReservation.find({
    restaurantId: tenantId,
    orderId: normalizedOrderId,
    status: 'active',
  }).session(session || null)

  if (!reservations.length) {
    return { consumedCount: 0 }
  }

  const ledgerEntries = []

  for (const row of reservations) {
    const qty = Number(row.reservedQty || 0)
    if (qty <= 0) continue

    await applyBalanceDelta({
      restaurantId: tenantId,
      locationId: row.locationId,
      inventoryItemId: row.inventoryItemId,
      baseUnit: row.unit,
      reservedDelta: -qty,
      onHandDelta: -qty,
      policy,
      session,
    })

    row.consumedQty = qty
    row.status = 'consumed'
    await row.save({ session: session || undefined })

    ledgerEntries.push({
      restaurantId: tenantId,
      locationId: row.locationId,
      inventoryItemId: row.inventoryItemId,
      type: 'CONSUMPTION',
      quantity: qty,
      direction: -1,
      unit: row.unit,
      referenceType: 'order',
      referenceId: normalizedOrderId,
      metadata: {
        reason: 'order_completed_consumption_from_reservation',
        cycle: Number(cycle || 1),
        reservationId: String(row._id),
        recipeVersion: Number(row.recipeVersion || 1),
      },
      createdBy,
      idempotencyKey: `order:${normalizedOrderId}:cycle:${Number(cycle || 1)}:consumption:${String(row.inventoryItemId)}`,
    })
  }

  if (ledgerEntries.length) {
    await addLedgerEntries(ledgerEntries, { session })
  }

  return { consumedCount: ledgerEntries.length }
}

export async function getAvailableStockByLocation({
  restaurantId,
  locationId,
  inventoryItemIds = [],
}) {
  const tenantId = toObjectIdString(restaurantId)
  const locId = toObjectIdString(locationId)
  if (!tenantId || !locId) {
    return []
  }

  const filter = {
    restaurantId: new mongoose.Types.ObjectId(tenantId),
    locationId: new mongoose.Types.ObjectId(locId),
  }

  const uniqueIds = [...new Set(inventoryItemIds.map((id) => toObjectIdString(id)).filter(Boolean))]
  if (uniqueIds.length) {
    filter.inventoryItemId = {
      $in: uniqueIds.map((id) => new mongoose.Types.ObjectId(id)),
    }
  }

  return InventoryBalance.find(filter)
    .select('inventoryItemId baseUnit onHandQty reservedQty availableQty rowVersion')
    .lean()
}
