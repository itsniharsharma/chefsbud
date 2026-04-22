import mongoose from 'mongoose'
import Order from '../models/Order.js'
import OrderDailyCounter from '../models/OrderDailyCounter.js'
import Restaurant from '../models/Restaurant.js'
import Table from '../models/Table.js'
import bcrypt from 'bcrypt'
import { buildCustomerOrderDraft } from '../services/customerOrderService.js'
import { buildValidatedBillAdjustments } from '../services/orderBillComposerService.js'
import { sendKotReprintAuditEmail } from '../services/emailService.js'
import {
  isOrderInventoryAsyncEnabled,
} from '../services/orderInventoryQueueService.js'
import { enqueueOrderJob } from '../services/orderQueueService.js'
import { createOrderCreatedOutboxEvent } from '../services/orderOutboxService.js'
import { createOrderStatusChangedOutboxEvent } from '../services/orderOutboxService.js'
import { getOrderInventoryBehavior } from '../config/inventoryRuntime.js'
import {
  applyOrderRatingAnalytics,
} from '../services/itemAnalyticsService.js'
import { invalidateCacheByTags } from '../services/responseCache.js'
import { invalidateOrderQueries } from '../services/queryResultCache.js'
import { getCachedQueryResult, setCachedQueryResult } from '../services/queryResultCache.js'
import { emitOrderChanged } from '../realtime/orderEvents.js'
import { recordEndpointMetric } from '../middleware/performanceTracing.js'
import { logger } from '../utils/logger.js'
import { resolveRequestRestaurant } from '../utils/requestRestaurant.js'

const PUBLIC_TABLE_ORDER_LIMIT = Math.min(50, Math.max(5, Number(process.env.PUBLIC_TABLE_ORDER_LIMIT || 25)))
const CUSTOMER_FEEDBACK_WINDOW_MINUTES = Math.max(5, Math.min(Number(process.env.CUSTOMER_FEEDBACK_WINDOW_MINUTES || 60), 24 * 60))
const ORDER_STATUS_ALLOWED = ['Preparing', 'Served', 'Completed']
const METRICS_ASYNC_ENABLED = String(process.env.METRICS_ASYNC_ENABLED || 'true') === 'true'
const USE_LEGACY_WORKERS = String(process.env.USE_LEGACY_WORKERS || 'false') === 'true'
const ORDER_SEQUENCE_TIMEZONE = String(process.env.ORDER_SEQUENCE_TIMEZONE || 'Asia/Kolkata').trim() || 'Asia/Kolkata'
const ORDER_DATE_KEY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: ORDER_SEQUENCE_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const ORDER_READ_TRACE_TIMING = String(process.env.ORDER_READ_TRACE_TIMING || 'false') === 'true'
const ORDER_READ_SLOW_MS = Math.max(250, Number(process.env.ORDER_READ_SLOW_MS || 300))

const orderListProjection =
  '_id floorNumber tableNumber items subtotalAmount discountTotal billAdjustments billAdjustmentSubtotal billFinalTotalAmount appliedOffers customerNote totalAmount paymentStatus billPrinted billPrintedAt kotPrinted kotPrintedAt orderStatus inventoryConsumptionCycle inventoryProcessedAt createdAt completedAt hiddenFromActive deletedByOwnerAt paymentProvider providerOrderId providerPaymentId paymentCapturedAt paymentFailureReason orderDateKey dailyOrderNumber'

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function elapsedMs(startNs) {
  return Number(process.hrtime.bigint() - startNs) / 1_000_000
}

function shouldLogReadTiming(totalMs) {
  return ORDER_READ_TRACE_TIMING || totalMs >= ORDER_READ_SLOW_MS
}

function logOrdersReadTiming({ req, restaurantId, view, scope, floorNumber, cacheHit, timings }) {
  const totalMs = Number(timings?.totalMs || 0)
  recordEndpointMetric(req, 'orders_read_ms', totalMs, {
    view,
    scope,
    floor: floorNumber || 'all',
    cacheHit: cacheHit ? 'yes' : 'no',
  })

  if (!shouldLogReadTiming(totalMs)) {
    return
  }

  logger.info('orders_read_timing', {
    restaurantId,
    view,
    scope,
    floorNumber: floorNumber || 'all',
    cacheHit: cacheHit ? 'yes' : 'no',
    resolveRestaurantMs: Math.round(Number(timings?.resolveRestaurantMs || 0)),
    cacheLookupMs: Math.round(Number(timings?.cacheLookupMs || 0)),
    queryMs: Math.round(Number(timings?.queryMs || 0)),
    enrichMs: Math.round(Number(timings?.enrichMs || 0)),
    totalMs: Math.round(totalMs),
  })
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

function buildOptimisticOrderStatusPayload(order, update, orderStatus) {
  const baseOrder = order?.toObject ? order.toObject() : order
  const completedAt = update.completedAt ?? order.completedAt ?? null
  const deletedByOwnerAt = update.deletedByOwnerAt ?? order.deletedByOwnerAt ?? null

  return {
    ...(baseOrder && typeof baseOrder === 'object' ? baseOrder : {}),
    orderStatus,
    completedAt,
    hiddenFromActive: Boolean(update.hiddenFromActive),
    hiddenFromRecent: typeof update.hiddenFromRecent === 'boolean' ? update.hiddenFromRecent : Boolean(baseOrder?.hiddenFromRecent),
    deletedByOwnerAt,
    updatedAt: update.updatedAt || new Date(),
  }
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

function buildOrderDateKey(date = new Date()) {
  return ORDER_DATE_KEY_FORMATTER.format(date)
}

async function allocateDailyOrderNumber({ restaurantId, orderDateKey, session = null }) {
  const counter = await OrderDailyCounter.findOneAndUpdate(
    { restaurantId, orderDateKey },
    {
      $setOnInsert: { restaurantId, orderDateKey },
      $inc: { seq: 1 },
    },
    {
      upsert: true,
      returnDocument: 'after',
      session,
      setDefaultsOnInsert: true,
    },
  )

  return Math.max(1, Number(counter?.seq || 1))
}

function hrNowNs() {
  return process.hrtime.bigint()
}

function nsToMs(startNs, endNs = hrNowNs()) {
  if (typeof startNs !== 'bigint' || typeof endNs !== 'bigint') return 0
  return Number(endNs - startNs) / 1_000_000
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
    query.hiddenFromRecent = { $ne: true }
  } else {
    query.hiddenFromActive = false
    if (status && status !== 'All') {
      query.orderStatus = status
    }
  }

  if (scope === 'today') {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    if (view === 'completed') {
      query.completedAt = { $gte: start }
    } else {
      query.createdAt = { $gte: start }
    }
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

function getFeedbackWindowStartDate() {
  return new Date(Date.now() - CUSTOMER_FEEDBACK_WINDOW_MINUTES * 60 * 1000)
}

function isOrderInFeedbackWindow(order) {
  if (!order || String(order.orderStatus || '') !== 'Completed') {
    return false
  }

  const completedAt = order.completedAt ? new Date(order.completedAt) : null
  const ts = completedAt?.getTime()
  if (!Number.isFinite(ts)) {
    return false
  }

  return ts >= getFeedbackWindowStartDate().getTime()
}

function hasCustomerRating(order) {
  const rating = Number(order?.customerRating)
  return Number.isInteger(rating) && rating >= 1 && rating <= 5
}

function toPublicOrderPayload(order) {
  const customerCanRate = isOrderInFeedbackWindow(order) && !hasCustomerRating(order)

  return {
    ...order,
    customerCanRate,
  }
}

async function listOrdersByQuery(query, pagination) {
  const isCompletedView = String(query?.orderStatus || '') === 'Completed'
  const sort = isCompletedView
    ? { completedAt: -1, createdAt: -1 }
    : { createdAt: -1 }

  return Order.find(query)
    .sort(sort)
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
    const requestStartedAt = process.hrtime.bigint()
    const resolveStartedAt = process.hrtime.bigint()
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return respondRestaurantNotFound(res)
    }
    const resolveRestaurantMs = elapsedMs(resolveStartedAt)

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

    const bypassReadCache = String(req.query.refresh || req.headers['x-bypass-response-cache'] || '') === '1'
    const shouldUseQueryCache = view === 'completed' && !bypassReadCache
    let cacheLookupMs = 0

    if (shouldUseQueryCache) {
      const cacheLookupStartedAt = process.hrtime.bigint()
      const cachedResult = await getCachedQueryResult('completed_today', {
        restaurantId: req.params.restaurantId,
        page: pagination.page,
        limit: pagination.limit,
        filters: {
          scope,
          floor: floorNumber || 'all',
          status: 'Completed',
        },
      })
      cacheLookupMs = elapsedMs(cacheLookupStartedAt)

      if (cachedResult?.data) {
        logOrdersReadTiming({
          req,
          restaurantId: req.params.restaurantId,
          view,
          scope,
          floorNumber,
          cacheHit: true,
          timings: {
            totalMs: elapsedMs(requestStartedAt),
            resolveRestaurantMs,
            cacheLookupMs,
          },
        })
        res.set('X-Cache-Hit', cachedResult.source)
        return res.json(cachedResult.data)
      }
    }

    const queryStartedAt = process.hrtime.bigint()
    const rawOrders = await listOrdersByQuery(query, pagination)
    const queryMs = elapsedMs(queryStartedAt)
    const enrichStartedAt = process.hrtime.bigint()
    const orders = await enrichOrdersWithFloorNumbers(restaurant._id, rawOrders)
    const enrichMs = elapsedMs(enrichStartedAt)

    logOrdersReadTiming({
      req,
      restaurantId: req.params.restaurantId,
      view,
      scope,
      floorNumber,
      cacheHit: false,
      timings: {
        totalMs: elapsedMs(requestStartedAt),
        resolveRestaurantMs,
        cacheLookupMs,
        queryMs,
        enrichMs,
      },
    })

    if (shouldUseQueryCache) {
      void setCachedQueryResult('completed_today', {
        restaurantId: req.params.restaurantId,
        page: pagination.page,
        limit: pagination.limit,
        filters: {
          scope,
          floor: floorNumber || 'all',
          status: 'Completed',
        },
      }, orders)
    }

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
      isArchived: false,
    })
      .select('_id restaurantId items subtotalAmount totalAmount orderStatus inventoryConsumptionCycle inventoryProcessedAt completedAt createdAt updatedAt analyticsTrackedAt')
      .lean()

    if (!existingOrder) {
      return res.status(404).json({ message: 'Order not found' })
    }

    if (String(existingOrder.orderStatus || '') === String(orderStatus || '')) {
      const noOpPayload = buildOptimisticOrderStatusPayload(existingOrder, {
        completedAt: existingOrder.completedAt,
        hiddenFromActive: Boolean(existingOrder.orderStatus === 'Completed'),
        hiddenFromRecent: false,
        deletedByOwnerAt: existingOrder.deletedByOwnerAt,
      }, orderStatus)
      return res.json(noOpPayload)
    }

    const wasCompleted = existingOrder.orderStatus === 'Completed'
    const isCompleted = orderStatus === 'Completed'

    const update = {
      orderStatus,
      completedAt: isCompleted ? new Date() : null,
      hiddenFromActive: isCompleted,
      deletedByOwnerAt: isCompleted ? new Date() : null,
      ...(isCompleted ? { hiddenFromRecent: false } : {}),
    }

    const session = await mongoose.startSession()
    let previousOrder = null
    let eventQueued = false

    try {
      await session.withTransaction(async () => {
        previousOrder = await Order.findOneAndUpdate(
          { _id: req.params.orderId, restaurantId: restaurant._id, isArchived: false },
          { $set: update },
          {
            returnDocument: 'before',
            runValidators: true,
            session,
            projection: '_id restaurantId tableNumber floorNumber orderStatus items subtotalAmount discountTotal totalAmount inventoryConsumptionCycle inventoryProcessedAt completedAt analyticsTrackedAt hiddenFromActive hiddenFromRecent deletedByOwnerAt createdAt updatedAt',
          },
        ).lean()

        if (!previousOrder) {
          throw new Error('Order not found')
        }

        const shouldQueueStatusWork = previousOrder.orderStatus !== orderStatus
        if (shouldQueueStatusWork && USE_LEGACY_WORKERS) {
          await createOrderStatusChangedOutboxEvent({
            orderId: previousOrder._id,
            restaurantId: restaurant._id,
            fromStatus: previousOrder.orderStatus,
            toStatus: orderStatus,
            transitionToken: previousOrder.updatedAt?.getTime?.() || previousOrder.updatedAt || '',
            inventoryCycle: Number(previousOrder.inventoryConsumptionCycle || 0),
            completedAt: update.completedAt,
            session,
          })
        }
        eventQueued = shouldQueueStatusWork
      })
    } finally {
      session.endSession()
    }

    const responseOrder = buildOptimisticOrderStatusPayload(previousOrder, update, orderStatus)

    if (eventQueued) {
      try {
        if (!USE_LEGACY_WORKERS) {
          const queued = await enqueueOrderJob({
            jobType: 'order_status_changed',
            jobData: {
              orderId: previousOrder._id,
              restaurantId: restaurant._id,
              fromStatus: previousOrder.orderStatus,
              toStatus: orderStatus,
              inventoryCycle: Number(previousOrder.inventoryConsumptionCycle || 0),
              completedAt: update.completedAt,
            },
          })

          if (!queued) {
            logger.error('order_status_redis_queue_enqueue_failed', {
              orderId: String(previousOrder?._id || ''),
              restaurantId: String(restaurant?._id || ''),
            })

            // Fallback persistence for recovery (processed only if legacy workers are re-enabled).
            await createOrderStatusChangedOutboxEvent({
              orderId: previousOrder._id,
              restaurantId: restaurant._id,
              fromStatus: previousOrder.orderStatus,
              toStatus: orderStatus,
              transitionToken: previousOrder.updatedAt?.getTime?.() || previousOrder.updatedAt || '',
              inventoryCycle: Number(previousOrder.inventoryConsumptionCycle || 0),
              completedAt: update.completedAt,
            })
          }
        }

        // Keep board/status views coherent immediately after status changes.
        invalidateCacheByTags(
          buildOrderCacheTags({
            restaurant,
            tableNumber: responseOrder.tableNumber,
            orderId: responseOrder._id,
            includeAnalytics: wasCompleted !== isCompleted,
          }),
          { skipRedis: true },
        )

        runNonCriticalTask('order_status_cache_and_realtime', async () => {
          await invalidateOrderQueries(restaurant._id)
          publishOrderChange({
            restaurantId: restaurant._id,
            type: 'status-updated',
            orderId: responseOrder._id,
            extra: { orderStatus: responseOrder.orderStatus },
          })
        })
      } catch (sideEffectError) {
        logger.warn('order_status_post_update_side_effects_failed', {
          orderId: String(responseOrder?._id || ''),
          restaurantId: String(restaurant?._id || ''),
          message: sideEffectError?.message || 'order_status_side_effects_failed',
        })
      }
    }

    res.set('X-Background-Jobs-Queued', eventQueued ? '1' : '0')
    return res.json(responseOrder)
  } catch (error) {
    next(error)
  }
}

export async function shiftTableOrders(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return respondRestaurantNotFound(res)
    }

    const sourceFloorNumber = Number(req.body?.sourceFloorNumber)
    const sourceTableNumber = Number(req.body?.sourceTableNumber)
    const targetFloorNumber = Number(req.body?.targetFloorNumber)
    const targetTableNumber = Number(req.body?.targetTableNumber)

    const hasInvalidNumber =
      !Number.isInteger(sourceFloorNumber) ||
      !Number.isInteger(sourceTableNumber) ||
      !Number.isInteger(targetFloorNumber) ||
      !Number.isInteger(targetTableNumber) ||
      sourceFloorNumber < 1 ||
      sourceTableNumber < 1 ||
      targetFloorNumber < 1 ||
      targetTableNumber < 1

    if (hasInvalidNumber) {
      return res.status(400).json({ message: 'Source and target floor/table numbers must be valid positive integers' })
    }

    if (sourceFloorNumber === targetFloorNumber && sourceTableNumber === targetTableNumber) {
      return res.status(400).json({ message: 'Source and target table cannot be the same' })
    }

    const activeSessionFilter = {
      restaurantId: restaurant._id,
      isArchived: false,
      hiddenFromActive: false,
      orderStatus: { $ne: 'Completed' },
    }

    const session = await mongoose.startSession()
    let movedCount = 0

    try {
      await session.withTransaction(async () => {
        const [sourceTable, targetTable] = await Promise.all([
          Table.findOne({
            restaurantId: restaurant._id,
            floorNumber: sourceFloorNumber,
            tableNumber: sourceTableNumber,
            active: true,
          })
            .select('_id tableNumber floorNumber active')
            .session(session)
            .lean(),
          Table.findOne({
            restaurantId: restaurant._id,
            floorNumber: targetFloorNumber,
            tableNumber: targetTableNumber,
            active: true,
          })
            .select('_id tableNumber floorNumber active')
            .session(session)
            .lean(),
        ])

        if (!sourceTable) {
          const error = new Error('Source table does not exist or is inactive')
          error.statusCode = 404
          throw error
        }

        if (!targetTable) {
          const error = new Error('Target table does not exist or is inactive')
          error.statusCode = 404
          throw error
        }

        const targetActiveCount = await Order.countDocuments({
          ...activeSessionFilter,
          floorNumber: targetFloorNumber,
          tableNumber: targetTableNumber,
        }).session(session)

        if (targetActiveCount > 0) {
          const error = new Error('Target table is already occupied with an active session')
          error.statusCode = 409
          throw error
        }

        const sourceActiveCount = await Order.countDocuments({
          ...activeSessionFilter,
          floorNumber: sourceFloorNumber,
          tableNumber: sourceTableNumber,
        }).session(session)

        if (!sourceActiveCount) {
          const error = new Error('No active orders found on source table')
          error.statusCode = 404
          throw error
        }

        const updateResult = await Order.updateMany(
          {
            restaurantId: restaurant._id,
            isArchived: false,
            hiddenFromActive: false,
            orderStatus: { $ne: 'Completed' },
            floorNumber: sourceFloorNumber,
            tableNumber: sourceTableNumber,
          },
          {
            $set: {
              floorNumber: targetFloorNumber,
              tableNumber: targetTableNumber,
            },
          },
          { session },
        )

        movedCount = Number(updateResult?.modifiedCount || 0)
      })
    } finally {
      session.endSession()
    }

    invalidateCacheByTags([
      `orders:board:${String(restaurant._id)}`,
      `orders:table:${restaurant.slug}:${sourceTableNumber}`,
      `orders:table:${restaurant.slug}:${targetTableNumber}`,
    ], { skipRedis: true })

    publishOrderChange({
      restaurantId: restaurant._id,
      type: 'table-shifted',
      orderId: 'bulk',
      extra: {
        sourceFloorNumber,
        sourceTableNumber,
        targetFloorNumber,
        targetTableNumber,
        movedOrders: movedCount,
      },
    })

    return res.json({
      success: true,
      movedOrders: movedCount,
      sourceFloorNumber,
      sourceTableNumber,
      targetFloorNumber,
      targetTableNumber,
    })
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message })
    }
    next(error)
  }
}

export async function deleteOrder(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return respondRestaurantNotFound(res)
    }

    const order = await Order.findOne({ _id: req.params.orderId, restaurantId: restaurant._id, isArchived: false }).lean()

    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }

    if (!['Served', 'Completed'].includes(order.orderStatus)) {
      return res.status(400).json({ message: 'Order can be deleted only after Served or Completed' })
    }

    await Order.updateOne(
      { _id: req.params.orderId, restaurantId: restaurant._id, isArchived: false },
      {
        $set: {
          hiddenFromActive: true,
          hiddenFromRecent: true,
          deletedByOwnerAt: new Date(),
        },
      },
    )

    invalidateCacheByTags(
      buildOrderCacheTags({
        restaurant,
        tableNumber: order.tableNumber,
        orderId: req.params.orderId,
        includeAnalytics: Boolean(order.analyticsTrackedAt),
      }),
      { skipRedis: true },
    )
    runNonCriticalTask('order_delete_cache_and_realtime', async () => {
      await invalidateOrderQueries(restaurant._id)
      publishOrderChange({
        restaurantId: restaurant._id,
        type: 'deleted',
        orderId: req.params.orderId,
      })
    })
    return res.json({ success: true, deleted: true })
  } catch (error) {
    next(error)
  }
}

export async function createOrder(req, res, next) {
  try {
    const traceEnabled = String(process.env.ORDER_CREATE_TRACE_TIMING || 'false') === 'true'
    const debugEnabled = String(process.env.DEBUG || 'false').trim().toLowerCase() === 'true'
    if (traceEnabled) console.time('order_total')

    const controllerStartedAtNs = hrNowNs()
    const routeStartedAtNs = typeof req?._orderCreateStartedAtNs === 'bigint' ? req._orderCreateStartedAtNs : null
    const validatedAtNs = typeof req?._orderCreateValidatedAtNs === 'bigint' ? req._orderCreateValidatedAtNs : null
    const middlewareAndValidationMs = routeStartedAtNs ? nsToMs(routeStartedAtNs, controllerStartedAtNs) : 0
    const validationMs = routeStartedAtNs && validatedAtNs ? nsToMs(routeStartedAtNs, validatedAtNs) : 0

    const totalStartedAt = Date.now()
    const { restaurantSlug, tableNumber, floorNumber, items, customerNote = '' } = req.body
    const headerIdempotencyKey = typeof req.headers['x-idempotency-key'] === 'string'
      ? req.headers['x-idempotency-key'].trim()
      : ''
    const payloadIdempotencyKey = typeof req.body?.idempotencyKey === 'string'
      ? req.body.idempotencyKey.trim()
      : ''
    const normalizedIdempotencyKey = payloadIdempotencyKey || headerIdempotencyKey

    if (!normalizedIdempotencyKey || normalizedIdempotencyKey.length > 120) {
      return res.status(400).json({ message: 'idempotencyKey is required and must be at most 120 characters' })
    }

    if (traceEnabled) console.time('draft')
    const draftStartedAt = Date.now()
    const draft = await buildCustomerOrderDraft({
      restaurantSlug,
      tableNumber,
      floorNumber,
      items,
    })
    const draftDurationMs = Date.now() - draftStartedAt
    if (traceEnabled) console.timeEnd('draft')

    const inventoryBehavior = getOrderInventoryBehavior()
    const asyncInventoryEnabled = isOrderInventoryAsyncEnabled()
    const orderCreationInventoryBehavior =
      inventoryBehavior.reserveOnCreate && asyncInventoryEnabled
        ? inventoryBehavior
        : {
            ...inventoryBehavior,
            reserveOnCreate: false,
          }

    const orderDateKey = buildOrderDateKey()

    if (inventoryBehavior.reserveOnCreate && !asyncInventoryEnabled) {
      logger.error('order_inventory_async_mode_required', {
        restaurantSlug: String(restaurantSlug || ''),
        tableNumber: Number(tableNumber || 0),
        rolloutMode: inventoryBehavior.mode,
        note: 'Sync inventory reservation is disabled for createOrder.',
      })
    }

    if (traceEnabled) console.time('db')
    const createStartedAt = Date.now()
    let order
    let transactionDurationMs = 0
    let idempotencyReplayLookupMs = 0
    try {
      if (orderCreationInventoryBehavior.reserveOnCreate) {
        const orderCreateSession = await mongoose.startSession()
        try {
          if (traceEnabled) console.time('transaction')
          const transactionStartedAt = Date.now()
          await orderCreateSession.withTransaction(async () => {
            const dailyOrderNumber = await allocateDailyOrderNumber({
              restaurantId: draft.restaurant._id,
              orderDateKey,
              session: orderCreateSession,
            })

            const createdOrders = await Order.create(
              [
                {
                  restaurantId: draft.restaurant._id,
                  restaurantSlug: draft.restaurantSlug,
                  orderDateKey,
                  dailyOrderNumber,
                  floorNumber: draft.floorNumber,
                  tableNumber: draft.tableNumber,
                  items: draft.orderItems,
                  subtotalAmount: draft.pricing.subtotalAmount,
                  discountTotal: draft.pricing.discountTotal,
                  appliedOffers: draft.pricing.appliedOffers,
                  idempotencyKey: normalizedIdempotencyKey,
                  customerNote: String(customerNote || '').trim(),
                  totalAmount: draft.pricing.totalAmount,
                  paymentStatus: 'Unpaid',
                  orderStatus: 'Preparing',
                  hiddenFromActive: false,
                  hiddenFromRecent: false,
                },
              ],
              { session: orderCreateSession },
            )

            order = createdOrders[0]

            if (USE_LEGACY_WORKERS) {
              await createOrderCreatedOutboxEvent({
                orderId: order._id,
                restaurantId: draft.restaurant._id,
                policy: orderCreationInventoryBehavior.consumptionPolicy,
                idempotencyPrefix: 'order',
                session: orderCreateSession,
              })
            }
          })
          transactionDurationMs = Date.now() - transactionStartedAt
          if (traceEnabled) console.timeEnd('transaction')
        } finally {
          orderCreateSession.endSession()
        }
      } else {
        const dailyOrderNumber = await allocateDailyOrderNumber({
          restaurantId: draft.restaurant._id,
          orderDateKey,
        })

        order = await Order.create({
          restaurantId: draft.restaurant._id,
          restaurantSlug: draft.restaurantSlug,
          orderDateKey,
          dailyOrderNumber,
          floorNumber: draft.floorNumber,
          tableNumber: draft.tableNumber,
          items: draft.orderItems,
          subtotalAmount: draft.pricing.subtotalAmount,
          discountTotal: draft.pricing.discountTotal,
          appliedOffers: draft.pricing.appliedOffers,
          idempotencyKey: normalizedIdempotencyKey,
          customerNote: String(customerNote || '').trim(),
          totalAmount: draft.pricing.totalAmount,
          paymentStatus: 'Unpaid',
          orderStatus: 'Preparing',
          hiddenFromActive: false,
          hiddenFromRecent: false,
        })
      }
    } catch (createError) {
      if (createError?.code === 11000 && normalizedIdempotencyKey) {
        const replayStartedAt = Date.now()
        const duplicate = await Order.findOne({
          restaurantId: draft.restaurant._id,
          idempotencyKey: normalizedIdempotencyKey,
          isArchived: false,
        }).lean()
        idempotencyReplayLookupMs = Date.now() - replayStartedAt
        if (duplicate) {
          logger.info('order_create_idempotent_duplicate_resolved', {
            orderId: String(duplicate._id || ''),
            restaurantId: String(draft.restaurant._id || ''),
            totalMs: Date.now() - totalStartedAt,
            draftMs: draftDurationMs,
            middlewareAndValidationMs,
            validationMs,
            idempotencyReplayLookupMs,
          })
          if (traceEnabled) {
            console.timeEnd('db')
            console.timeEnd('order_total')
          }
          return res.status(200).json(duplicate)
        }
      }
      throw createError
    }
    const createDurationMs = Date.now() - createStartedAt
    if (traceEnabled) console.timeEnd('db')

    if (traceEnabled) console.time('inventory')
    const inventoryStartedAt = Date.now()
    let inventoryMode = 'skipped'
    if (orderCreationInventoryBehavior.reserveOnCreate) {
      inventoryMode = asyncInventoryEnabled ? (USE_LEGACY_WORKERS ? 'async-outbox' : 'async-redis') : 'async-forced'
      if (!USE_LEGACY_WORKERS && asyncInventoryEnabled && order?._id) {
        const queuedReservation = await enqueueOrderJob({
          jobType: 'reserve_order_inventory',
          jobData: {
            orderId: order._id,
            restaurantId: draft.restaurant._id,
            policy: orderCreationInventoryBehavior.consumptionPolicy,
            idempotencyPrefix: 'order',
          },
        })

        if (!queuedReservation) {
          logger.error('order_create_redis_reservation_enqueue_failed', {
            orderId: String(order?._id || ''),
            restaurantId: String(draft?.restaurant?._id || ''),
          })

          // Fallback persistence for recovery (processed only if legacy workers are re-enabled).
          await createOrderCreatedOutboxEvent({
            orderId: order._id,
            restaurantId: draft.restaurant._id,
            policy: orderCreationInventoryBehavior.consumptionPolicy,
            idempotencyPrefix: 'order',
          })
        }
      }
    }
    const inventoryDurationMs = Date.now() - inventoryStartedAt
    if (traceEnabled) console.timeEnd('inventory')

    const responsePayload = order?.toObject ? order.toObject() : order

    invalidateCacheByTags(
      buildOrderCacheTags({
        restaurant: draft.restaurant,
        tableNumber: draft.tableNumber,
        orderId: responsePayload._id,
        includeAnalytics: true,
      }),
      { skipRedis: true },
    )
    runNonCriticalTask('order_create_cache_and_realtime', async () => {
      await invalidateOrderQueries(draft.restaurant._id)
      publishOrderChange({
        restaurantId: draft.restaurant._id,
        type: 'created',
        orderId: responsePayload._id,
        extra: { orderStatus: responsePayload.orderStatus },
      })
    })

    const responseStartedAt = Date.now()
    if (traceEnabled) console.time('response')
    res.status(201).json(responsePayload)
    const responseHandoffMs = Date.now() - responseStartedAt
    if (traceEnabled) {
      console.timeEnd('response')
      console.timeEnd('order_total')
    }

    runNonCriticalTask('order_create_post_response_side_effects', async () => {
      if (debugEnabled) {
        logger.info('order_create_debug', {
          orderId: String(responsePayload?._id || ''),
          inventoryMode,
          draftCacheHit: Boolean(draft?.cacheHit),
        })
      }
    })

    logger.info('order_create_timing', {
      orderId: String(responsePayload?._id || ''),
      restaurantId: String(draft?.restaurant?._id || ''),
      middlewareAndValidationMs,
      validationMs,
      draftMs: draftDurationMs,
      createMs: createDurationMs,
      transactionMs: transactionDurationMs,
      inventoryMs: inventoryDurationMs,
      inventoryMode,
      idempotencyReplayLookupMs,
      responseHandoffMs,
      totalMs: Date.now() - totalStartedAt,
      sideEffectsDeferred: true,
      draftCacheHit: Boolean(draft?.cacheHit),
    })

    return null
  } catch (error) {
    if (String(process.env.ORDER_CREATE_TRACE_TIMING || 'false') === 'true') {
      try {
        console.timeEnd('order_total')
      } catch {
        // no-op
      }
    }
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
        '_id floorNumber tableNumber items subtotalAmount discountTotal appliedOffers customerNote totalAmount paymentStatus kotPrinted kotPrintedAt orderStatus createdAt completedAt customerRating customerRatedAt orderDateKey dailyOrderNumber',
      )
      .lean()

    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }

    if (String(order.orderStatus || '') === 'Completed' && !isOrderInFeedbackWindow(order)) {
      return res.status(404).json({ message: 'Order not found' })
    }

    return res.json(toPublicOrderPayload(order))
  } catch (error) {
    next(error)
  }
}

export async function getPublicTableOrders(req, res, next) {
  try {
    const { restaurantSlug, tableNumber } = req.params
    const feedbackWindowStart = getFeedbackWindowStartDate()

    const orders = await Order.find({
      restaurantSlug,
      tableNumber: Number(tableNumber),
      isArchived: false,
      paymentStatus: { $in: ['Paid', 'Unpaid'] },
      $or: [
        { orderStatus: { $ne: 'Completed' } },
        { orderStatus: 'Completed', completedAt: { $gte: feedbackWindowStart } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(PUBLIC_TABLE_ORDER_LIMIT)
      .select(
        '_id floorNumber tableNumber items subtotalAmount discountTotal appliedOffers customerNote totalAmount paymentStatus kotPrinted kotPrintedAt orderStatus createdAt completedAt customerRating customerRatedAt orderDateKey dailyOrderNumber',
      )
      .lean()

    return res.json(orders.map(toPublicOrderPayload))
  } catch (error) {
    next(error)
  }
}

export async function ratePublicOrder(req, res, next) {
  try {
    const { restaurantSlug, tableNumber, orderId } = req.params
    const rating = Number(req.body?.rating)

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be an integer between 1 and 5' })
    }

    const order = await Order.findOne({
      _id: orderId,
      restaurantSlug,
      tableNumber: Number(tableNumber),
      isArchived: false,
    })
      .select('_id restaurantId restaurantSlug tableNumber orderStatus completedAt customerRating customerRatedAt')
      .lean()

    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }

    if (String(order.orderStatus || '') !== 'Completed') {
      return res.status(409).json({ message: 'Rating is only allowed for completed orders' })
    }

    if (!isOrderInFeedbackWindow(order)) {
      return res.status(410).json({ message: 'Rating window has expired for this order' })
    }

    if (hasCustomerRating(order)) {
      return res.status(409).json({ message: 'Rating already submitted for this order' })
    }

    const ratedAt = new Date()

    const updated = await Order.findOneAndUpdate(
      {
        _id: orderId,
        restaurantSlug,
        tableNumber: Number(tableNumber),
        isArchived: false,
        orderStatus: 'Completed',
        customerRating: null,
      },
      {
        $set: {
          customerRating: rating,
          customerRatedAt: ratedAt,
        },
      },
      {
        returnDocument: 'after',
        projection: '_id customerRating customerRatedAt orderStatus completedAt restaurantId restaurantSlug tableNumber',
      },
    ).lean()

    if (!updated) {
      return res.status(409).json({ message: 'Rating already submitted for this order' })
    }

    invalidateCacheByTags([
      `orders:table:${restaurantSlug}:${tableNumber}`,
      `orders:order:${orderId}`,
    ], { skipRedis: true })

    if (updated.restaurantId) {
      await runMetricsTask('apply_order_rating_analytics', () =>
        applyOrderRatingAnalytics({
          restaurantId: updated.restaurantId,
          completedAt: updated.completedAt,
          nextRating: updated.customerRating,
          previousRating: null,
        }),
      )

      publishOrderChange({
        restaurantId: updated.restaurantId,
        type: 'customer-rated',
        orderId,
        extra: { customerRating: rating },
      })
    }

    return res.json({
      success: true,
      orderId: String(updated._id),
      customerRating: updated.customerRating,
      customerRatedAt: updated.customerRatedAt,
    })
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

    const existingOrder = await Order.findOne({ _id: req.params.orderId, restaurantId: restaurant._id, isArchived: false })
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
      { _id: req.params.orderId, restaurantId: restaurant._id, isArchived: false },
      { $set: update },
      { returnDocument: 'after', runValidators: true },
    ).lean()

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
      { skipRedis: true },
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

export async function markOrderPrintBundle(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return respondRestaurantNotFound(res)
    }

    const existingOrder = await Order.findOne({ _id: req.params.orderId, restaurantId: restaurant._id, isArchived: false })
      .select('_id floorNumber tableNumber totalAmount billPrinted billPrintedAt billAdjustments billAdjustmentSubtotal billFinalTotalAmount kotPrinted kotPrintCount')
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

    const isKotReprint = Boolean(existingOrder.kotPrinted)
    const reprintPasskey = String(req.body?.reprintPasskey || '')
    const reprintReason = String(req.body?.reprintReason || '').trim()

    if (isKotReprint) {
      const secureRestaurant = await Restaurant.findById(restaurant._id)
        .select('kotReprintConfig.passkeyHash')
        .lean()
      const reprintConfigHash = String(secureRestaurant?.kotReprintConfig?.passkeyHash || '')

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
      billPrinted: true,
      billPrintedAt: existingOrder.billPrintedAt || printedAt,
      kotPrinted: true,
      kotPrintedAt: printedAt,
      kotPrintCount: Math.max(1, Number(existingOrder.kotPrintCount || 0) + 1),
    }

    if (billAdjustments !== null && billAdjustmentSubtotal !== null) {
      update.billAdjustments = billAdjustments
      update.billAdjustmentSubtotal = billAdjustmentSubtotal
      update.billFinalTotalAmount = round2(Number(existingOrder.totalAmount || 0) + Number(billAdjustmentSubtotal || 0))
    }

    if (isKotReprint) {
      update.lastKotReprintReason = reprintReason
      update.lastKotReprintBy = actorName
      update.lastKotReprintAt = printedAt
    }

    const order = await Order.findOneAndUpdate(
      { _id: req.params.orderId, restaurantId: restaurant._id, isArchived: false },
      { $set: update },
      { returnDocument: 'after', runValidators: true },
    ).lean()

    if (isKotReprint) {
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
      { skipRedis: true },
    )
    publishOrderChange({
      restaurantId: restaurant._id,
      type: 'bill-printed',
      orderId: order._id,
      extra: { billPrinted: true, billPrintedAt: order.billPrintedAt },
    })
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

    const existingOrder = await Order.findOne({ _id: req.params.orderId, restaurantId: restaurant._id, isArchived: false })
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
      { _id: req.params.orderId, restaurantId: restaurant._id, isArchived: false },
      { $set: update },
      { returnDocument: 'after', runValidators: true },
    ).lean()

    invalidateCacheByTags(
      buildOrderCacheTags({
        restaurant,
        tableNumber: order.tableNumber,
        orderId: order._id,
      }),
      { skipRedis: true },
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
