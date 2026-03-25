import mongoose from 'mongoose'
import Order from '../models/Order.js'
import Restaurant from '../models/Restaurant.js'
import Table from '../models/Table.js'
import bcrypt from 'bcrypt'
import { buildCustomerOrderDraft } from '../services/customerOrderService.js'
import { buildValidatedBillAdjustments } from '../services/orderBillComposerService.js'
import { sendKotReprintAuditEmail } from '../services/emailService.js'
import {
  processOrderConsumption,
  reverseOrderConsumption,
} from '../services/inventoryService.js'
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
const ORDER_STATUS_ALLOWED = ['Pending', 'Confirmed', 'Preparing', 'Ready', 'Served', 'Completed']
const METRICS_ASYNC_ENABLED = String(process.env.METRICS_ASYNC_ENABLED || 'true') === 'true'

const orderListProjection =
  '_id floorNumber tableNumber items subtotalAmount discountTotal billAdjustments billAdjustmentSubtotal billFinalTotalAmount appliedOffers couponCode customerNote totalAmount paymentStatus billPrinted billPrintedAt kotPrinted kotPrintedAt orderStatus inventoryConsumptionCycle inventoryProcessedAt createdAt completedAt hiddenFromActive deletedByOwnerAt paymentProvider providerOrderId providerPaymentId paymentCapturedAt paymentFailureReason'

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function respondRestaurantNotFound(res) {
  return res.status(404).json({ message: 'Restaurant not found' })
}

function buildOrderCacheTags({ restaurant, tableNumber, orderId, includeAnalytics = false }) {
  const tags = [
    `orders:board:${String(restaurant._id)}`,
    `orders:table:${restaurant.slug}:${tableNumber}`,
    `orders:order:${String(orderId)}`,
  ]

  if (includeAnalytics) {
    tags.unshift(`analytics:${String(restaurant._id)}`)
  }

  return tags
}

function publishOrderChange({ restaurantId, type, orderId, extra = {} }) {
  emitOrderChanged(restaurantId, {
    type,
    orderId: String(orderId),
    ...extra,
  })
}

function runNonCriticalTask(taskName, taskFn) {
  if (typeof taskFn !== 'function') return

  setImmediate(async () => {
    try {
      await taskFn()
    } catch (error) {
      logger.warn('non_critical_task_failed', {
        taskName,
        message: error?.message || 'unknown_error',
      })
    }
  })
}

async function runMetricsTask(taskName, taskFn) {
  if (!METRICS_ASYNC_ENABLED) {
    return taskFn()
  }

  runNonCriticalTask(taskName, taskFn)
  return null
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
      return respondRestaurantNotFound(res)
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
      return respondRestaurantNotFound(res)
    }

    const { orderStatus } = req.body
    if (!ORDER_STATUS_ALLOWED.includes(orderStatus)) {
      return res.status(400).json({ message: 'Invalid order status' })
    }

    const existingOrder = await Order.findOne({
      _id: req.params.orderId,
      restaurantId: restaurant._id,
    })
      .select('_id restaurantId items subtotalAmount totalAmount orderStatus inventoryConsumptionCycle inventoryProcessedAt completedAt createdAt updatedAt analyticsTrackedAt')
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
      await runMetricsTask('revert_completed_order_analytics', () => revertCompletedOrderAnalytics(existingOrder))
    }

    const session = await mongoose.startSession()
    let order = null

    try {
      await session.withTransaction(async () => {
        order = await Order.findOneAndUpdate(
          { _id: req.params.orderId, restaurantId: restaurant._id },
          { $set: update },
          { new: true, runValidators: true, session },
        )

        if (!order) {
          throw new Error('Order not found')
        }

        if (isCompleted && !wasCompleted && !existingOrder.inventoryProcessedAt) {
          const cycle = Math.max(0, Number(existingOrder.inventoryConsumptionCycle || 0)) + 1
          await processOrderConsumption(order, {
            session,
            createdBy: req.user?._id || null,
            cycle,
          })
          order.inventoryConsumptionCycle = cycle
          order.inventoryProcessedAt = new Date()
          await order.save({ session })
        }

        if (!isCompleted && wasCompleted && existingOrder.inventoryProcessedAt) {
          const cycle = Math.max(1, Number(existingOrder.inventoryConsumptionCycle || 1))
          await reverseOrderConsumption(existingOrder, {
            session,
            createdBy: req.user?._id || null,
            cycle,
          })
          order.inventoryProcessedAt = null
          await order.save({ session })
        }
      })
    } finally {
      session.endSession()
    }

    if (isCompleted && !wasCompleted) {
      await runMetricsTask('sync_completed_order_analytics', () => syncCompletedOrderAnalytics(order._id))
    }

    invalidateCacheByTags(
      buildOrderCacheTags({
        restaurant,
        tableNumber: order.tableNumber,
        orderId: order._id,
        includeAnalytics: true,
      }),
    )
    publishOrderChange({
      restaurantId: restaurant._id,
      type: 'status-updated',
      orderId: order._id,
      extra: { orderStatus: order.orderStatus },
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
      return respondRestaurantNotFound(res)
    }

    const order = await Order.findOne({ _id: req.params.orderId, restaurantId: restaurant._id }).lean()

    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }

    if (!['Served', 'Completed'].includes(order.orderStatus)) {
      return res.status(400).json({ message: 'Order can be deleted only after Served or Completed' })
    }

    if (order.analyticsTrackedAt) {
      await runMetricsTask('revert_completed_order_analytics_on_delete', () => revertCompletedOrderAnalytics(order))
    }

    await Order.deleteOne({ _id: req.params.orderId, restaurantId: restaurant._id })
    await runMetricsTask('rebuild_order_metrics_on_delete', () =>
      rebuildOrderMetricsForDate({
        restaurantId: restaurant._id,
        date: order.createdAt || new Date(),
      }),
    )

    invalidateCacheByTags(
      buildOrderCacheTags({
        restaurant,
        tableNumber: order.tableNumber,
        orderId: req.params.orderId,
        includeAnalytics: true,
      }),
    )
    publishOrderChange({
      restaurantId: restaurant._id,
      type: 'deleted',
      orderId: req.params.orderId,
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

    await runMetricsTask('rebuild_order_metrics_on_create', () =>
      rebuildOrderMetricsForDate({
        restaurantId: draft.restaurant._id,
        date: order.createdAt || new Date(),
      }),
    )

    invalidateCacheByTags(
      buildOrderCacheTags({
        restaurant: draft.restaurant,
        tableNumber: draft.tableNumber,
        orderId: order._id,
        includeAnalytics: true,
      }),
    )
    publishOrderChange({
      restaurantId: draft.restaurant._id,
      type: 'created',
      orderId: order._id,
      extra: { orderStatus: order.orderStatus },
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
      return respondRestaurantNotFound(res)
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

    invalidateCacheByTags(
      buildOrderCacheTags({
        restaurant,
        tableNumber: order.tableNumber,
        orderId: order._id,
      }),
    )
    publishOrderChange({
      restaurantId: restaurant._id,
      type: 'kot-printed',
      orderId: order._id,
      extra: { kotPrinted: true, kotPrintedAt: order.kotPrintedAt },
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
      return respondRestaurantNotFound(res)
    }

    const existingOrder = await Order.findOne({ _id: req.params.orderId, restaurantId: restaurant._id })
      .select('_id floorNumber tableNumber totalAmount billPrinted billAdjustments billAdjustmentSubtotal billFinalTotalAmount')
      .lean()

    if (!existingOrder) {
      return res.status(404).json({ message: 'Order not found' })
    }

    const rawBillAdjustments = Array.isArray(req.body?.billAdjustments) ? req.body.billAdjustments : null
    if (existingOrder.billPrinted && rawBillAdjustments !== null) {
      return res.status(400).json({ message: 'Bill adjustments can only be added before the first bill print.' })
    }

    let billAdjustments = null
    let billAdjustmentSubtotal = null
    if (rawBillAdjustments !== null) {
      const built = await buildValidatedBillAdjustments({
        restaurantId: restaurant._id,
        adjustments: rawBillAdjustments,
      })
      billAdjustments = built.billAdjustments
      billAdjustmentSubtotal = built.adjustmentSubtotal
    }

    const update = {
      billPrinted: true,
      billPrintedAt: new Date(),
    }

    if (billAdjustments !== null && billAdjustmentSubtotal !== null) {
      update.billAdjustments = billAdjustments
      update.billAdjustmentSubtotal = billAdjustmentSubtotal
      update.billFinalTotalAmount = round2(Number(existingOrder.totalAmount || 0) + Number(billAdjustmentSubtotal || 0))
    }

    const order = await Order.findOneAndUpdate(
      { _id: req.params.orderId, restaurantId: restaurant._id },
      { $set: update },
      { new: true, runValidators: true },
    )

    invalidateCacheByTags(
      buildOrderCacheTags({
        restaurant,
        tableNumber: order.tableNumber,
        orderId: order._id,
      }),
    )
    publishOrderChange({
      restaurantId: restaurant._id,
      type: 'bill-printed',
      orderId: order._id,
      extra: { billPrinted: true, billPrintedAt: order.billPrintedAt },
    })

    return res.json(order)
  } catch (error) {
    next(error)
  }
}
