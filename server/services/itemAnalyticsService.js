import mongoose from 'mongoose'
import AnalyticsBasketPairDaily from '../models/AnalyticsBasketPairDaily.js'
import AnalyticsDailyMetrics from '../models/AnalyticsDailyMetrics.js'
import AnalyticsEventIngestion from '../models/AnalyticsEventIngestion.js'
import AnalyticsExposureSession from '../models/AnalyticsExposureSession.js'
import AnalyticsItemDailyMetrics from '../models/AnalyticsItemDailyMetrics.js'
import AnalyticsOrderInsightsDaily from '../models/AnalyticsOrderInsightsDaily.js'
import Category from '../models/Category.js'
import MenuItem from '../models/MenuItem.js'
import Order from '../models/Order.js'
import OrderHourlyMetrics from '../models/OrderHourlyMetrics.js'
import { withRedis } from '../config/redis.js'
import { invalidateCacheByTags } from './responseCache.js'
import { logger } from '../utils/logger.js'

const ANALYTICS_BACKFILL_LOCK_SECONDS = Math.max(30, Number(process.env.ANALYTICS_BACKFILL_LOCK_SECONDS || 120))
const ANALYTICS_BACKFILL_BATCH_SIZE = Math.max(50, Math.min(Number(process.env.ANALYTICS_BACKFILL_BATCH_SIZE || 250), 1000))
const ANALYTICS_BACKFILL_MAX_BATCHES_PER_RUN = Math.max(1, Math.min(Number(process.env.ANALYTICS_BACKFILL_MAX_BATCHES_PER_RUN || 8), 50))
const ANALYTICS_BACKFILL_CONCURRENCY = Math.max(1, Math.min(Number(process.env.ANALYTICS_BACKFILL_CONCURRENCY || 6), 20))
const ANALYTICS_TRACKING_STALE_SECONDS = Math.max(60, Number(process.env.ANALYTICS_TRACKING_STALE_SECONDS || 300))
const localBackfillLocks = new Map()

function normalizeDate(dateLike = new Date()) {
  const date = new Date(dateLike)
  date.setHours(0, 0, 0, 0)
  return date
}

function normalizeHour(dateLike = new Date()) {
  const date = new Date(dateLike)
  const hour = Number(date.getHours())
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 0
}

function toDateKey(dateLike = new Date()) {
  return normalizeDate(dateLike).toISOString().slice(0, 10)
}

function addDays(dateLike, days) {
  const date = new Date(dateLike)
  date.setDate(date.getDate() + days)
  return date
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function clampNonNegative(value) {
  return Math.max(0, Number(value || 0))
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim())
}

async function registerAnalyticsEventIdempotency({ restaurantId, eventType, eventId, occurredAt = new Date() }) {
  const normalizedEventId = String(eventId || '').trim()
  if (!normalizedEventId) {
    return { accepted: true, deduplicated: false }
  }

  const normalizedType = String(eventType || '').trim() || 'unknown'
  const expiresAt = addDays(normalizeDate(occurredAt), 14)

  let result = null
  try {
    result = await AnalyticsEventIngestion.updateOne(
      {
        restaurantId,
        eventType: normalizedType,
        eventId: normalizedEventId,
      },
      {
        $setOnInsert: {
          restaurantId,
          eventType: normalizedType,
          eventId: normalizedEventId,
          firstSeenAt: occurredAt,
          expiresAt,
        },
      },
      { upsert: true },
    )
  } catch (error) {
    // Concurrent duplicate submissions can race on the unique index.
    if (error?.code === 11000) {
      return { accepted: false, deduplicated: true }
    }
    throw error
  }

  const inserted = Number(result?.upsertedCount || 0) > 0
  return {
    accepted: inserted,
    deduplicated: !inserted,
  }
}

function buildPurchaseBreakdown(order) {
  const items = Array.isArray(order?.items) ? order.items : []
  const subtotalAmount = clampNonNegative(order?.subtotalAmount)
  const totalAmount = clampNonNegative(order?.totalAmount)

  if (!items.length) return []

  let remainingRevenue = totalAmount

  return items.map((item, index) => {
    const quantity = clampNonNegative(item?.quantity)
    const itemSubtotal = clampNonNegative(Number(item?.price || 0) * quantity)
    const proportionalRevenue =
      index === items.length - 1
        ? remainingRevenue
        : round2(subtotalAmount > 0 ? (itemSubtotal / subtotalAmount) * totalAmount : itemSubtotal)

    remainingRevenue = round2(Math.max(0, remainingRevenue - proportionalRevenue))

    return {
      menuItemId: String(item?.menuItemId || '').trim(),
      quantity,
      revenue: round2(proportionalRevenue),
    }
  })
}

async function loadMenuItemsMap(restaurantId, menuItemIds = []) {
  const uniqueIds = [...new Set(menuItemIds.filter((id) => isValidObjectId(id)))]
  if (!uniqueIds.length) return new Map()

  const items = await MenuItem.find({
    restaurantId,
    _id: { $in: uniqueIds },
  })
    .select('_id categoryId name')
    .lean()

  return new Map(items.map((item) => [String(item._id), item]))
}

function sanitizeMetricIncrement(value) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) && numeric !== 0 ? numeric : 0
}

async function upsertItemDailyMetric({
  restaurantId,
  menuItemId,
  menuItemName = '',
  categoryId = null,
  date,
  dateKey,
  increments,
}) {
  const safeIncrements = {}
  Object.entries(increments || {}).forEach(([key, value]) => {
    const numeric = sanitizeMetricIncrement(value)
    if (!numeric) return
    safeIncrements[key] = numeric
  })

  if (!Object.keys(safeIncrements).length) return

  await AnalyticsItemDailyMetrics.updateOne(
    { restaurantId, menuItemId, dateKey },
    {
      $setOnInsert: {
        restaurantId,
        menuItemId,
        categoryId,
        date,
        dateKey,
      },
      $set: {
        menuItemName: String(menuItemName || '').trim(),
      },
      $inc: safeIncrements,
    },
    { upsert: true },
  )

  if (Object.values(safeIncrements).some((value) => value < 0)) {
    await AnalyticsItemDailyMetrics.updateOne(
      { restaurantId, menuItemId, dateKey },
      [
        {
          $set: {
            views: { $max: [0, '$views'] },
            addToCart: { $max: [0, '$addToCart'] },
            orders: { $max: [0, '$orders'] },
            quantitySold: { $max: [0, '$quantitySold'] },
            revenue: { $max: [0, '$revenue'] },
          },
        },
      ],
    )
  }
}

async function upsertDailyMetric({ restaurantId, date, dateKey, increments }) {
  const safeIncrements = {}
  Object.entries(increments || {}).forEach(([key, value]) => {
    const numeric = sanitizeMetricIncrement(value)
    if (!numeric) return
    safeIncrements[key] = numeric
  })

  if (!Object.keys(safeIncrements).length) return

  await AnalyticsDailyMetrics.updateOne(
    { restaurantId, dateKey },
    {
      $setOnInsert: {
        restaurantId,
        date,
        dateKey,
      },
      $inc: safeIncrements,
    },
    { upsert: true },
  )

  if (Object.values(safeIncrements).some((value) => value < 0)) {
    await AnalyticsDailyMetrics.updateOne(
      { restaurantId, dateKey },
      [
        {
          $set: {
            views: { $max: [0, '$views'] },
            addToCart: { $max: [0, '$addToCart'] },
            completedOrders: { $max: [0, '$completedOrders'] },
            revenue: { $max: [0, '$revenue'] },
          },
        },
      ],
    )
  }
}

async function upsertHourlyMetric({ restaurantId, date, dateKey, hour, increment }) {
  const safeIncrement = sanitizeMetricIncrement(increment)
  if (!safeIncrement) return

  await OrderHourlyMetrics.updateOne(
    { restaurantId, dateKey, hour },
    {
      $setOnInsert: {
        restaurantId,
        date,
        dateKey,
        hour,
      },
      $inc: {
        orders: safeIncrement,
      },
    },
    { upsert: true },
  )

  if (safeIncrement < 0) {
    await OrderHourlyMetrics.updateOne(
      { restaurantId, dateKey, hour },
      [
        {
          $set: {
            orders: { $max: [0, '$orders'] },
          },
        },
      ],
    )
  }
}

function buildOrderInsightIncrements(order, multiplier = 1) {
  const safeMultiplier = Number(multiplier || 1)
  if (!safeMultiplier) return null

  const items = Array.isArray(order?.items) ? order.items : []
  const totalQuantity = items.reduce((sum, item) => sum + clampNonNegative(item?.quantity), 0)
  const uniqueItems = new Set(items.map((item) => String(item?.menuItemId || '').trim()).filter(Boolean)).size
  const rating = Number(order?.customerRating || 0)

  const increments = {
    completedOrders: safeMultiplier,
    totalItemsSold: totalQuantity * safeMultiplier,
    singleItemOrders: uniqueItems <= 1 ? safeMultiplier : 0,
    multiItemOrders: uniqueItems > 1 ? safeMultiplier : 0,
  }

  if (rating >= 1 && rating <= 5) {
    increments.ratedOrders = safeMultiplier
    increments.totalRating = rating * safeMultiplier
    increments[`rating${rating}Count`] = safeMultiplier
  }

  return increments
}

function buildPairIncrements(order, multiplier = 1) {
  const safeMultiplier = Number(multiplier || 1)
  if (!safeMultiplier) return []

  const itemNames = [...new Set(
    (Array.isArray(order?.items) ? order.items : [])
      .map((item) => String(item?.name || '').trim())
      .filter(Boolean),
  )]

  const pairs = []
  for (let indexA = 0; indexA < itemNames.length; indexA += 1) {
    for (let indexB = indexA + 1; indexB < itemNames.length; indexB += 1) {
      const sorted = [itemNames[indexA], itemNames[indexB]].sort((a, b) => a.localeCompare(b))
      pairs.push({
        pairKey: `${sorted[0]} + ${sorted[1]}`,
        itemA: sorted[0],
        itemB: sorted[1],
        count: safeMultiplier,
      })
    }
  }

  return pairs
}

async function upsertOrderInsightsDaily({ restaurantId, date, dateKey, increments }) {
  const safeIncrements = {}
  Object.entries(increments || {}).forEach(([key, value]) => {
    const numeric = sanitizeMetricIncrement(value)
    if (!numeric) return
    safeIncrements[key] = numeric
  })

  if (!Object.keys(safeIncrements).length) return

  await AnalyticsOrderInsightsDaily.updateOne(
    { restaurantId, dateKey },
    {
      $setOnInsert: {
        restaurantId,
        date,
        dateKey,
      },
      $inc: safeIncrements,
    },
    { upsert: true },
  )

  if (Object.values(safeIncrements).some((value) => value < 0)) {
    await AnalyticsOrderInsightsDaily.updateOne(
      { restaurantId, dateKey },
      [
        {
          $set: {
            completedOrders: { $max: [0, '$completedOrders'] },
            totalItemsSold: { $max: [0, '$totalItemsSold'] },
            singleItemOrders: { $max: [0, '$singleItemOrders'] },
            multiItemOrders: { $max: [0, '$multiItemOrders'] },
            ratedOrders: { $max: [0, '$ratedOrders'] },
            totalRating: { $max: [0, '$totalRating'] },
            rating1Count: { $max: [0, '$rating1Count'] },
            rating2Count: { $max: [0, '$rating2Count'] },
            rating3Count: { $max: [0, '$rating3Count'] },
            rating4Count: { $max: [0, '$rating4Count'] },
            rating5Count: { $max: [0, '$rating5Count'] },
          },
        },
      ],
    )
  }
}

async function upsertBasketPairDaily({ restaurantId, date, dateKey, pairs = [] }) {
  if (!Array.isArray(pairs) || !pairs.length) return

  await AnalyticsBasketPairDaily.bulkWrite(
    pairs.map((pair) => ({
      updateOne: {
        filter: {
          restaurantId,
          dateKey,
          pairKey: pair.pairKey,
        },
        update: {
          $setOnInsert: {
            restaurantId,
            date,
            dateKey,
            pairKey: pair.pairKey,
            itemA: pair.itemA,
            itemB: pair.itemB,
          },
          $inc: {
            count: sanitizeMetricIncrement(pair.count),
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  )
}

function buildAnalyticsClaimSelector(orderId) {
  return {
    _id: orderId,
    isArchived: false,
    orderStatus: 'Completed',
    analyticsTrackedAt: null,
    $or: [
      { analyticsTrackingState: '' },
      { analyticsTrackingState: { $exists: false } },
      {
        analyticsTrackingState: 'processing',
        analyticsTrackingStartedAt: {
          $lte: new Date(Date.now() - ANALYTICS_TRACKING_STALE_SECONDS * 1000),
        },
      },
    ],
  }
}

async function claimCompletedOrderForAnalytics(orderId) {
  return Order.findOneAndUpdate(
    buildAnalyticsClaimSelector(orderId),
    {
      $set: {
        analyticsTrackingState: 'processing',
        analyticsTrackingStartedAt: new Date(),
      },
    },
    {
      new: true,
    },
  ).lean()
}

async function markCompletedOrderAnalyticsTracked(orderId) {
  const trackedAt = new Date()
  await Order.updateOne(
    {
      _id: orderId,
      isArchived: false,
      analyticsTrackingState: 'processing',
      analyticsTrackedAt: null,
    },
    {
      $set: {
        analyticsTrackedAt: trackedAt,
        analyticsTrackingState: 'tracked',
      },
      $unset: {
        analyticsTrackingStartedAt: '',
      },
    },
  )

  return trackedAt
}

async function markCompletedOrderAnalyticsClaimFailed(orderId) {
  await Order.updateOne(
    {
      _id: orderId,
      isArchived: false,
      analyticsTrackingState: 'processing',
      analyticsTrackedAt: null,
    },
    {
      $set: { analyticsTrackingState: '' },
      $unset: { analyticsTrackingStartedAt: '' },
    },
  )
}

export async function trackMenuExposure({
  restaurantId,
  menuItemIds = [],
  resolvedMenuItems = null,
  sessionId,
  eventId = '',
  occurredAt = new Date(),
}) {
  const normalizedSessionId = String(sessionId || '').trim()
  const uniqueIds = [...new Set((Array.isArray(menuItemIds) ? menuItemIds : []).map((id) => String(id || '').trim()))]
    .filter((id) => isValidObjectId(id))

  if (!restaurantId || !normalizedSessionId || !uniqueIds.length) {
    return { tracked: 0 }
  }

  const idempotency = await registerAnalyticsEventIdempotency({
    restaurantId,
    eventType: 'menu-view',
    eventId,
    occurredAt,
  })
  if (!idempotency.accepted) {
    return { tracked: 0, deduplicated: true }
  }

  const date = normalizeDate(occurredAt)
  const dateKey = toDateKey(date)
  const expiresAt = addDays(date, 45)
  const menuMap =
    resolvedMenuItems instanceof Map
      ? resolvedMenuItems
      : Array.isArray(resolvedMenuItems)
        ? new Map(
            resolvedMenuItems.map((item) => [String(item?._id || ''), item]).filter(([id]) => Boolean(id)),
          )
        : await loadMenuItemsMap(restaurantId, uniqueIds)

  const validIds = uniqueIds.filter((menuItemId) => menuMap.has(menuItemId))
  if (!validIds.length) {
    return { tracked: 0 }
  }

  const exposureOperations = validIds.map((menuItemId) => ({
    menuItemId,
    operation: {
      updateOne: {
        filter: {
          restaurantId,
          menuItemId,
          sessionId: normalizedSessionId,
          dateKey,
        },
        update: {
          $setOnInsert: {
            restaurantId,
            menuItemId,
            sessionId: normalizedSessionId,
            dateKey,
            firstSeenAt: occurredAt,
            lastSeenAt: occurredAt,
            expiresAt,
          },
        },
        upsert: true,
      },
    },
  }))

  const exposureWriteResult = await AnalyticsExposureSession.bulkWrite(
    exposureOperations.map((entry) => entry.operation),
    { ordered: false },
  )

  const insertedOperationIndexes = exposureWriteResult?.upsertedIds
    ? Object.keys(exposureWriteResult.upsertedIds).map((key) => Number(key))
    : []
  const insertedMenuItems = insertedOperationIndexes
    .map((index) => exposureOperations[index]?.menuItemId)
    .filter(Boolean)
  const tracked = insertedMenuItems.length

  if (tracked > 0) {
    await Promise.all([
      AnalyticsItemDailyMetrics.bulkWrite(
        insertedMenuItems.map((menuItemId) => ({
          updateOne: {
            filter: { restaurantId, menuItemId, dateKey },
            update: {
              $setOnInsert: {
                restaurantId,
                menuItemId,
                menuItemName: String(menuMap.get(menuItemId)?.name || '').trim(),
                categoryId: menuMap.get(menuItemId)?.categoryId || null,
                date,
                dateKey,
              },
              $inc: { views: 1 },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      ),
      upsertDailyMetric({
        restaurantId,
        date,
        dateKey,
        increments: { views: tracked },
      }),
    ])
  }

  return { tracked }
}

export async function trackAddToCart({
  restaurantId,
  eventId = '',
  menuItemId,
  quantity = 1,
  occurredAt = new Date(),
}) {
  const normalizedMenuItemId = String(menuItemId || '').trim()
  if (!restaurantId || !isValidObjectId(normalizedMenuItemId)) {
    return { tracked: false }
  }

  const idempotency = await registerAnalyticsEventIdempotency({
    restaurantId,
    eventType: 'add-to-cart',
    eventId,
    occurredAt,
  })
  if (!idempotency.accepted) {
    return { tracked: false, deduplicated: true }
  }

  const menuItem = await MenuItem.findOne({
    _id: normalizedMenuItemId,
    restaurantId,
  })
    .select('_id categoryId name')
    .lean()

  if (!menuItem) {
    return { tracked: false }
  }

  const safeQuantity = Math.max(1, Number(quantity || 1))
  const date = normalizeDate(occurredAt)
  const dateKey = toDateKey(date)

  await Promise.all([
    upsertItemDailyMetric({
      restaurantId,
      menuItemId: menuItem._id,
      categoryId: menuItem.categoryId || null,
      menuItemName: menuItem.name || '',
      date,
      dateKey,
      increments: { addToCart: safeQuantity },
    }),
    upsertDailyMetric({
      restaurantId,
      date,
      dateKey,
      increments: { addToCart: safeQuantity },
    }),
  ])

  return { tracked: true }
}

export async function applyCompletedOrderAnalytics(order, multiplier = 1, preloadedMenuMap = null) {
  if (!order?.restaurantId || !Array.isArray(order?.items) || !order.items.length) {
    return
  }

  const safeMultiplier = Number(multiplier || 1)
  if (!safeMultiplier) return

  const completedAt = order.completedAt || order.updatedAt || order.createdAt || new Date()
  const date = normalizeDate(completedAt)
  const dateKey = toDateKey(date)
  const completedHour = normalizeHour(completedAt)
  const itemBreakdown = buildPurchaseBreakdown(order)
  const orderInsightIncrements = buildOrderInsightIncrements(order, safeMultiplier)
  const basketPairs = buildPairIncrements(order, safeMultiplier)
  const menuMap = preloadedMenuMap instanceof Map
    ? preloadedMenuMap
    : await loadMenuItemsMap(
        order.restaurantId,
        itemBreakdown.map((entry) => entry.menuItemId),
      )

  await Promise.all([
    ...itemBreakdown
      .filter((entry) => menuMap.has(entry.menuItemId))
      .map((entry) =>
        upsertItemDailyMetric({
          restaurantId: order.restaurantId,
          menuItemId: entry.menuItemId,
          menuItemName: menuMap.get(entry.menuItemId)?.name || '',
          categoryId: menuMap.get(entry.menuItemId)?.categoryId || null,
          date,
          dateKey,
          increments: {
            orders: safeMultiplier,
            quantitySold: entry.quantity * safeMultiplier,
            revenue: round2(entry.revenue * safeMultiplier),
          },
        }),
      ),
    upsertDailyMetric({
      restaurantId: order.restaurantId,
      date,
      dateKey,
      increments: {
        completedOrders: safeMultiplier,
        revenue: round2(clampNonNegative(order.totalAmount) * safeMultiplier),
      },
    }),
    upsertHourlyMetric({
      restaurantId: order.restaurantId,
      date,
      dateKey,
      hour: completedHour,
      increment: safeMultiplier,
    }),
    upsertOrderInsightsDaily({
      restaurantId: order.restaurantId,
      date,
      dateKey,
      increments: orderInsightIncrements,
    }),
    upsertBasketPairDaily({
      restaurantId: order.restaurantId,
      date,
      dateKey,
      pairs: basketPairs,
    }),
  ])
}

export async function syncCompletedOrderAnalytics(orderId) {
  const claimedOrder = await claimCompletedOrderForAnalytics(orderId)
  if (!claimedOrder) {
    return Order.findById(orderId)
      .select('_id orderStatus analyticsTrackedAt')
      .lean()
  }

  try {
    await applyCompletedOrderAnalytics(claimedOrder, 1)
    const trackedAt = await markCompletedOrderAnalyticsTracked(claimedOrder._id)
    return { ...claimedOrder, analyticsTrackedAt: trackedAt, analyticsTrackingState: 'tracked' }
  } catch (error) {
    await markCompletedOrderAnalyticsClaimFailed(claimedOrder._id)
    throw error
  }
}

export async function revertCompletedOrderAnalytics(order) {
  if (!order?.analyticsTrackedAt) return

  await applyCompletedOrderAnalytics(order, -1)
}

export async function applyOrderRatingAnalytics({
  restaurantId,
  completedAt,
  nextRating,
  previousRating = null,
}) {
  const numericNext = Number(nextRating || 0)
  const numericPrevious = Number(previousRating || 0)
  if (!restaurantId || numericNext < 1 || numericNext > 5) {
    return false
  }

  const date = normalizeDate(completedAt || new Date())
  const dateKey = toDateKey(date)
  const increments = {
    ratedOrders: numericPrevious >= 1 && numericPrevious <= 5 ? 0 : 1,
    totalRating: numericNext - (numericPrevious >= 1 && numericPrevious <= 5 ? numericPrevious : 0),
    [`rating${numericNext}Count`]: 1,
  }

  if (numericPrevious >= 1 && numericPrevious <= 5) {
    increments[`rating${numericPrevious}Count`] = -1
  }

  await upsertOrderInsightsDaily({
    restaurantId,
    date,
    dateKey,
    increments,
  })

  return true
}

export async function backfillCompletedOrderAnalytics({ restaurantId, batchSize = 200 } = {}) {
  if (!restaurantId) return 0

  const candidates = await Order.find({
    restaurantId,
    isArchived: false,
    orderStatus: 'Completed',
    analyticsTrackedAt: null,
  })
    .sort({ completedAt: 1, createdAt: 1 })
    .limit(Math.max(1, Math.min(Number(batchSize || 200), 1000)))
    .lean()

  if (!candidates.length) return 0

  const uniqueMenuIds = [...new Set(
    candidates
      .flatMap((order) => (Array.isArray(order?.items) ? order.items : []))
      .map((item) => String(item?.menuItemId || '').trim())
      .filter(Boolean),
  )]
  const preloadedMenuMap = uniqueMenuIds.length
    ? await loadMenuItemsMap(restaurantId, uniqueMenuIds)
    : new Map()

  let processedCount = 0
  for (let offset = 0; offset < candidates.length; offset += ANALYTICS_BACKFILL_CONCURRENCY) {
    const batch = candidates.slice(offset, offset + ANALYTICS_BACKFILL_CONCURRENCY)

    const results = await Promise.all(
      batch.map(async (order) => {
        const claimedOrder = await claimCompletedOrderForAnalytics(order._id)
        if (!claimedOrder) {
          return 0
        }

        try {
          await applyCompletedOrderAnalytics(claimedOrder, 1, preloadedMenuMap)
          await markCompletedOrderAnalyticsTracked(claimedOrder._id)
          return 1
        } catch (error) {
          await markCompletedOrderAnalyticsClaimFailed(claimedOrder._id)
          logger.warn('analytics_backfill_order_failed', {
            orderId: String(order?._id || ''),
            restaurantId: String(restaurantId),
            message: error?.message || 'analytics backfill order failed',
          })
          return 0
        }
      }),
    )

    processedCount += results.reduce((sum, value) => sum + Number(value || 0), 0)
  }

  return processedCount
}

function buildTrendBuckets(startDate, endDate) {
  const start = normalizeDate(startDate)
  const end = normalizeDate(endDate)
  const buckets = []
  const cursor = new Date(start)

  while (cursor <= end) {
    const dateKey = toDateKey(cursor)
    buckets.push({
      dateKey,
      label: cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  return buckets
}

function percentage(numerator, denominator) {
  if (!denominator || denominator <= 0) return 0
  return round2((Number(numerator || 0) / Number(denominator || 0)) * 100)
}

function boundedPercentage(numerator, denominator) {
  const safeDenominator = clampNonNegative(denominator)
  if (!safeDenominator) return 0
  const safeNumerator = Math.min(clampNonNegative(numerator), safeDenominator)
  return percentage(safeNumerator, safeDenominator)
}

function buildGrowth(currentValue, previousValue, formatter = 'number') {
  const current = Number(currentValue || 0)
  const previous = Number(previousValue || 0)
  const absoluteChange = round2(current - previous)
  const growthRate = previous > 0 ? round2(((current - previous) / previous) * 100) : current > 0 ? 100 : 0

  return {
    current: formatter === 'currency' ? round2(current) : current,
    previous: formatter === 'currency' ? round2(previous) : previous,
    absoluteChange,
    growthRate,
  }
}

function buildDropoff(views, orders) {
  const viewCount = clampNonNegative(views)
  const orderCount = clampNonNegative(orders)
  return Math.max(0, viewCount - orderCount)
}

function computeAov(revenue, orders) {
  const safeOrders = clampNonNegative(orders)
  if (!safeOrders) return 0
  return round2(clampNonNegative(revenue) / safeOrders)
}

function createEmptyTotals() {
  return {
    views: 0,
    addToCart: 0,
    orders: 0,
    revenue: 0,
  }
}

function normalizeHourLabel(hour) {
  const safeHour = Math.max(0, Math.min(23, Number(hour || 0)))
  const suffix = safeHour >= 12 ? 'PM' : 'AM'
  const displayHour = safeHour % 12 || 12
  return `${displayHour}${suffix}`
}

async function aggregateItemMetrics({ restaurantId, startDate, endDate }) {
  return AnalyticsItemDailyMetrics.aggregate([
    {
      $match: {
        restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
        date: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: '$menuItemId',
        name: { $last: '$menuItemName' },
        views: { $sum: '$views' },
        addToCart: { $sum: '$addToCart' },
        orders: { $sum: '$orders' },
        quantitySold: { $sum: '$quantitySold' },
        revenue: { $sum: '$revenue' },
      },
    },
    {
      $project: {
        _id: 0,
        menuItemId: '$_id',
        name: { $ifNull: ['$name', 'Deleted item'] },
        views: 1,
        addToCart: 1,
        orders: 1,
        quantitySold: 1,
        revenue: 1,
      },
    },
  ])
}

async function hydrateAggregatedItemNames(restaurantId, items = []) {
  const rows = Array.isArray(items) ? items : []
  const missingIds = rows
    .filter((item) => !String(item?.name || '').trim())
    .map((item) => String(item?.menuItemId || '').trim())
    .filter((id) => isValidObjectId(id))

  if (!missingIds.length) {
    return rows.map((item) => ({
      ...item,
      name: String(item?.name || '').trim() || 'Archived item',
    }))
  }

  const menuMap = await loadMenuItemsMap(restaurantId, missingIds)

  return rows.map((item) => ({
    ...item,
    name: String(item?.name || '').trim() || menuMap.get(String(item?.menuItemId || ''))?.name || 'Archived item',
  }))
}

async function aggregateHourlyOrders({ restaurantId, startDate, endDate }) {
  return OrderHourlyMetrics.aggregate([
    {
      $match: {
        restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
        date: {
          $gte: startDate,
          $lte: endDate,
        },
      },
    },
    {
      $group: {
        _id: { hour: '$hour' },
        orders: { $sum: '$orders' },
      },
    },
    { $sort: { '_id.hour': 1 } },
  ])
}

async function aggregateOrderInsightsDaily({ restaurantId, startDate, endDate }) {
  return AnalyticsOrderInsightsDaily.find({
    restaurantId,
    date: { $gte: startDate, $lte: endDate },
  })
    .select('date dateKey completedOrders totalItemsSold singleItemOrders multiItemOrders ratedOrders totalRating rating1Count rating2Count rating3Count rating4Count rating5Count')
    .sort({ date: 1 })
    .lean()
}

async function aggregateBasketPairs({ restaurantId, startDate, endDate }) {
  return AnalyticsBasketPairDaily.aggregate([
    {
      $match: {
        restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
        date: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: '$pairKey',
        itemA: { $first: '$itemA' },
        itemB: { $first: '$itemB' },
        count: { $sum: '$count' },
      },
    },
    {
      $project: {
        _id: 0,
        pairKey: '$_id',
        itemA: 1,
        itemB: 1,
        count: 1,
      },
    },
  ])
}

function sumTotalsFromDailyMetrics(dailyMetrics = []) {
  return (Array.isArray(dailyMetrics) ? dailyMetrics : []).reduce(
    (acc, entry) => ({
      views: acc.views + clampNonNegative(entry.views),
      addToCart: acc.addToCart + clampNonNegative(entry.addToCart),
      orders: acc.orders + clampNonNegative(entry.completedOrders),
      revenue: round2(acc.revenue + round2(entry.revenue)),
    }),
    createEmptyTotals(),
  )
}

function buildTrendSeries({ dailyMetrics, startDate, endDate }) {
  const dailyByKey = new Map(
    (Array.isArray(dailyMetrics) ? dailyMetrics : []).map((entry) => [
      entry.dateKey,
      {
        revenue: round2(entry.revenue),
        orders: clampNonNegative(entry.completedOrders),
        views: clampNonNegative(entry.views),
      },
    ]),
  )

  return buildTrendBuckets(startDate, endDate).map((bucket) => ({
    day: bucket.label,
    revenue: round2(dailyByKey.get(bucket.dateKey)?.revenue),
    orders: clampNonNegative(dailyByKey.get(bucket.dateKey)?.orders),
    views: clampNonNegative(dailyByKey.get(bucket.dateKey)?.views),
  }))
}

function buildHourlySeries(hourlyRows = []) {
  const ordersByHour = new Map(
    (Array.isArray(hourlyRows) ? hourlyRows : []).map((entry) => [Number(entry?._id?.hour), clampNonNegative(entry?.orders)]),
  )

  return Array.from({ length: 24 }, (_, hour) => {
    return {
      hour: normalizeHourLabel(hour),
      hour24: hour,
      orders: clampNonNegative(ordersByHour.get(hour)),
    }
  })
}

function cleanupExpiredLocalBackfillLocks() {
  const now = Date.now()
  for (const [key, expiresAt] of localBackfillLocks.entries()) {
    if (expiresAt <= now) {
      localBackfillLocks.delete(key)
    }
  }
}

async function acquireAnalyticsBackfillLock(restaurantId) {
  const normalizedRestaurantId = String(restaurantId || '').trim()
  if (!normalizedRestaurantId) {
    return false
  }

  cleanupExpiredLocalBackfillLocks()
  const localKey = `analytics-backfill:${normalizedRestaurantId}`
  const localExpiresAt = Number(localBackfillLocks.get(localKey) || 0)
  if (localExpiresAt > Date.now()) {
    return false
  }

  localBackfillLocks.set(localKey, Date.now() + ANALYTICS_BACKFILL_LOCK_SECONDS * 1000)

  const acquiredInRedis = await withRedis(
    'analytics_backfill_lock_acquire',
    async (redis) => {
      const result = await redis.set(localKey, '1', { nx: true, ex: ANALYTICS_BACKFILL_LOCK_SECONDS })
      return result === 'OK' || result === true
    },
    null,
  )

  if (acquiredInRedis === false) {
    localBackfillLocks.delete(localKey)
    return false
  }

  return true
}

async function releaseAnalyticsBackfillLock(restaurantId) {
  const normalizedRestaurantId = String(restaurantId || '').trim()
  if (!normalizedRestaurantId) return

  const localKey = `analytics-backfill:${normalizedRestaurantId}`
  localBackfillLocks.delete(localKey)
  await withRedis('analytics_backfill_lock_release', (redis) => redis.del(localKey), null)
}

export async function scheduleCompletedOrderAnalyticsBackfill({ restaurantId } = {}) {
  if (!restaurantId) return false

  const lockAcquired = await acquireAnalyticsBackfillLock(restaurantId)
  if (!lockAcquired) {
    return false
  }

  setTimeout(async () => {
    try {
      let processed = 0
      let batches = 0
      let totalProcessed = 0

      do {
        processed = await backfillCompletedOrderAnalytics({
          restaurantId,
          batchSize: ANALYTICS_BACKFILL_BATCH_SIZE,
        })
        totalProcessed += processed
        batches += 1
      } while (processed > 0 && batches < ANALYTICS_BACKFILL_MAX_BATCHES_PER_RUN)

      if (totalProcessed > 0) {
        invalidateCacheByTags([`analytics:${String(restaurantId)}`])
      }
    } catch (error) {
      logger.warn('analytics_backfill_failed', {
        restaurantId: String(restaurantId),
        message: error?.message || 'analytics backfill failed',
      })
    } finally {
      await releaseAnalyticsBackfillLock(restaurantId)
    }
  }, 0)

  return true
}

function buildItemGrowthList({ currentItems, previousItems, sortFn, limit = 5 }) {
  const previousById = new Map(
    (Array.isArray(previousItems) ? previousItems : []).map((item) => [String(item.menuItemId), item]),
  )

  return [...(Array.isArray(currentItems) ? currentItems : [])]
    .map((item) => {
      const previous = previousById.get(String(item.menuItemId)) || {}
      return {
        menuItemId: String(item.menuItemId),
        name: item.name,
        views: clampNonNegative(item.views),
        orders: clampNonNegative(item.orders),
        revenue: round2(item.revenue),
        conversionRate: percentage(item.orders, item.views),
        orderGrowth: buildGrowth(item.orders, previous.orders),
        revenueGrowth: buildGrowth(item.revenue, previous.revenue, 'currency'),
      }
    })
    .sort(sortFn)
    .slice(0, limit)
}

export async function buildAnalyticsOverview({ restaurantId, rangeDays = 14 }) {
  const safeRangeDays = Math.max(1, Math.min(Number(rangeDays || 14), 90))
  const currentEndDate = normalizeDate(new Date())
  const currentStartDate = normalizeDate(addDays(currentEndDate, -(safeRangeDays - 1)))
  const previousEndDate = normalizeDate(addDays(currentStartDate, -1))
  const previousStartDate = normalizeDate(addDays(previousEndDate, -(safeRangeDays - 1)))

  const [currentDailyMetrics, previousDailyMetrics, currentItems, previousItems, currentHourly, previousHourly] = await Promise.all([
    AnalyticsDailyMetrics.find({
      restaurantId,
      date: { $gte: currentStartDate, $lte: currentEndDate },
    })
      .sort({ date: 1 })
      .select('date dateKey views addToCart completedOrders revenue')
      .lean(),
    AnalyticsDailyMetrics.find({
      restaurantId,
      date: { $gte: previousStartDate, $lte: previousEndDate },
    })
      .sort({ date: 1 })
      .select('date dateKey views addToCart completedOrders revenue')
      .lean(),
    aggregateItemMetrics({ restaurantId, startDate: currentStartDate, endDate: currentEndDate }),
    aggregateItemMetrics({ restaurantId, startDate: previousStartDate, endDate: previousEndDate }),
    aggregateHourlyOrders({ restaurantId, startDate: currentStartDate, endDate: currentEndDate }),
    aggregateHourlyOrders({ restaurantId, startDate: previousStartDate, endDate: previousEndDate }),
  ])

  const currentTotals = sumTotalsFromDailyMetrics(currentDailyMetrics)
  const previousTotals = sumTotalsFromDailyMetrics(previousDailyMetrics)

  const currentAov = computeAov(currentTotals.revenue, currentTotals.orders)
  const previousAov = computeAov(previousTotals.revenue, previousTotals.orders)
  const currentConversion = percentage(currentTotals.orders, currentTotals.views)
  const previousConversion = percentage(previousTotals.orders, previousTotals.views)

  const revenueGrowth = buildGrowth(currentTotals.revenue, previousTotals.revenue, 'currency')
  const ordersGrowth = buildGrowth(currentTotals.orders, previousTotals.orders)
  const aovGrowth = buildGrowth(currentAov, previousAov, 'currency')
  const conversionGrowth = buildGrowth(currentConversion, previousConversion)
  const viewsGrowth = buildGrowth(currentTotals.views, previousTotals.views)
  const dropoffCurrent = buildDropoff(currentTotals.views, currentTotals.orders)
  const dropoffPrevious = buildDropoff(previousTotals.views, previousTotals.orders)
  const dropoffGrowth = buildGrowth(dropoffCurrent, dropoffPrevious)

  const revenueTrend = buildTrendSeries({
    dailyMetrics: currentDailyMetrics,
    startDate: currentStartDate,
    endDate: currentEndDate,
  })

  const currentPeakHours = buildHourlySeries(currentHourly)
  const previousPeakHours = buildHourlySeries(previousHourly)
  const currentPeakHour = [...currentPeakHours].sort((a, b) => b.orders - a.orders)[0] || { hour: '-', orders: 0 }
  const previousPeakHour = [...previousPeakHours].sort((a, b) => b.orders - a.orders)[0] || { hour: '-', orders: 0 }

  const topItems = buildItemGrowthList({
    currentItems,
    previousItems,
    sortFn: (a, b) => b.revenue - a.revenue || b.orders - a.orders,
    limit: 5,
  })
  const bottomItems = buildItemGrowthList({
    currentItems: (Array.isArray(currentItems) ? currentItems : []).filter((item) => item.views > 0 || item.orders > 0 || item.revenue > 0),
    previousItems,
    sortFn: (a, b) => a.revenue - b.revenue || a.orders - b.orders || b.views - a.views,
    limit: 5,
  })

  return {
    rangeDays: safeRangeDays,
    period: {
      current: {
        startDate: currentStartDate.toISOString(),
        endDate: currentEndDate.toISOString(),
      },
      previous: {
        startDate: previousStartDate.toISOString(),
        endDate: previousEndDate.toISOString(),
      },
    },
    summary: {
      revenue: revenueGrowth,
      orders: ordersGrowth,
      aov: aovGrowth,
      conversionRate: conversionGrowth,
    },
    overview: {
      totalRevenue: currentTotals.revenue,
      totalOrders: currentTotals.orders,
      totalViews: currentTotals.views,
      aov: currentAov,
      conversionRate: currentConversion,
    },
    charts: {
      revenueTrend,
      peakHours: currentPeakHours,
    },
    viewsVsOrders: {
      views: viewsGrowth,
      orders: ordersGrowth,
      conversionRate: conversionGrowth,
      comparison: revenueTrend.map((entry) => ({
        day: entry.day,
        views: entry.views,
        orders: entry.orders,
      })),
    },
    items: {
      top: topItems,
      bottom: bottomItems,
    },
    peakHours: {
      current: currentPeakHour,
      previous: previousPeakHour,
      growth: buildGrowth(currentPeakHour.orders, previousPeakHour.orders),
    },
    dropoffInsight: {
      lostUsers: dropoffGrowth,
      message: `${dropoffCurrent} users viewed but did not order`,
    },
  }
}

function startOfMonth(dateLike = new Date()) {
  const date = normalizeDate(dateLike)
  date.setDate(1)
  return date
}

function startOfYear(dateLike = new Date()) {
  const date = normalizeDate(dateLike)
  date.setMonth(0, 1)
  return date
}

function differenceInDaysInclusive(startDate, endDate) {
  const start = normalizeDate(startDate)
  const end = normalizeDate(endDate)
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1)
}

function resolveAnalyticsRange(range) {
  const normalized = String(range || '').trim().toLowerCase()
  const today = normalizeDate(new Date())

  if (normalized === 'today') {
    const previous = addDays(today, -1)
    return {
      key: 'today',
      label: 'Today',
      currentStartDate: today,
      currentEndDate: today,
      previousStartDate: previous,
      previousEndDate: previous,
    }
  }

  if (normalized === 'this_month' || normalized === 'month' || normalized === 'thismonth') {
    const currentStartDate = startOfMonth(today)
    const elapsedDays = differenceInDaysInclusive(currentStartDate, today)
    const previousMonthEnd = addDays(currentStartDate, -1)
    const previousStartDate = startOfMonth(previousMonthEnd)
    const previousEndDate = addDays(previousStartDate, elapsedDays - 1)

    return {
      key: 'this_month',
      label: 'This Month',
      currentStartDate,
      currentEndDate: today,
      previousStartDate,
      previousEndDate,
    }
  }

  if (normalized === 'yearly' || normalized === 'year' || normalized === 'ytd') {
    const currentStartDate = startOfYear(today)
    const elapsedDays = differenceInDaysInclusive(currentStartDate, today)
    const previousStartDate = startOfYear(addDays(currentStartDate, -1))
    const previousEndDate = addDays(previousStartDate, elapsedDays - 1)

    return {
      key: 'yearly',
      label: 'Yearly',
      currentStartDate,
      currentEndDate: today,
      previousStartDate,
      previousEndDate,
    }
  }

  const numericRange = Number.parseInt(normalized.replace(/d$/, ''), 10)
  const safeDays = [7, 14, 30].includes(numericRange) ? numericRange : 14
  const currentStartDate = normalizeDate(addDays(today, -(safeDays - 1)))
  const previousEndDate = normalizeDate(addDays(currentStartDate, -1))
  const previousStartDate = normalizeDate(addDays(previousEndDate, -(safeDays - 1)))

  return {
    key: `${safeDays}d`,
    label: `${safeDays} Days`,
    currentStartDate,
    currentEndDate: today,
    previousStartDate,
    previousEndDate,
  }
}

function buildMetricDelta(currentValue, previousValue, precision = 2) {
  const current = Number(currentValue || 0)
  const previous = Number(previousValue || 0)
  const change = round2(current - previous)
  const rawPercent = previous > 0 ? ((current - previous) / previous) * 100 : current > 0 ? 100 : 0
  const changePercent = Number(rawPercent.toFixed(precision))

  return {
    value: round2(current),
    previousValue: round2(previous),
    change,
    changePercent,
  }
}

function average(values = []) {
  if (!Array.isArray(values) || values.length === 0) return 0
  const total = values.reduce((sum, value) => sum + Number(value || 0), 0)
  return total / values.length
}

function buildAdvancedTrendSeries({ dailyMetrics, startDate, endDate }) {
  const dailyByKey = new Map(
    (Array.isArray(dailyMetrics) ? dailyMetrics : []).map((entry) => [
      entry.dateKey,
      {
        revenue: round2(entry.revenue),
        orders: clampNonNegative(entry.completedOrders),
        views: clampNonNegative(entry.views),
      },
    ]),
  )

  return buildTrendBuckets(startDate, endDate).map((bucket) => {
    const row = dailyByKey.get(bucket.dateKey) || {}
    const revenue = round2(row.revenue)
    const orders = clampNonNegative(row.orders)
    const views = clampNonNegative(row.views)

    return {
      date: bucket.dateKey,
      label: bucket.label,
      revenue,
      orders,
      conversion: boundedPercentage(orders, views),
    }
  })
}

function buildTrendArrays(points = []) {
  const rows = Array.isArray(points) ? points : []
  return {
    combined: rows,
    revenueTrend: rows.map((point) => ({ date: point.date, revenue: point.revenue })),
    ordersTrend: rows.map((point) => ({ date: point.date, orders: point.orders })),
    conversionTrend: rows.map((point) => ({ date: point.date, conversion: point.conversion })),
  }
}

function classifyItemIntelligence(items = []) {
  const activeItems = (Array.isArray(items) ? items : []).filter((item) => item.views > 0 || item.orders > 0 || item.revenue > 0)
  if (!activeItems.length) {
    return {
      winners: [],
      losers: [],
      hiddenGems: [],
      comparison: [],
    }
  }

  const normalizedItems = activeItems.map((item) => ({
    itemId: String(item.menuItemId),
    name: item.name || 'Archived item',
    views: clampNonNegative(item.views),
    addToCart: clampNonNegative(item.addToCart),
    orders: clampNonNegative(item.orders),
    revenue: round2(item.revenue),
    conversion: boundedPercentage(item.orders, item.views),
  }))

  const avgViews = average(normalizedItems.map((item) => item.views))
  const avgOrders = average(normalizedItems.map((item) => item.orders))
  const avgConversion = average(normalizedItems.map((item) => item.conversion))

  const winners = normalizedItems
    .filter((item) => item.views >= avgViews && item.orders >= Math.max(1, avgOrders))
    .sort((a, b) => b.revenue - a.revenue || b.orders - a.orders)
    .slice(0, 5)

  const losers = normalizedItems
    .filter((item) => item.views >= avgViews && item.orders <= Math.max(0, avgOrders * 0.6))
    .sort((a, b) => b.views - a.views || a.orders - b.orders)
    .slice(0, 5)

  const hiddenGems = normalizedItems
    .filter((item) => item.views > 0 && item.views < Math.max(1, avgViews) && item.conversion >= Math.max(10, avgConversion * 1.25) && item.orders > 0)
    .sort((a, b) => b.conversion - a.conversion || b.orders - a.orders)
    .slice(0, 5)

  const comparison = [...normalizedItems]
    .sort((a, b) => b.views - a.views || b.orders - a.orders)
    .slice(0, 8)

  return { winners, losers, hiddenGems, comparison }
}

function buildRevenueContribution(items = [], totalRevenue = 0) {
  const safeTotalRevenue = round2(totalRevenue)
  return [...(Array.isArray(items) ? items : [])]
    .filter((item) => Number(item?.revenue || 0) > 0)
    .sort((a, b) => Number(b?.revenue || 0) - Number(a?.revenue || 0))
    .slice(0, 5)
    .map((item) => ({
      itemId: String(item.menuItemId),
      name: item.name || 'Archived item',
      revenue: round2(item.revenue),
      orders: clampNonNegative(item.orders),
      views: clampNonNegative(item.views),
      conversion: boundedPercentage(item.orders, item.views),
      revenueContribution: percentage(item.revenue, safeTotalRevenue),
    }))
}

function buildTimeIntelligence(hourlyRows = [], averageOrderValue = 0) {
  const safeAov = round2(averageOrderValue)
  const ordersByHour = buildHourlySeries(hourlyRows).map((entry) => ({
    hour: entry.hour,
    hour24: entry.hour24,
    orders: clampNonNegative(entry.orders),
  }))
  const revenueByHour = ordersByHour.map((entry) => ({
    hour: entry.hour,
    hour24: entry.hour24,
    revenue: round2(entry.orders * safeAov),
  }))
  const peak = [...ordersByHour].sort((a, b) => b.orders - a.orders)[0] || { hour: '-', hour24: 0, orders: 0 }

  return {
    ordersByHour,
    revenueByHour,
    peakHour: peak.hour,
    peakOrders: peak.orders,
  }
}

function buildInsights({
  itemGroups,
  funnel,
  dropoff,
  time,
  kpis,
  revenue,
}) {
  const insights = []

  if (itemGroups.losers[0]) {
    insights.push(
      `${itemGroups.losers[0].name} has high visibility but weak order conversion. Consider revisiting pricing, item photo, or menu placement.`,
    )
  }

  if (Number(kpis.cartAbandonment?.value || 0) >= 35) {
    insights.push('Many users add items but do not complete orders. Simplify checkout and review pricing friction at the cart stage.')
  }

  if (funnel.viewToCartRate < 25) {
    insights.push('Customers are seeing the menu but not moving into cart often. Improve item naming, descriptions, and hero-item placement.')
  }

  if (funnel.cartToOrderRate < 55) {
    insights.push('Cart-to-order conversion is soft. Review the final checkout experience and make payment or confirmation steps clearer.')
  }

  if (time.peakOrders > 0) {
    insights.push(`Peak order demand is currently around ${time.peakHour}. Consider aligning staff coverage and kitchen prep for that window.`)
  }

  if (itemGroups.hiddenGems[0]) {
    insights.push(`${itemGroups.hiddenGems[0].name} converts well with relatively low visibility. Promote it more aggressively on the menu.`)
  }

  if (dropoff.usersViewedButNotOrdered > 0) {
    insights.push(`${dropoff.usersViewedButNotOrdered} item views did not turn into completed orders in this period. Focus on reducing drop-off before adding more menu complexity.`)
  }

  if (revenue.topItemsByRevenue[0] && Number(revenue.topItemsByRevenue[0].revenueContribution || 0) >= 30) {
    insights.push(`${revenue.topItemsByRevenue[0].name} is carrying a large share of revenue. Protect availability and consider similar high-margin variants.`)
  }

  return insights.slice(0, 6)
}

export async function buildAdvancedAnalytics({ restaurantId, range = '14d' }) {
  const resolvedRange = resolveAnalyticsRange(range)

  const [currentDailyMetrics, previousDailyMetrics, currentItemsRaw, previousItemsRaw, currentHourly] = await Promise.all([
    AnalyticsDailyMetrics.find({
      restaurantId,
      date: { $gte: resolvedRange.currentStartDate, $lte: resolvedRange.currentEndDate },
    })
      .sort({ date: 1 })
      .select('date dateKey views addToCart completedOrders revenue')
      .lean(),
    AnalyticsDailyMetrics.find({
      restaurantId,
      date: { $gte: resolvedRange.previousStartDate, $lte: resolvedRange.previousEndDate },
    })
      .sort({ date: 1 })
      .select('date dateKey views addToCart completedOrders revenue')
      .lean(),
    aggregateItemMetrics({
      restaurantId,
      startDate: resolvedRange.currentStartDate,
      endDate: resolvedRange.currentEndDate,
    }),
    aggregateItemMetrics({
      restaurantId,
      startDate: resolvedRange.previousStartDate,
      endDate: resolvedRange.previousEndDate,
    }),
    aggregateHourlyOrders({
      restaurantId,
      startDate: resolvedRange.currentStartDate,
      endDate: resolvedRange.currentEndDate,
    }),
  ])

  const [currentItems, previousItems] = await Promise.all([
    hydrateAggregatedItemNames(restaurantId, currentItemsRaw),
    hydrateAggregatedItemNames(restaurantId, previousItemsRaw),
  ])

  const currentTotals = sumTotalsFromDailyMetrics(currentDailyMetrics)
  const previousTotals = sumTotalsFromDailyMetrics(previousDailyMetrics)

  const currentAov = computeAov(currentTotals.revenue, currentTotals.orders)
  const previousAov = computeAov(previousTotals.revenue, previousTotals.orders)
  const currentConversion = boundedPercentage(currentTotals.orders, currentTotals.views)
  const previousConversion = boundedPercentage(previousTotals.orders, previousTotals.views)
  const currentAddToCartRate = boundedPercentage(currentTotals.addToCart, currentTotals.views)
  const previousAddToCartRate = boundedPercentage(previousTotals.addToCart, previousTotals.views)
  const currentCartAbandonment = percentage(
    Math.max(0, currentTotals.addToCart - currentTotals.orders),
    currentTotals.addToCart,
  )
  const previousCartAbandonment = percentage(
    Math.max(0, previousTotals.addToCart - previousTotals.orders),
    previousTotals.addToCart,
  )

  const currentQuantitySold = (Array.isArray(currentItems) ? currentItems : []).reduce(
    (sum, item) => sum + clampNonNegative(item.quantitySold),
    0,
  )
  const previousQuantitySold = (Array.isArray(previousItems) ? previousItems : []).reduce(
    (sum, item) => sum + clampNonNegative(item.quantitySold),
    0,
  )

  const currentRevenuePerView = currentTotals.views > 0 ? round2(currentTotals.revenue / currentTotals.views) : 0
  const previousRevenuePerView = previousTotals.views > 0 ? round2(previousTotals.revenue / previousTotals.views) : 0
  const currentOrderedItemLines = (Array.isArray(currentItems) ? currentItems : []).reduce(
    (sum, item) => sum + clampNonNegative(item.orders),
    0,
  )
  const previousOrderedItemLines = (Array.isArray(previousItems) ? previousItems : []).reduce(
    (sum, item) => sum + clampNonNegative(item.orders),
    0,
  )
  const normalizedCurrentQuantitySold = currentQuantitySold > 0 ? currentQuantitySold : currentOrderedItemLines
  const normalizedPreviousQuantitySold = previousQuantitySold > 0 ? previousQuantitySold : previousOrderedItemLines
  const currentAvgItemsPerOrder = currentTotals.orders > 0 ? round2(normalizedCurrentQuantitySold / currentTotals.orders) : 0
  const previousAvgItemsPerOrder = previousTotals.orders > 0 ? round2(normalizedPreviousQuantitySold / previousTotals.orders) : 0

  const trendPoints = buildAdvancedTrendSeries({
    dailyMetrics: currentDailyMetrics,
    startDate: resolvedRange.currentStartDate,
    endDate: resolvedRange.currentEndDate,
  })

  const funnel = {
    views: currentTotals.views,
    addToCart: currentTotals.addToCart,
    orders: currentTotals.orders,
    viewToCartRate: boundedPercentage(currentTotals.addToCart, currentTotals.views),
    cartToOrderRate: boundedPercentage(currentTotals.orders, currentTotals.addToCart),
    dropOffPercent: percentage(Math.max(0, currentTotals.views - currentTotals.orders), currentTotals.views),
  }

  const itemGroups = classifyItemIntelligence(currentItems)
  const time = buildTimeIntelligence(currentHourly, currentAov)
  const revenue = {
    topItemsByRevenue: buildRevenueContribution(currentItems, currentTotals.revenue),
  }
  const dropoff = {
    usersViewedButNotOrdered: Math.max(0, currentTotals.views - currentTotals.orders),
    cartDrop: Math.max(0, currentTotals.addToCart - currentTotals.orders),
  }

  const kpis = {
    revenue: buildMetricDelta(currentTotals.revenue, previousTotals.revenue),
    orders: buildMetricDelta(currentTotals.orders, previousTotals.orders),
    aov: buildMetricDelta(currentAov, previousAov),
    totalViews: buildMetricDelta(currentTotals.views, previousTotals.views),
    conversionRate: buildMetricDelta(currentConversion, previousConversion),
    addToCartRate: buildMetricDelta(currentAddToCartRate, previousAddToCartRate),
    cartAbandonment: buildMetricDelta(currentCartAbandonment, previousCartAbandonment),
    revenuePerView: buildMetricDelta(currentRevenuePerView, previousRevenuePerView),
    avgItemsPerOrder: buildMetricDelta(currentAvgItemsPerOrder, previousAvgItemsPerOrder),
  }

  const insights = buildInsights({
    itemGroups,
    funnel,
    dropoff,
    time,
    kpis,
    revenue,
  })

  return {
    range: resolvedRange.key,
    label: resolvedRange.label,
    period: {
      current: {
        startDate: resolvedRange.currentStartDate.toISOString(),
        endDate: resolvedRange.currentEndDate.toISOString(),
      },
      previous: {
        startDate: resolvedRange.previousStartDate.toISOString(),
        endDate: resolvedRange.previousEndDate.toISOString(),
      },
    },
    kpis,
    trends: buildTrendArrays(trendPoints),
    funnel,
    items: itemGroups,
    time,
    revenue,
    dropoff,
    insights,
  }
}

function computeMedian(values = []) {
  const normalized = (Array.isArray(values) ? values : [])
    .map((value) => Number(value || 0))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)

  if (!normalized.length) return 0
  const middle = Math.floor(normalized.length / 2)
  if (normalized.length % 2 === 0) {
    return round2((normalized[middle - 1] + normalized[middle]) / 2)
  }
  return round2(normalized[middle])
}

function safeName(value, fallback) {
  const normalized = String(value || '').trim()
  return normalized || fallback
}

function buildPriceBands(items = []) {
  const rows = Array.isArray(items) ? items : []
  if (!rows.length) return []

  const prices = rows.map((item) => Number(item.price || 0)).filter((value) => value > 0)
  const minPrice = prices.length ? Math.min(...prices) : 0
  const maxPrice = prices.length ? Math.max(...prices) : 0
  const bandCount = 5
  const width = maxPrice > minPrice ? Math.max(1, (maxPrice - minPrice) / bandCount) : 1

  const bands = Array.from({ length: bandCount }, (_, index) => {
    const start = minPrice + width * index
    const end = index === bandCount - 1 ? maxPrice : start + width
    return {
      label: `${Math.round(start)}-${Math.round(end)}`,
      min: start,
      max: end,
      orders: 0,
      conversionTotal: 0,
      count: 0,
    }
  })

  rows.forEach((item) => {
    const price = Number(item.price || 0)
    let band = bands.find((entry, index) => {
      if (index === bands.length - 1) {
        return price >= entry.min && price <= entry.max
      }
      return price >= entry.min && price < entry.max
    })

    if (!band) {
      band = bands[bands.length - 1]
    }

    band.orders += clampNonNegative(item.orders)
    band.conversionTotal += Number(item.conversion || 0)
    band.count += 1
  })

  return bands
    .filter((band) => band.count > 0)
    .map((band) => ({
      band: band.label,
      orders: band.orders,
      conversion: round2(band.conversionTotal / Math.max(1, band.count)),
    }))
}

function buildBasketIntelligence(insightRows = [], pairRows = []) {
  const rows = Array.isArray(insightRows) ? insightRows : []
  const pairs = Array.isArray(pairRows) ? pairRows : []

  const singleItemOrders = rows.reduce((sum, row) => sum + clampNonNegative(row.singleItemOrders), 0)
  const multiItemOrders = rows.reduce((sum, row) => sum + clampNonNegative(row.multiItemOrders), 0)
  const totalOrders = rows.reduce((sum, row) => sum + clampNonNegative(row.completedOrders), 0)

  const basketSizeDistribution = [
    { size: 1, count: singleItemOrders },
    { size: 2, count: multiItemOrders },
  ]

  const frequentlyBoughtTogether = pairs
    .map((pair) => ({
      pair: String(pair.pairKey || `${safeName(pair.itemA, 'Unknown')} + ${safeName(pair.itemB, 'Unknown')}`),
      count: clampNonNegative(pair.count),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return {
    frequentlyBoughtTogether,
    basketSizeDistribution,
    orderTypeSplit: [
      { name: 'Single Item', value: singleItemOrders },
      { name: 'Multi Item', value: multiItemOrders },
    ],
    summary: {
      totalOrders,
      singleItemOrders,
      multiItemOrders,
    },
  }
}

function buildRatingTrend(insightRows = [], startDate, endDate) {
  const byDate = new Map(
    (Array.isArray(insightRows) ? insightRows : []).map((row) => [
      String(row.dateKey),
      {
        totalRating: clampNonNegative(row.totalRating),
        ratedOrders: clampNonNegative(row.ratedOrders),
      },
    ]),
  )

  return buildTrendBuckets(startDate, endDate).map((bucket) => {
    const row = byDate.get(bucket.dateKey) || { totalRating: 0, ratedOrders: 0 }
    return {
      label: bucket.label,
      avgRating: row.ratedOrders ? round2(row.totalRating / row.ratedOrders) : 0,
      ratedOrders: row.ratedOrders,
    }
  })
}

export async function buildDecisionAnalytics({ restaurantId, range = '14d' }) {
  const resolvedRange = resolveAnalyticsRange(range)
  const [advanced, currentItemsRaw, itemDailyRows, menuItems, categories, orderInsightsDaily, basketPairs] = await Promise.all([
    buildAdvancedAnalytics({ restaurantId, range }),
    aggregateItemMetrics({
      restaurantId,
      startDate: resolvedRange.currentStartDate,
      endDate: resolvedRange.currentEndDate,
    }).then((rows) => hydrateAggregatedItemNames(restaurantId, rows)),
    AnalyticsItemDailyMetrics.find({
      restaurantId,
      date: { $gte: resolvedRange.currentStartDate, $lte: resolvedRange.currentEndDate },
    })
      .select('menuItemId menuItemName dateKey views addToCart orders revenue')
      .lean(),
    MenuItem.find({ restaurantId })
      .select('_id name price categoryId')
      .lean(),
    Category.find({ restaurantId })
      .select('_id name')
      .lean(),
    aggregateOrderInsightsDaily({
      restaurantId,
      startDate: resolvedRange.currentStartDate,
      endDate: resolvedRange.currentEndDate,
    }),
    aggregateBasketPairs({
      restaurantId,
      startDate: resolvedRange.currentStartDate,
      endDate: resolvedRange.currentEndDate,
    }),
  ])

  const menuById = new Map(menuItems.map((item) => [String(item._id), item]))
  const categoryById = new Map(categories.map((category) => [String(category._id), safeName(category.name, 'Uncategorized')]))

  const enrichedItems = (Array.isArray(currentItemsRaw) ? currentItemsRaw : []).map((item) => {
    const menu = menuById.get(String(item.menuItemId || ''))
    const price = Number(menu?.price || 0)
    const categoryName = menu?.categoryId ? categoryById.get(String(menu.categoryId)) || 'Uncategorized' : 'Uncategorized'
    const views = clampNonNegative(item.views)
    const addToCart = clampNonNegative(item.addToCart)
    const orders = clampNonNegative(item.orders)
    const revenue = round2(item.revenue)
    const conversion = boundedPercentage(orders, views)

    return {
      itemId: String(item.menuItemId),
      name: safeName(item.name, 'Archived item'),
      categoryName,
      price,
      views,
      addToCart,
      orders,
      revenue,
      conversion,
      avgOrderRevenue: orders > 0 ? round2(revenue / orders) : round2(price),
      viewToCartDropPct: percentage(Math.max(0, views - addToCart), views),
      cartToOrderDropPct: percentage(Math.max(0, addToCart - orders), addToCart),
      dropPct: percentage(Math.max(0, views - orders), views),
    }
  })

  const leakageTable = [...enrichedItems]
    .filter((item) => item.views > 0)
    .sort((a, b) => b.dropPct - a.dropPct || b.views - a.views)

  const topProblemItems = leakageTable.slice(0, 5)
  const trendSeed = buildTrendBuckets(resolvedRange.currentStartDate, resolvedRange.currentEndDate)
  const byItemDate = new Map(
    (Array.isArray(itemDailyRows) ? itemDailyRows : []).map((row) => [
      `${String(row.menuItemId)}:${String(row.dateKey)}`,
      {
        views: clampNonNegative(row.views),
        addToCart: clampNonNegative(row.addToCart),
        orders: clampNonNegative(row.orders),
      },
    ]),
  )

  const topProblemItemsTrend = trendSeed.map((bucket) => {
    const row = { label: bucket.label }
    topProblemItems.forEach((item) => {
      const itemDay = byItemDate.get(`${item.itemId}:${bucket.dateKey}`) || { views: 0, orders: 0 }
      row[item.name] = percentage(Math.max(0, itemDay.views - itemDay.orders), itemDay.views)
    })
    return row
  })

  const hiddenGems = (Array.isArray(advanced?.items?.hiddenGems) ? advanced.items.hiddenGems : [])
    .map((gem) => {
      const matched = enrichedItems.find((item) => item.itemId === gem.itemId)
      const item = matched || {
        itemId: gem.itemId,
        name: gem.name,
        views: clampNonNegative(gem.views),
        orders: clampNonNegative(gem.orders),
        revenue: round2(gem.revenue),
        conversion: round2(gem.conversion),
        avgOrderRevenue: gem.orders > 0 ? round2(gem.revenue / gem.orders) : 0,
      }
      const targetViews = Math.max(item.views + 20, round2(item.views * 1.5))
      const projectedOrders = round2((item.conversion / 100) * targetViews)
      const projectedRevenue = round2(projectedOrders * Math.max(0, item.avgOrderRevenue))
      const incrementalRevenue = Math.max(0, round2(projectedRevenue - item.revenue))

      return {
        ...item,
        targetViews,
        projectedOrders,
        projectedRevenue,
        incrementalRevenue,
      }
    })
    .sort((a, b) => b.incrementalRevenue - a.incrementalRevenue)

  const hiddenGemProjection = {
    totalIncrementalRevenue: round2(hiddenGems.reduce((sum, item) => sum + Number(item.incrementalRevenue || 0), 0)),
    projectedRevenue: round2(hiddenGems.reduce((sum, item) => sum + Number(item.projectedRevenue || 0), 0)),
  }

  const itemContribution = [...enrichedItems]
    .filter((item) => item.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map((item) => ({
      ...item,
      revenueContribution: percentage(item.revenue, advanced?.kpis?.revenue?.value || 0),
    }))

  const categoryRevenueMap = new Map()
  enrichedItems.forEach((item) => {
    const current = Number(categoryRevenueMap.get(item.categoryName) || 0)
    categoryRevenueMap.set(item.categoryName, round2(current + Number(item.revenue || 0)))
  })
  const categoryContribution = [...categoryRevenueMap.entries()]
    .map(([categoryName, revenue]) => ({
      categoryName,
      revenue,
      share: percentage(revenue, advanced?.kpis?.revenue?.value || 0),
    }))
    .sort((a, b) => b.revenue - a.revenue)

  const topThreeRevenue = itemContribution.slice(0, 3).reduce((sum, item) => sum + Number(item.revenue || 0), 0)

  const itemFunnelTable = [...enrichedItems]
    .filter((item) => item.views > 0 || item.addToCart > 0 || item.orders > 0)
    .sort((a, b) => b.views - a.views)

  const dropDistribution = [
    { name: 'View -> Cart Drop', value: Math.max(0, Number(advanced?.funnel?.views || 0) - Number(advanced?.funnel?.addToCart || 0)) },
    { name: 'Cart -> Order Drop', value: Math.max(0, Number(advanced?.funnel?.addToCart || 0) - Number(advanced?.funnel?.orders || 0)) },
  ]

  const medianPrice = computeMedian(enrichedItems.map((item) => item.price))
  const medianConversion = computeMedian(enrichedItems.map((item) => item.conversion))

  const pricingScatter = [...enrichedItems]
    .filter((item) => item.price > 0)
    .map((item) => ({
      itemId: item.itemId,
      name: item.name,
      price: item.price,
      conversion: item.conversion,
      orders: item.orders,
      revenue: item.revenue,
    }))

  const overpricedItems = pricingScatter
    .filter((item) => item.price >= medianPrice && item.conversion <= medianConversion)
    .sort((a, b) => b.price - a.price)
    .slice(0, 5)

  const underpricedItems = pricingScatter
    .filter((item) => item.price <= medianPrice && item.conversion >= medianConversion)
    .sort((a, b) => b.conversion - a.conversion)
    .slice(0, 5)

  const priceOrdersTrend = buildPriceBands(enrichedItems)

  const basket = buildBasketIntelligence(orderInsightsDaily, basketPairs)
  const basketByDate = new Map()
  ;(Array.isArray(orderInsightsDaily) ? orderInsightsDaily : []).forEach((entry) => {
    const dateKey = String(entry?.dateKey || '').trim()
    if (!dateKey) return
    basketByDate.set(dateKey, {
      items: clampNonNegative(entry?.totalItemsSold),
      orders: clampNonNegative(entry?.completedOrders),
    })
  })

  const ratingTotals = (Array.isArray(orderInsightsDaily) ? orderInsightsDaily : []).reduce(
    (acc, row) => {
      acc[1] += clampNonNegative(row?.rating1Count)
      acc[2] += clampNonNegative(row?.rating2Count)
      acc[3] += clampNonNegative(row?.rating3Count)
      acc[4] += clampNonNegative(row?.rating4Count)
      acc[5] += clampNonNegative(row?.rating5Count)
      return acc
    },
    { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  )

  const ratingPoints = [1, 2, 3, 4, 5].map((rating) => ({
    rating,
    orders: Number(ratingTotals[rating] || 0),
  }))

  const avgRatedOrders = average(ratingPoints.map((entry) => entry.orders))
  const qualityHighlights = {
    highRatingLowOrders: ratingPoints.filter((entry) => entry.rating >= 4 && entry.orders < avgRatedOrders),
    lowRatingHighOrders: ratingPoints.filter((entry) => entry.rating <= 2 && entry.orders > avgRatedOrders),
  }

  return {
    range: advanced?.range || resolvedRange.key,
    label: advanced?.label || resolvedRange.label,
    period: advanced?.period,
    kpis: advanced?.kpis || {},
    dashboardCards: {
      leakage: {
        trend: (advanced?.trends?.combined || []).map((row) => ({
          label: row.label,
          views: Number(row.views || 0),
          orders: Number(row.orders || 0),
          conversion: Number(row.conversion || 0),
        })),
      },
      hiddenGems: {
        points: hiddenGems.map((item) => ({
          name: item.name,
          views: item.views,
          conversion: item.conversion,
          revenue: item.revenue,
        })),
      },
      revenueDrivers: {
        split: itemContribution.map((item) => ({ name: item.name, value: item.revenue })),
      },
      funnel: {
        steps: [
          { name: 'Views', value: Number(advanced?.funnel?.views || 0) },
          { name: 'Add to Cart', value: Number(advanced?.funnel?.addToCart || 0) },
          { name: 'Orders', value: Number(advanced?.funnel?.orders || 0) },
        ],
      },
      pricing: {
        points: pricingScatter,
      },
      basket: {
        trend: (advanced?.trends?.combined || []).map((row) => ({
          label: row.label,
          avgItemsPerOrder: (() => {
            const bucket = basketByDate.get(String(row.date || ''))
            if (!bucket || bucket.orders <= 0) return 0
            return round2(bucket.items / bucket.orders)
          })(),
          orders: Number(row.orders || 0),
        })),
      },
      quality: {
        points: ratingPoints,
      },
    },
    drilldowns: {
      leakage: {
        itemLeakageTable: leakageTable,
        stageDropAnalysis: [
          { stage: 'View -> Cart', dropPercent: Number(100 - Number(advanced?.funnel?.viewToCartRate || 0)) },
          { stage: 'Cart -> Order', dropPercent: Number(100 - Number(advanced?.funnel?.cartToOrderRate || 0)) },
        ],
        topProblemItemsTrend,
        trendItems: topProblemItems.map((item) => item.name),
      },
      growthOpportunities: {
        hiddenGems,
        revenueImpact: hiddenGems.map((item) => ({ name: item.name, value: item.incrementalRevenue })),
        projection: hiddenGemProjection,
      },
      revenueStructure: {
        itemContribution,
        categoryContribution,
        dependency: {
          top3RevenueShare: percentage(topThreeRevenue, advanced?.kpis?.revenue?.value || 0),
        },
      },
      funnel: {
        itemFunnelTable,
        stageDropComparison: itemFunnelTable.map((item) => ({
          name: item.name,
          viewToCartDropPct: item.viewToCartDropPct,
          cartToOrderDropPct: item.cartToOrderDropPct,
        })),
        dropDistribution,
      },
      pricing: {
        scatter: pricingScatter,
        overpricedItems,
        underpricedItems,
        priceOrdersTrend,
      },
      basket: basket,
      quality: {
        ratingVsOrders: ratingPoints,
        highlights: qualityHighlights,
        ratingTrend: buildRatingTrend(orderInsightsDaily, resolvedRange.currentStartDate, resolvedRange.currentEndDate),
      },
    },
  }
}

export async function runAnalyticsIntegrityCheck({ restaurantId, days = 30 }) {
  const safeDays = Math.max(1, Math.min(Number(days || 30), 180))
  const endDate = normalizeDate(new Date())
  const startDate = normalizeDate(addDays(endDate, -(safeDays - 1)))

  const [orderRows, aggregateRows] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
          isArchived: false,
          orderStatus: 'Completed',
          completedAt: {
            $gte: startDate,
            $lte: new Date(endDate.getTime() + 86_399_999),
          },
        },
      },
      {
        $group: {
          _id: {
            dateKey: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$completedAt',
              },
            },
          },
          completedOrders: { $sum: 1 },
          revenue: { $sum: '$totalAmount' },
        },
      },
    ]),
    AnalyticsDailyMetrics.find({
      restaurantId,
      date: { $gte: startDate, $lte: endDate },
    })
      .select('dateKey completedOrders revenue')
      .lean(),
  ])

  const truthByDate = new Map(
    (Array.isArray(orderRows) ? orderRows : []).map((row) => [
      String(row?._id?.dateKey || ''),
      {
        completedOrders: clampNonNegative(row?.completedOrders),
        revenue: round2(row?.revenue),
      },
    ]),
  )
  const aggByDate = new Map(
    (Array.isArray(aggregateRows) ? aggregateRows : []).map((row) => [
      String(row?.dateKey || ''),
      {
        completedOrders: clampNonNegative(row?.completedOrders),
        revenue: round2(row?.revenue),
      },
    ]),
  )

  const keys = [...new Set([...truthByDate.keys(), ...aggByDate.keys()].filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const mismatches = keys
    .map((dateKey) => {
      const truth = truthByDate.get(dateKey) || { completedOrders: 0, revenue: 0 }
      const aggregate = aggByDate.get(dateKey) || { completedOrders: 0, revenue: 0 }

      return {
        dateKey,
        truthCompletedOrders: truth.completedOrders,
        aggregateCompletedOrders: aggregate.completedOrders,
        truthRevenue: truth.revenue,
        aggregateRevenue: aggregate.revenue,
        ordersDelta: round2(aggregate.completedOrders - truth.completedOrders),
        revenueDelta: round2(aggregate.revenue - truth.revenue),
      }
    })
    .filter((row) => row.ordersDelta !== 0 || Math.abs(row.revenueDelta) > 0.01)

  return {
    period: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      days: safeDays,
    },
    checkedDays: keys.length,
    mismatchCount: mismatches.length,
    healthy: mismatches.length === 0,
    mismatches,
  }
}
