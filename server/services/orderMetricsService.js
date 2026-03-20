import Order from '../models/Order.js'
import OrderDailyMetrics from '../models/OrderDailyMetrics.js'

function normalizeDate(dateLike = new Date()) {
  const date = new Date(dateLike)
  date.setHours(0, 0, 0, 0)
  return date
}

function toDateKey(dateLike) {
  return normalizeDate(dateLike).toISOString().slice(0, 10)
}

function buildDayRange(dateLike) {
  const start = normalizeDate(dateLike)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

async function aggregateDayMetrics(restaurantId, dateLike) {
  const { start, end } = buildDayRange(dateLike)

  const [result] = await Order.aggregate([
    {
      $match: {
        restaurantId,
        createdAt: { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$totalAmount' },
        totalOrders: { $sum: 1 },
      },
    },
  ])

  const totalRevenue = Number(result?.totalRevenue || 0)
  const totalOrders = Number(result?.totalOrders || 0)
  const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

  return {
    date: start,
    dateKey: toDateKey(start),
    totalRevenue,
    totalOrders,
    averageOrderValue,
  }
}

export async function rebuildOrderMetricsForDate({ restaurantId, date }) {
  if (!restaurantId || !date) return null

  const metrics = await aggregateDayMetrics(restaurantId, date)

  if (metrics.totalOrders === 0 && metrics.totalRevenue === 0) {
    await OrderDailyMetrics.deleteOne({
      restaurantId,
      dateKey: metrics.dateKey,
    })
    return metrics
  }

  await OrderDailyMetrics.updateOne(
    {
      restaurantId,
      dateKey: metrics.dateKey,
    },
    {
      $set: metrics,
      $setOnInsert: {
        restaurantId,
      },
    },
    { upsert: true },
  )

  return metrics
}

export async function ensureOrderMetricsRange({ restaurantId, startDate, endDate }) {
  const start = normalizeDate(startDate)
  const end = normalizeDate(endDate)
  const expectedKeys = []
  const cursor = new Date(start)

  while (cursor <= end) {
    expectedKeys.push(toDateKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  const existing = await OrderDailyMetrics.find({
    restaurantId,
    dateKey: { $in: expectedKeys },
  })
    .select('dateKey')
    .lean()

  const existingKeys = new Set(existing.map((entry) => entry.dateKey))
  const missingKeys = expectedKeys.filter((dateKey) => !existingKeys.has(dateKey))

  await Promise.all(
    missingKeys.map((dateKey) =>
      rebuildOrderMetricsForDate({
        restaurantId,
        date: new Date(`${dateKey}T00:00:00.000Z`),
      }),
    ),
  )

  return OrderDailyMetrics.find({
    restaurantId,
    dateKey: { $in: expectedKeys },
  })
    .sort({ date: 1 })
    .select('dateKey date totalRevenue totalOrders averageOrderValue')
    .lean()
}

export function buildDateKey(dateLike) {
  return toDateKey(dateLike)
}
