import Restaurant from '../models/Restaurant.js'
import Table from '../models/Table.js'
import { ensureOrderMetricsRange } from '../services/orderMetricsService.js'

async function ensureOwnerRestaurant(ownerId, restaurantId) {
  if (!restaurantId) return null
  return Restaurant.findOne({ _id: restaurantId, ownerId }).lean()
}

function buildDateKeys(startDate, endDate) {
  const cursor = new Date(startDate)
  cursor.setHours(0, 0, 0, 0)

  const last = new Date(endDate)
  last.setHours(0, 0, 0, 0)

  const keys = []
  while (cursor <= last) {
    keys.push(cursor.toISOString().slice(0, 10))
    cursor.setDate(cursor.getDate() + 1)
  }

  return keys
}

function formatShortDate(isoDate) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export async function getDashboard(req, res, next) {
  try {
    const ownerRestaurant = await ensureOwnerRestaurant(req.user._id, req.params.restaurantId)
    if (!ownerRestaurant) return res.status(404).json({ message: 'Restaurant not found' })

    const now = new Date()
    const startDay = new Date(now)
    startDay.setHours(0, 0, 0, 0)
    const trendStart = new Date(startDay)
    trendStart.setDate(trendStart.getDate() - 6)

    const [metricsDocs, activeTables] = await Promise.all([
      ensureOrderMetricsRange({
        restaurantId: ownerRestaurant._id,
        startDate: trendStart,
        endDate: startDay,
      }),
      Table.countDocuments({ restaurantId: ownerRestaurant._id, active: true }),
    ])

    const metricsByDateKey = new Map(
      metricsDocs.map((entry) => [
        entry.dateKey,
        {
          totalRevenue: Number(entry.totalRevenue || 0),
          totalOrders: Number(entry.totalOrders || 0),
          averageOrderValue: Number(entry.averageOrderValue || 0),
        },
      ]),
    )
    const todayKey = startDay.toISOString().slice(0, 10)
    const todayMetrics = metricsByDateKey.get(todayKey) || {
      totalRevenue: 0,
      totalOrders: 0,
      averageOrderValue: 0,
    }
    const revenueTrend = buildDateKeys(trendStart, startDay).map((isoDate) => ({
      day: formatShortDate(isoDate),
      revenue: Number(metricsByDateKey.get(isoDate)?.totalRevenue || 0),
    }))

    return res.json({
      cards: {
        todayRevenue: todayMetrics.totalRevenue,
        totalOrdersToday: todayMetrics.totalOrders,
        averageOrderValue: todayMetrics.averageOrderValue,
        activeTables,
      },
      recentOrders: [],
      topSellingItems: [],
      revenueTrend,
    })
  } catch (error) {
    next(error)
  }
}

/* Analytics aggregation endpoint — disabled until AWS data pipeline is ready
export async function getAnalytics(req, res, next) {
  try {
    const ownerRestaurant = await ensureOwnerRestaurant(req.user._id, req.params.restaurantId)
    if (!ownerRestaurant) return res.status(404).json({ message: 'Restaurant not found' })

    return res.status(503).json({
      developing: true,
      message: 'Analytics section is currently under development. Data pipeline integration is in progress.',
      source: 'pending-aws-pipeline',
      restaurantId: String(ownerRestaurant._id),
    })
  } catch (error) {
    next(error)
  }
}
*/
