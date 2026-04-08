import MenuItem from '../models/MenuItem.js'
import Offer from '../models/Offer.js'
import Table from '../models/Table.js'
import mongoose from 'mongoose'
import { applyOffersToOrder } from './offerEngine.js'
import {
  buildOrderDraftItemsHash,
  getCachedDraftResult,
  resolveCatalogVersion,
  resolveRestaurantIdentityBySlug,
  setCachedDraftResult,
} from './orderDraftCache.js'

function buildHttpError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

async function buildOrderItems(restaurantId, items) {
  if (!Array.isArray(items) || !items.length) {
    throw buildHttpError('Order items are required', 400)
  }

  const quantityById = new Map()
  for (const item of items) {
    const id = String(item?.menuItemId || '').trim()
    if (!id) continue
    if (!mongoose.isValidObjectId(id)) {
      throw buildHttpError('One or more menu items are invalid', 400)
    }
    const quantity = Math.max(1, Number(item?.quantity || 1))
    quantityById.set(id, (quantityById.get(id) || 0) + quantity)
  }

  const ids = [...quantityById.keys()]
  const menuItems = await MenuItem.find({ _id: { $in: ids }, restaurantId, available: true })
    .select('_id name price')
    .lean()

  const menuMap = new Map(menuItems.map((item) => [String(item._id), item]))
  const orderItems = []

  for (const [menuItemId, quantity] of quantityById.entries()) {
    const menuItem = menuMap.get(menuItemId)
    if (!menuItem) continue
    orderItems.push({
      menuItemId: menuItem._id,
      name: menuItem.name,
      quantity,
      price: menuItem.price,
    })
  }

  if (!orderItems.length) {
    throw buildHttpError('No valid menu items selected', 400)
  }

  return orderItems
}

async function resolveRestaurantAndTable({ restaurantSlug, tableNumber, floorNumber }) {
  const restaurantLookup = await resolveRestaurantIdentityBySlug(restaurantSlug)

  if (!restaurantLookup) {
    throw buildHttpError('Restaurant not found', 404)
  }

  const normalizedTableNumber = Math.floor(Number(tableNumber))
  if (!Number.isFinite(normalizedTableNumber) || normalizedTableNumber < 1) {
    throw buildHttpError('Table number is invalid', 400)
  }

  const parsedFloorNumber = Number(floorNumber)
  const normalizedFloorNumber = Number.isFinite(parsedFloorNumber) && parsedFloorNumber >= 1 ? Math.floor(parsedFloorNumber) : null

  return {
    restaurant: {
      _id: restaurantLookup.restaurantId,
      slug: restaurantLookup.restaurantSlug,
    },
    normalizedTableNumber,
    requestedFloorNumber: normalizedFloorNumber,
  }
}

export async function buildCustomerOrderDraft({ restaurantSlug, tableNumber, floorNumber, items, couponCode = '' }) {
  const { restaurant, normalizedTableNumber, requestedFloorNumber } = await resolveRestaurantAndTable({
    restaurantSlug,
    tableNumber,
    floorNumber,
  })

  const itemsHash = buildOrderDraftItemsHash(items, couponCode)
  const menuVersionPromise = resolveCatalogVersion(restaurant._id)
  const tablePromise = Table.findOne({
    restaurantId: restaurant._id,
    tableNumber: normalizedTableNumber,
    active: true,
    ...(requestedFloorNumber ? { floorNumber: requestedFloorNumber } : {}),
  })
    .select('tableNumber floorNumber')
    .lean()

  const [menuVersion, table] = await Promise.all([menuVersionPromise, tablePromise])

  if (!table) {
    throw buildHttpError('Table not found for this restaurant', 404)
  }

  const cachedDraft = await getCachedDraftResult({
    restaurantId: restaurant._id,
    menuVersion,
    itemsHash,
  })

  if (cachedDraft) {
    return {
      ...cachedDraft,
      restaurant,
      tableNumber: normalizedTableNumber,
      floorNumber: Number(table.floorNumber || requestedFloorNumber || 1),
      cacheHit: true,
    }
  }

  const [orderItems, offers] = await Promise.all([
    buildOrderItems(restaurant._id, items),
    Offer.find({ restaurantId: restaurant._id, active: true })
      .select('name ruleType stackingPolicy priority conditions actions couponCode active startTime endTime createdAt updatedAt')
      .lean(),
  ])
  const pricing = applyOffersToOrder({
    orderItems,
    offers,
    couponCode,
  })

  await setCachedDraftResult({
    restaurantId: restaurant._id,
    menuVersion,
    itemsHash,
    draft: {
      restaurant,
      orderItems,
      pricing,
      restaurantSlug: restaurant.slug,
      tableNumber: normalizedTableNumber,
      floorNumber: Number(table.floorNumber || requestedFloorNumber || 1),
    },
  })

  return {
    restaurant,
    orderItems,
    pricing,
    restaurantSlug: restaurant.slug,
    tableNumber: normalizedTableNumber,
    floorNumber: Number(table.floorNumber || requestedFloorNumber || 1),
    cacheHit: false,
  }
}
