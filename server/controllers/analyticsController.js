import Order from '../models/Order.js'
import Restaurant from '../models/Restaurant.js'
import Table from '../models/Table.js'

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

    const [todayStats, trend, activeTables] = await Promise.all([
      Order.aggregate([
        { $match: { restaurantId: ownerRestaurant._id, createdAt: { $gte: startDay } } },
        {
          $group: {
            _id: null,
            todayRevenue: { $sum: '$totalAmount' },
            totalOrdersToday: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate([
        {
          $match: {
            restaurantId: ownerRestaurant._id,
            createdAt: { $gte: trendStart },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' },
            },
            revenue: { $sum: '$totalAmount' },
            date: { $first: '$createdAt' },
          },
        },
        { $sort: { date: -1 } },
        { $sort: { date: 1 } },
      ]),
      Table.countDocuments({ restaurantId: ownerRestaurant._id, active: true }),
    ])

    const stats = todayStats[0] || { todayRevenue: 0, totalOrdersToday: 0 }
    const avgOrderValue = stats.totalOrdersToday ? stats.todayRevenue / stats.totalOrdersToday : 0
    const trendRevenueByDate = new Map(
      trend.map((entry) => [new Date(entry.date).toISOString().slice(0, 10), entry.revenue]),
    )
    const revenueTrend = buildDateKeys(trendStart, startDay).map((isoDate) => ({
      day: formatShortDate(isoDate),
      revenue: Number(trendRevenueByDate.get(isoDate) || 0),
    }))

    return res.json({
      cards: {
        todayRevenue: stats.todayRevenue,
        totalOrdersToday: stats.totalOrdersToday,
        averageOrderValue: avgOrderValue,
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
