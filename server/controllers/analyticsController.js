import Order from '../models/Order.js'
import Restaurant from '../models/Restaurant.js'
import Table from '../models/Table.js'
import MenuItem from '../models/MenuItem.js'

async function ensureOwnerRestaurant(ownerId, restaurantId) {
  if (!restaurantId) return null
  return Restaurant.findOne({ _id: restaurantId, ownerId }).lean()
}

function safePeriod(period) {
  return {
    revenue: period?.revenue || 0,
    orders: period?.orders || 0,
    paidOrders: period?.paidOrders || 0,
    unpaidOrders: period?.unpaidOrders || 0,
    avgOrderValue: period?.avgOrderValue || 0,
  }
}

function calcGrowth(current, previous) {
  if (!previous) {
    return current > 0 ? 100 : 0
  }
  return ((current - previous) / previous) * 100
}

function safePct(part, whole) {
  if (!whole) return 0
  return (part / whole) * 100
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

    const [todayStats, recentOrders, topItems, trend, activeTables] = await Promise.all([
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
      Order.find({ restaurantId: ownerRestaurant._id })
        .sort({ createdAt: -1 })
        .limit(8)
        .select('_id tableNumber orderStatus totalAmount createdAt')
        .lean(),
      Order.aggregate([
        { $match: { restaurantId: ownerRestaurant._id } },
        { $unwind: '$items' },
        { $group: { _id: '$items.name', qty: { $sum: '$items.quantity' } } },
        { $sort: { qty: -1 } },
        { $limit: 5 },
      ]),
      Order.aggregate([
        { $match: { restaurantId: ownerRestaurant._id } },
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
        { $limit: 7 },
        { $sort: { date: 1 } },
      ]),
      Table.countDocuments({ restaurantId: ownerRestaurant._id, active: true }),
    ])

    const stats = todayStats[0] || { todayRevenue: 0, totalOrdersToday: 0 }
    const avgOrderValue = stats.totalOrdersToday ? stats.todayRevenue / stats.totalOrdersToday : 0

    return res.json({
      cards: {
        todayRevenue: stats.todayRevenue,
        totalOrdersToday: stats.totalOrdersToday,
        averageOrderValue: avgOrderValue,
        activeTables,
      },
      recentOrders,
      topSellingItems: topItems.map((item) => item._id),
      revenueTrend: trend.map((entry) => ({
        day: new Date(entry.date).toLocaleDateString('en-US', { weekday: 'short' }),
        revenue: entry.revenue,
      })),
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
