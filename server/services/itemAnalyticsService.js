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
        views: { $sum: '$views' },
        orders: { $sum: '$orders' },
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
        orders: 1,
        revenue: 1,
      },
    },
  ])
}

async function aggregateHourlyOrders({ restaurantId, startDate, endDate }) {
  return Order.aggregate([
    {
      $match: {
        restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
        orderStatus: 'Completed',
        completedAt: {
          $gte: startDate,
          $lt: addDays(endDate, 1),
        },
      },
    },
    {
      $group: {
        _id: { hour: { $hour: '$completedAt' } },
        orders: { $sum: 1 },
      },
    },
    { $sort: { '_id.hour': 1 } },
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
  return Array.from({ length: 24 }, (_, hour) => {
    const match = (Array.isArray(hourlyRows) ? hourlyRows : []).find((entry) => Number(entry?._id?.hour) === hour)
    return {
      hour: normalizeHourLabel(hour),
      hour24: hour,
      orders: clampNonNegative(match?.orders),
    }
  })
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
