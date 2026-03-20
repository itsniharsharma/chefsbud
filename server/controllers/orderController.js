import Order from '../models/Order.js'
import Restaurant from '../models/Restaurant.js'
import Table from '../models/Table.js'
import { buildCustomerOrderDraft } from '../services/customerOrderService.js'
import { invalidateCacheByTags } from '../services/responseCache.js'
import { emitOrderChanged } from '../realtime/orderEvents.js'

const PUBLIC_TABLE_ORDER_LIMIT = Math.min(50, Math.max(5, Number(process.env.PUBLIC_TABLE_ORDER_LIMIT || 25)))

const orderListProjection =
  '_id floorNumber tableNumber items subtotalAmount discountTotal appliedOffers couponCode customerNote totalAmount paymentStatus billPrinted billPrintedAt kotPrinted kotPrintedAt orderStatus createdAt completedAt hiddenFromActive deletedByOwnerAt paymentProvider providerOrderId providerPaymentId paymentCapturedAt paymentFailureReason'

async function getOwnerRestaurant(ownerId) {
  return Restaurant.findOne({ ownerId }).select('_id slug').lean()
}

function buildOrderQuery({ restaurantId, view, status, scope }) {
  const query = { restaurantId, isArchived: false }

  if (view === 'completed') {
    query.orderStatus = 'Completed'
  } else {
    query.hiddenFromActive = { $ne: true }
    if (status && status !== 'All') {
      query.orderStatus = status
    }
  }

  if (scope === 'today') {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    query.createdAt = { $gte: start }
  }

  return query
}

function buildPagination({ page, limit }) {
  const safePage = Math.max(1, Number(page || 1))
  const safeLimit = Math.min(100, Math.max(1, Number(limit || 50)))

  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
  }
}

async function listOrdersByQuery(query, pagination) {
  return Order.find(query)
    .sort({ createdAt: -1 })
    .skip(pagination.skip)
    .limit(pagination.limit)
    .select(orderListProjection)
    .lean()
}

async function enrichOrdersWithFloorNumbers(restaurantId, orders = []) {
  if (!Array.isArray(orders) || !orders.length) {
    return orders
  }

  const missingFloorOrders = orders.filter((order) => !Number.isFinite(Number(order.floorNumber)) || Number(order.floorNumber) < 1)
  if (!missingFloorOrders.length) {
    return orders
  }

  const uniqueTableNumbers = [...new Set(missingFloorOrders.map((order) => Number(order.tableNumber)).filter((num) => Number.isFinite(num) && num > 0))]

  if (!uniqueTableNumbers.length) {
    return orders.map((order) => ({ ...order, floorNumber: Number(order.floorNumber || 1) }))
  }

  const tables = await Table.find({
    restaurantId,
    tableNumber: { $in: uniqueTableNumbers },
  })
    .select('tableNumber floorNumber')
    .lean()

  const floorByTableNumber = new Map(tables.map((table) => [Number(table.tableNumber), Number(table.floorNumber || 1)]))

  return orders.map((order) => {
    const currentFloor = Number(order.floorNumber)
    if (Number.isFinite(currentFloor) && currentFloor >= 1) {
      return order
    }

    return {
      ...order,
      floorNumber: Number(floorByTableNumber.get(Number(order.tableNumber)) || 1),
    }
  })
}

export async function getOrders(req, res, next) {
  try {
    const restaurant = await getOwnerRestaurant(req.user._id)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    if (String(restaurant._id) !== req.params.restaurantId) {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const pagination = buildPagination(req.query)
    const scope = req.query.scope === 'today' ? 'today' : 'all'

    const view = req.query.view === 'completed' ? 'completed' : 'active'
    const rawOrders = await listOrdersByQuery(
      buildOrderQuery({
        restaurantId: req.params.restaurantId,
        view,
        status: req.query.status,
        scope,
      }),
      pagination,
    )

    const orders = await enrichOrdersWithFloorNumbers(restaurant._id, rawOrders)

    return res.json(orders)
  } catch (error) {
    next(error)
  }
}

export async function updateOrderStatus(req, res, next) {
  try {
    const restaurant = await getOwnerRestaurant(req.user._id)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const { orderStatus } = req.body
    const allowed = ['Pending', 'Confirmed', 'Preparing', 'Ready', 'Served', 'Completed']
    if (!allowed.includes(orderStatus)) {
      return res.status(400).json({ message: 'Invalid order status' })
    }

    const isCompleted = orderStatus === 'Completed'
    const update = {
      orderStatus,
      completedAt: isCompleted ? new Date() : null,
      hiddenFromActive: isCompleted,
      deletedByOwnerAt: isCompleted ? new Date() : null,
    }

    const order = await Order.findOneAndUpdate({ _id: req.params.orderId, restaurantId: restaurant._id }, { $set: update }, { new: true, runValidators: true })
    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }

    invalidateCacheByTags([
      `analytics:${String(restaurant._id)}`,
      `orders:board:${String(restaurant._id)}`,
      `orders:table:${restaurant.slug}:${order.tableNumber}`,
      `orders:order:${String(order._id)}`,
    ])
    emitOrderChanged(restaurant._id, {
      type: 'status-updated',
      orderId: String(order._id),
      orderStatus: order.orderStatus,
    })
    return res.json(order)
  } catch (error) {
    next(error)
  }
}

export async function deleteOrder(req, res, next) {
  try {
    const restaurant = await getOwnerRestaurant(req.user._id)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const order = await Order.findOne({ _id: req.params.orderId, restaurantId: restaurant._id })
      .select('_id orderStatus tableNumber')
      .lean()

    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }

    if (!['Served', 'Completed'].includes(order.orderStatus)) {
      return res.status(400).json({ message: 'Order can be deleted only after Served or Completed' })
    }

    await Order.deleteOne({ _id: req.params.orderId, restaurantId: restaurant._id })

    invalidateCacheByTags([
      `analytics:${String(restaurant._id)}`,
      `orders:board:${String(restaurant._id)}`,
      `orders:table:${restaurant.slug}:${order.tableNumber}`,
      `orders:order:${String(req.params.orderId)}`,
    ])
    emitOrderChanged(restaurant._id, {
      type: 'deleted',
      orderId: String(req.params.orderId),
    })
    return res.json({ success: true, deleted: true })
  } catch (error) {
    next(error)
  }
}

export async function createOrder(req, res, next) {
  try {
    const { restaurantSlug, tableNumber, floorNumber, items, couponCode = '', customerNote = '' } = req.body

    const draft = await buildCustomerOrderDraft({
      restaurantSlug,
      tableNumber,
      floorNumber,
      items,
      couponCode,
    })

    const order = await Order.create({
      restaurantId: draft.restaurant._id,
      restaurantSlug: draft.restaurantSlug,
      floorNumber: draft.floorNumber,
      tableNumber: draft.tableNumber,
      items: draft.orderItems,
      subtotalAmount: draft.pricing.subtotalAmount,
      discountTotal: draft.pricing.discountTotal,
      appliedOffers: draft.pricing.appliedOffers,
      couponCode: draft.pricing.couponCodeApplied,
      customerNote: String(customerNote || '').trim(),
      totalAmount: draft.pricing.totalAmount,
      paymentStatus: 'Unpaid',
      orderStatus: 'Pending',
      hiddenFromActive: false,
    })

    invalidateCacheByTags([`analytics:${String(draft.restaurant._id)}`])
    invalidateCacheByTags([
      `orders:board:${String(draft.restaurant._id)}`,
      `orders:table:${restaurantSlug}:${draft.tableNumber}`,
      `orders:order:${String(order._id)}`,
    ])
    emitOrderChanged(draft.restaurant._id, {
      type: 'created',
      orderId: String(order._id),
      orderStatus: order.orderStatus,
    })

    return res.status(201).json(order)
  } catch (error) {
    next(error)
  }
}

export async function getPublicOrderStatus(req, res, next) {
  try {
    const { restaurantSlug, tableNumber, orderId } = req.params

    const order = await Order.findOne({
      _id: orderId,
      restaurantSlug,
      tableNumber: Number(tableNumber),
      isArchived: false,
    })
      .select(
        '_id floorNumber tableNumber items subtotalAmount discountTotal appliedOffers couponCode customerNote totalAmount paymentStatus kotPrinted kotPrintedAt orderStatus createdAt',
      )
      .lean()

    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }

    return res.json(order)
  } catch (error) {
    next(error)
  }
}

export async function getPublicTableOrders(req, res, next) {
  try {
    const { restaurantSlug, tableNumber } = req.params

    const orders = await Order.find({
      restaurantSlug,
      tableNumber: Number(tableNumber),
      isArchived: false,
      paymentStatus: { $nin: ['Pending', 'Failed'] },
    })
      .sort({ createdAt: -1 })
      .limit(PUBLIC_TABLE_ORDER_LIMIT)
      .select(
        '_id floorNumber tableNumber items subtotalAmount discountTotal appliedOffers couponCode customerNote totalAmount paymentStatus kotPrinted kotPrintedAt orderStatus createdAt',
      )
      .lean()

    return res.json(orders)
  } catch (error) {
    next(error)
  }
}

export async function markOrderKotPrinted(req, res, next) {
  try {
    const restaurant = await getOwnerRestaurant(req.user._id)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const order = await Order.findOneAndUpdate(
      { _id: req.params.orderId, restaurantId: restaurant._id },
      {
        $set: {
          kotPrinted: true,
          kotPrintedAt: new Date(),
        },
      },
      { new: true, runValidators: true },
    )

    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }

    invalidateCacheByTags([
      `analytics:${String(restaurant._id)}`,
      `orders:board:${String(restaurant._id)}`,
      `orders:table:${restaurant.slug}:${order.tableNumber}`,
      `orders:order:${String(order._id)}`,
    ])
    emitOrderChanged(restaurant._id, {
      type: 'kot-printed',
      orderId: String(order._id),
      kotPrinted: true,
      kotPrintedAt: order.kotPrintedAt,
    })

    return res.json(order)
  } catch (error) {
    next(error)
  }
}

export async function markOrderBillPrinted(req, res, next) {
  try {
    const restaurant = await getOwnerRestaurant(req.user._id)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const order = await Order.findOneAndUpdate(
      { _id: req.params.orderId, restaurantId: restaurant._id },
      {
        $set: {
          billPrinted: true,
          billPrintedAt: new Date(),
        },
      },
      { new: true, runValidators: true },
    )

    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }

    invalidateCacheByTags([
      `analytics:${String(restaurant._id)}`,
      `orders:board:${String(restaurant._id)}`,
      `orders:table:${restaurant.slug}:${order.tableNumber}`,
      `orders:order:${String(order._id)}`,
    ])
    emitOrderChanged(restaurant._id, {
      type: 'bill-printed',
      orderId: String(order._id),
      billPrinted: true,
      billPrintedAt: order.billPrintedAt,
    })

    return res.json(order)
  } catch (error) {
    next(error)
  }
}
