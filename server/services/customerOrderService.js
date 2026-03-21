import MenuItem from '../models/MenuItem.js'
import Offer from '../models/Offer.js'
import Restaurant from '../models/Restaurant.js'
import Table from '../models/Table.js'
import { applyOffersToOrder } from './offerEngine.js'

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
  const restaurant = await Restaurant.findOne({ slug: restaurantSlug })
    .select('_id name slug paymentConfig')
    .lean()

  if (!restaurant) {
    throw buildHttpError('Restaurant not found', 404)
  }

  const normalizedTableNumber = Math.floor(Number(tableNumber))
  if (!Number.isFinite(normalizedTableNumber) || normalizedTableNumber < 1) {
    throw buildHttpError('Table number is invalid', 400)
  }

  const parsedFloorNumber = Number(floorNumber)
  const normalizedFloorNumber = Number.isFinite(parsedFloorNumber) && parsedFloorNumber >= 1 ? Math.floor(parsedFloorNumber) : null

  const table = await Table.findOne({
    restaurantId: restaurant._id,
    tableNumber: normalizedTableNumber,
    active: true,
    ...(normalizedFloorNumber ? { floorNumber: normalizedFloorNumber } : {}),
  })
    .select('tableNumber floorNumber active')
    .lean()

  if (!table) {
    throw buildHttpError('Table not found for this restaurant', 404)
  }

  return {
    restaurant,
    normalizedTableNumber,
    resolvedFloorNumber: Number(table.floorNumber || normalizedFloorNumber || 1),
  }
}

export async function buildCustomerOrderDraft({ restaurantSlug, tableNumber, floorNumber, items, couponCode = '' }) {
  const { restaurant, normalizedTableNumber, resolvedFloorNumber } = await resolveRestaurantAndTable({
    restaurantSlug,
    tableNumber,
    floorNumber,
  })

  const orderItems = await buildOrderItems(restaurant._id, items)
  const offers = await Offer.find({ restaurantId: restaurant._id, active: true }).lean()
  const pricing = applyOffersToOrder({
    orderItems,
    offers,
    couponCode,
  })

  return {
    restaurant,
    orderItems,
    pricing,
    restaurantSlug: restaurant.slug,
    tableNumber: normalizedTableNumber,
    floorNumber: resolvedFloorNumber,
  }
}
