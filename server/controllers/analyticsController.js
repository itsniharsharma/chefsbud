import MenuItem from '../models/MenuItem.js'
import Restaurant from '../models/Restaurant.js'
import Table from '../models/Table.js'
import {
  buildAnalyticsOverview,
  scheduleCompletedOrderAnalyticsBackfill,
  trackAddToCart,
  trackMenuExposure,
} from '../services/itemAnalyticsService.js'
import { ensureOrderMetricsRange } from '../services/orderMetricsService.js'

async function ensureOwnerRestaurant(ownerId, restaurantId) {
  if (!restaurantId) return null
  return Restaurant.findOne({ _id: restaurantId, ownerId }).select('_id').lean()
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

export async function getAnalytics(req, res, next) {
  try {
    const ownerRestaurant = await ensureOwnerRestaurant(req.user._id, req.params.restaurantId)
    if (!ownerRestaurant) return res.status(404).json({ message: 'Restaurant not found' })

    void scheduleCompletedOrderAnalyticsBackfill({ restaurantId: ownerRestaurant._id })
    const analytics = await buildAnalyticsOverview({
      restaurantId: ownerRestaurant._id,
      rangeDays: req.query.rangeDays,
    })

    return res.json({
      restaurantId: String(ownerRestaurant._id),
      ...analytics,
    })
  } catch (error) {
    next(error)
  }
}

export async function trackPublicMenuExposure(req, res, next) {
  try {
    const restaurantSlug = String(req.body?.restaurantSlug || '').trim()
    const sessionId = String(req.body?.sessionId || '').trim()
    const rawMenuItemIds = Array.isArray(req.body?.menuItemIds) ? req.body.menuItemIds : []
    const menuItemIds = [...new Set(rawMenuItemIds.map((id) => String(id || '').trim()).filter(Boolean))]

    if (!restaurantSlug || !sessionId || !menuItemIds.length) {
      return res.status(400).json({ message: 'restaurantSlug, sessionId, and menuItemIds are required' })
    }

    const restaurant = await Restaurant.findOne({ slug: restaurantSlug }).select('_id').lean()
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const validItemIds = await MenuItem.find({
      restaurantId: restaurant._id,
      _id: { $in: menuItemIds },
      available: true,
    })
      .select('_id categoryId name')
      .lean()

    const result = await trackMenuExposure({
      restaurantId: restaurant._id,
      sessionId,
      menuItemIds: validItemIds.map((item) => item._id),
      resolvedMenuItems: validItemIds,
    })

    return res.status(202).json(result)
  } catch (error) {
    next(error)
  }
}

export async function trackPublicAddToCart(req, res, next) {
  try {
    const restaurantSlug = String(req.body?.restaurantSlug || '').trim()
    const menuItemId = String(req.body?.menuItemId || '').trim()
    const quantity = Number(req.body?.quantity || 1)

    if (!restaurantSlug || !menuItemId) {
      return res.status(400).json({ message: 'restaurantSlug and menuItemId are required' })
    }

    const restaurant = await Restaurant.findOne({ slug: restaurantSlug }).select('_id').lean()
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const result = await trackAddToCart({
      restaurantId: restaurant._id,
      menuItemId,
      quantity,
    })

    return res.status(202).json(result)
  } catch (error) {
    next(error)
  }
}
