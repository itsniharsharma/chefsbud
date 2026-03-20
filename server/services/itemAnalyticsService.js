import mongoose from 'mongoose'
import AnalyticsDailyMetrics from '../models/AnalyticsDailyMetrics.js'
import AnalyticsExposureSession from '../models/AnalyticsExposureSession.js'
import AnalyticsItemDailyMetrics from '../models/AnalyticsItemDailyMetrics.js'
import MenuItem from '../models/MenuItem.js'
import Order from '../models/Order.js'

function normalizeDate(dateLike = new Date()) {
  const date = new Date(dateLike)
  date.setHours(0, 0, 0, 0)
  return date
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

async function upsertItemDailyMetric({
  restaurantId,
  menuItemId,
  categoryId = null,
  date,
  dateKey,
  increments,
}) {
  const safeIncrements = {}
  Object.entries(increments || {}).forEach(([key, value]) => {
    const numeric = Number(value || 0)
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
    const numeric = Number(value || 0)
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

export async function trackMenuExposure({
  restaurantId,
  menuItemIds = [],
  sessionId,
  occurredAt = new Date(),
}) {
  const normalizedSessionId = String(sessionId || '').trim()
  const uniqueIds = [...new Set((Array.isArray(menuItemIds) ? menuItemIds : []).map((id) => String(id || '').trim()))]
    .filter((id) => isValidObjectId(id))

  if (!restaurantId || !normalizedSessionId || !uniqueIds.length) {
    return { tracked: 0 }
  }

  const date = normalizeDate(occurredAt)
  const dateKey = toDateKey(date)
  const expiresAt = addDays(date, 45)
  const menuMap = await loadMenuItemsMap(restaurantId, uniqueIds)

  let tracked = 0
  for (const menuItemId of uniqueIds) {
    const menuItem = menuMap.get(menuItemId)
    if (!menuItem) continue

    const result = await AnalyticsExposureSession.updateOne(
      {
        restaurantId,
        menuItemId,
        sessionId: normalizedSessionId,
        dateKey,
      },
      {
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
      { upsert: true },
    )

    const inserted = Number(result?.upsertedCount || 0) > 0
    if (!inserted) {
      await AnalyticsExposureSession.updateOne(
        {
          restaurantId,
          menuItemId,
          sessionId: normalizedSessionId,
          dateKey,
        },
        { $set: { lastSeenAt: occurredAt, expiresAt } },
      )
      continue
    }

    tracked += 1
    await upsertItemDailyMetric({
      restaurantId,
      menuItemId,
      categoryId: menuItem.categoryId || null,
      date,
      dateKey,
      increments: { views: 1 },
    })
  }

  if (tracked > 0) {
    await upsertDailyMetric({
      restaurantId,
      date,
      dateKey,
      increments: { views: tracked },
    })
  }

  return { tracked }
}

export async function trackAddToCart({
  restaurantId,
  menuItemId,
  quantity = 1,
  occurredAt = new Date(),
}) {
  const normalizedMenuItemId = String(menuItemId || '').trim()
  if (!restaurantId || !isValidObjectId(normalizedMenuItemId)) {
    return { tracked: false }
  }

  const menuItem = await MenuItem.findOne({
    _id: normalizedMenuItemId,
    restaurantId,
  })
    .select('_id categoryId')
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

export async function applyCompletedOrderAnalytics(order, multiplier = 1) {
  if (!order?.restaurantId || !Array.isArray(order?.items) || !order.items.length) {
    return
  }

  const safeMultiplier = Number(multiplier || 1)
  if (!safeMultiplier) return

  const completedAt = order.completedAt || order.updatedAt || order.createdAt || new Date()
  const date = normalizeDate(completedAt)
  const dateKey = toDateKey(date)
  const itemBreakdown = buildPurchaseBreakdown(order)
  const menuMap = await loadMenuItemsMap(
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
  ])
}

export async function syncCompletedOrderAnalytics(orderId) {
  const order = await Order.findById(orderId).lean()
  if (!order) return null

  if (order.orderStatus !== 'Completed') {
    return order
  }

  if (order.analyticsTrackedAt) {
    return order
  }

  await applyCompletedOrderAnalytics(order, 1)
  const trackedAt = new Date()

  await Order.updateOne(
    { _id: order._id, analyticsTrackedAt: null },
    { $set: { analyticsTrackedAt: trackedAt } },
  )

  return { ...order, analyticsTrackedAt: trackedAt }
}

export async function revertCompletedOrderAnalytics(order) {
  if (!order?.analyticsTrackedAt) return

  await applyCompletedOrderAnalytics(order, -1)
}

export async function backfillCompletedOrderAnalytics({ restaurantId, batchSize = 200 } = {}) {
  if (!restaurantId) return 0

  const candidates = await Order.find({
    restaurantId,
    orderStatus: 'Completed',
    analyticsTrackedAt: null,
  })
    .sort({ completedAt: 1, createdAt: 1 })
    .limit(Math.max(1, Math.min(Number(batchSize || 200), 1000)))
    .lean()

  if (!candidates.length) return 0

  for (const order of candidates) {
    await applyCompletedOrderAnalytics(order, 1)
  }

  await Order.updateMany(
    {
      _id: { $in: candidates.map((order) => order._id) },
      analyticsTrackedAt: null,
    },
    { $set: { analyticsTrackedAt: new Date() } },
  )

  return candidates.length
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

export async function buildAnalyticsOverview({ restaurantId, rangeDays = 14 }) {
  const safeRangeDays = Math.max(1, Math.min(Number(rangeDays || 14), 90))
  const endDate = normalizeDate(new Date())
  const startDate = normalizeDate(addDays(endDate, -(safeRangeDays - 1)))

  const [dailyMetrics, itemRollups] = await Promise.all([
    AnalyticsDailyMetrics.find({
      restaurantId,
      date: { $gte: startDate, $lte: endDate },
    })
      .sort({ date: 1 })
      .select('date dateKey views addToCart completedOrders revenue')
      .lean(),
    AnalyticsItemDailyMetrics.aggregate([
      {
        $match: {
          restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
          date: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: '$menuItemId',
          views: { $sum: '$views' },
          addToCart: { $sum: '$addToCart' },
          orders: { $sum: '$orders' },
          quantitySold: { $sum: '$quantitySold' },
          revenue: { $sum: '$revenue' },
        },
      },
      {
        $lookup: {
          from: 'menuitems',
          localField: '_id',
          foreignField: '_id',
          as: 'menuItem',
        },
      },
      {
        $project: {
          _id: 0,
          menuItemId: '$_id',
          name: { $ifNull: [{ $arrayElemAt: ['$menuItem.name', 0] }, 'Deleted item'] },
          views: 1,
          addToCart: 1,
          orders: 1,
          quantitySold: 1,
          revenue: 1,
        },
      },
    ]),
  ])

  const dailyByKey = new Map(
    dailyMetrics.map((entry) => [
      entry.dateKey,
      {
        views: clampNonNegative(entry.views),
        addToCart: clampNonNegative(entry.addToCart),
        orders: clampNonNegative(entry.completedOrders),
        revenue: round2(entry.revenue),
      },
    ]),
  )

  const trends = buildTrendBuckets(startDate, endDate).map((bucket) => ({
    day: bucket.label,
    views: clampNonNegative(dailyByKey.get(bucket.dateKey)?.views),
    addToCart: clampNonNegative(dailyByKey.get(bucket.dateKey)?.addToCart),
    orders: clampNonNegative(dailyByKey.get(bucket.dateKey)?.orders),
    revenue: round2(dailyByKey.get(bucket.dateKey)?.revenue),
  }))

  const totals = trends.reduce(
    (acc, entry) => ({
      views: acc.views + entry.views,
      addToCart: acc.addToCart + entry.addToCart,
      orders: acc.orders + entry.orders,
      revenue: round2(acc.revenue + entry.revenue),
    }),
    { views: 0, addToCart: 0, orders: 0, revenue: 0 },
  )

  const topItems = (Array.isArray(itemRollups) ? itemRollups : [])
    .map((item) => ({
      ...item,
      menuItemId: String(item.menuItemId),
      revenue: round2(item.revenue),
      viewToCartRate: percentage(item.addToCart, item.views),
      cartToOrderRate: percentage(item.orders, item.addToCart),
      viewToOrderRate: percentage(item.orders, item.views),
    }))

  const byViews = [...topItems].sort((a, b) => b.views - a.views || b.orders - a.orders).slice(0, 5)
  const byOrders = [...topItems].sort((a, b) => b.orders - a.orders || b.revenue - a.revenue).slice(0, 5)
  const byRevenue = [...topItems].sort((a, b) => b.revenue - a.revenue || b.orders - a.orders).slice(0, 5)
  const opportunities = [...topItems]
    .filter((item) => item.views > 0)
    .sort((a, b) => {
      const gapA = a.views - a.orders
      const gapB = b.views - b.orders
      if (gapA !== gapB) return gapB - gapA
      return b.views - a.views
    })
    .slice(0, 5)

  return {
    rangeDays: safeRangeDays,
    cards: {
      totalViews: totals.views,
      totalAddToCart: totals.addToCart,
      totalOrders: totals.orders,
      totalRevenue: totals.revenue,
      viewToCartRate: percentage(totals.addToCart, totals.views),
      cartToOrderRate: percentage(totals.orders, totals.addToCart),
      viewToOrderRate: percentage(totals.orders, totals.views),
    },
    trends,
    topItems: {
      byViews,
      byOrders,
      byRevenue,
      opportunities,
    },
    itemFunnel: [...topItems]
      .sort((a, b) => b.revenue - a.revenue || b.orders - a.orders)
      .slice(0, 12),
  }
}
