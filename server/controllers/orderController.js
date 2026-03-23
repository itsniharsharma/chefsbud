import Order from '../models/Order.js'
import Restaurant from '../models/Restaurant.js'
import Table from '../models/Table.js'
import bcrypt from 'bcrypt'
import { buildCustomerOrderDraft } from '../services/customerOrderService.js'
import { sendKotReprintAuditEmail } from '../services/emailService.js'
import {
  revertCompletedOrderAnalytics,
  syncCompletedOrderAnalytics,
} from '../services/itemAnalyticsService.js'
import { rebuildOrderMetricsForDate } from '../services/orderMetricsService.js'
import { invalidateCacheByTags } from '../services/responseCache.js'
import { emitOrderChanged } from '../realtime/orderEvents.js'
import { logger } from '../utils/logger.js'
import { resolveRequestRestaurant } from '../utils/requestRestaurant.js'

const PUBLIC_TABLE_ORDER_LIMIT = Math.min(50, Math.max(5, Number(process.env.PUBLIC_TABLE_ORDER_LIMIT || 25)))

const orderListProjection =
  '_id floorNumber tableNumber items subtotalAmount discountTotal appliedOffers couponCode customerNote totalAmount paymentStatus billPrinted billPrintedAt kotPrinted kotPrintedAt orderStatus createdAt completedAt hiddenFromActive deletedByOwnerAt paymentProvider providerOrderId providerPaymentId paymentCapturedAt paymentFailureReason'

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

function parseFloorNumberFilter(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null
  }

  return parsed
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
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    if (String(restaurant._id) !== req.params.restaurantId) {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const pagination = buildPagination(req.query)
    const scope = req.query.scope === 'today' ? 'today' : 'all'
    const floorNumber = parseFloorNumberFilter(req.query.floorNumber)

    const view = req.query.view === 'completed' ? 'completed' : 'active'
    const query = buildOrderQuery({
      restaurantId: req.params.restaurantId,
      view,
      status: req.query.status,
      scope,
    })

    if (floorNumber !== null) {
      query.floorNumber = floorNumber
    }

    const rawOrders = await listOrdersByQuery(query, pagination)

    const orders = await enrichOrdersWithFloorNumbers(restaurant._id, rawOrders)

    return res.json(orders)
  } catch (error) {
    next(error)
  }
}

export async function updateOrderStatus(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const { orderStatus } = req.body
    const allowed = ['Pending', 'Confirmed', 'Preparing', 'Ready', 'Served', 'Completed']
    if (!allowed.includes(orderStatus)) {
      return res.status(400).json({ message: 'Invalid order status' })
    }

    const existingOrder = await Order.findOne({
      _id: req.params.orderId,
      restaurantId: restaurant._id,
    })
      .select('_id restaurantId items subtotalAmount totalAmount orderStatus completedAt createdAt updatedAt analyticsTrackedAt')
      .lean()

    if (!existingOrder) {
      return res.status(404).json({ message: 'Order not found' })
    }

    const wasCompleted = existingOrder.orderStatus === 'Completed'
    const isCompleted = orderStatus === 'Completed'
    const update = {
      orderStatus,
      completedAt: isCompleted ? new Date() : null,
      hiddenFromActive: isCompleted,
      deletedByOwnerAt: isCompleted ? new Date() : null,
      ...(wasCompleted && !isCompleted ? { analyticsTrackedAt: null } : {}),
    }

    if (wasCompleted && !isCompleted && existingOrder.analyticsTrackedAt) {
      await revertCompletedOrderAnalytics(existingOrder)
    }

    const order = await Order.findOneAndUpdate(
      { _id: req.params.orderId, restaurantId: restaurant._id },
      { $set: update },
      { new: true, runValidators: true },
    )

    if (isCompleted && !wasCompleted) {
      await syncCompletedOrderAnalytics(order._id)
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
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const order = await Order.findOne({ _id: req.params.orderId, restaurantId: restaurant._id })
      .select('_id orderStatus tableNumber createdAt')
      .lean()

    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }

    if (!['Served', 'Completed'].includes(order.orderStatus)) {
      return res.status(400).json({ message: 'Order can be deleted only after Served or Completed' })
    }

    const fullOrder = await Order.findOne({ _id: req.params.orderId, restaurantId: restaurant._id }).lean()
    if (fullOrder?.analyticsTrackedAt) {
      await revertCompletedOrderAnalytics(fullOrder)
    }

    await Order.deleteOne({ _id: req.params.orderId, restaurantId: restaurant._id })
    await rebuildOrderMetricsForDate({
      restaurantId: restaurant._id,
      date: order.createdAt || new Date(),
    })

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

    await rebuildOrderMetricsForDate({
      restaurantId: draft.restaurant._id,
      date: order.createdAt || new Date(),
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
      paymentStatus: { $in: ['Paid', 'Unpaid'] },
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
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const existingOrder = await Order.findOne({ _id: req.params.orderId, restaurantId: restaurant._id })
      .select('_id tableNumber floorNumber kotPrinted kotPrintCount')
      .lean()

    if (!existingOrder) {
      return res.status(404).json({ message: 'Order not found' })
    }

    const isReprint = Boolean(existingOrder.kotPrinted)
    const reprintPasskey = String(req.body?.reprintPasskey || '')
    const reprintReason = String(req.body?.reprintReason || '').trim()
    let reprintConfigHash = ''

    if (isReprint) {
      const secureRestaurant = await Restaurant.findById(restaurant._id)
        .select('kotReprintConfig.passkeyHash')
        .lean()
      reprintConfigHash = String(secureRestaurant?.kotReprintConfig?.passkeyHash || '')

      if (!reprintConfigHash) {
        return res.status(403).json({ message: 'Manager must configure a KOT reprint passkey in Settings before reprinting.' })
      }

      if (!reprintReason || reprintReason.length < 3 || reprintReason.length > 240) {
        return res.status(400).json({ message: 'A reprint reason between 3 and 240 characters is required.' })
      }

      const validPasskey = await bcrypt.compare(reprintPasskey, reprintConfigHash)
      if (!validPasskey) {
        return res.status(403).json({ message: 'Invalid KOT reprint passkey.' })
      }
    }

    const printedAt = new Date()
    const actorName = req.user?.role === 'staff'
      ? req.user?.staffDisplayName || req.user?.staffUsername || 'Staff'
      : req.user?.name || 'Manager'

    const update = {
      kotPrinted: true,
      kotPrintedAt: printedAt,
      kotPrintCount: Math.max(1, Number(existingOrder.kotPrintCount || 0) + 1),
    }

    if (isReprint) {
      update.lastKotReprintReason = reprintReason
      update.lastKotReprintBy = actorName
      update.lastKotReprintAt = printedAt
    }

    const order = await Order.findOneAndUpdate(
      { _id: req.params.orderId, restaurantId: restaurant._id },
      { $set: update },
      { new: true, runValidators: true },
    )

    if (isReprint) {
      sendKotReprintAuditEmail({
        to: req.user?.email,
        restaurantName: restaurant.name,
        orderId: String(order._id),
        tableNumber: order.tableNumber,
        floorNumber: order.floorNumber,
        actorName,
        actorRole: req.user?.role === 'staff' ? 'staff' : 'manager',
        reason: reprintReason,
        reprintedAt: printedAt,
      }).catch((error) => {
        logger.warn('kot_reprint_email_failed', {
          orderId: String(order._id),
          restaurantId: String(restaurant._id),
          message: error?.message || 'failed_to_send_kot_reprint_email',
        })
      })
    }

    invalidateCacheByTags([
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
    const restaurant = await resolveRequestRestaurant(req)
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
