import MenuItem from '../models/MenuItem.js'
import Table from '../models/Table.js'
import InventoryItem from '../models/InventoryItem.js'
import InventoryPurchase from '../models/InventoryPurchase.js'
import DashboardNotification from '../models/DashboardNotification.js'
import {
  backfillCompletedOrderAnalytics,
  buildDecisionAnalytics,
  buildAdvancedAnalytics,
  runAnalyticsIntegrityCheck,
  scheduleCompletedOrderAnalyticsBackfill,
  trackAddToCart,
  trackMenuExposure,
} from '../services/itemAnalyticsService.js'
import { ensureOrderMetricsRange } from '../services/orderMetricsService.js'
import { resolveRequestRestaurant } from '../utils/requestRestaurant.js'
import { resolveRestaurantIdentityBySlug } from '../services/orderDraftCache.js'

const ANALYTICS_INLINE_BACKFILL_BATCH_SIZE = Math.max(10, Math.min(Number(process.env.ANALYTICS_INLINE_BACKFILL_BATCH_SIZE || 40), 200))
const ANALYTICS_INLINE_BACKFILL_MIN_INTERVAL_MS = Math.max(10_000, Number(process.env.ANALYTICS_INLINE_BACKFILL_MIN_INTERVAL_MS || 60_000))
const ANALYTICS_WARM_STATE_RETENTION_MS = Math.max(3_600_000, Number(process.env.ANALYTICS_WARM_STATE_RETENTION_MS || 24 * 60 * 60 * 1000))
const ANALYTICS_WARM_STATE_MAX_ENTRIES = Math.max(100, Number(process.env.ANALYTICS_WARM_STATE_MAX_ENTRIES || 10_000))
const LOW_STOCK_NOTIFICATIONS_ENABLED = String(process.env.LOW_STOCK_NOTIFICATIONS_ENABLED || 'true').trim().toLowerCase() !== 'false'
const DEFAULT_LOW_STOCK_THRESHOLD_PERCENT = 10
const LOW_STOCK_NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000
const MAX_LOW_STOCK_NOTIFICATIONS = 50
const LOW_STOCK_CACHE_TTL_MS = Math.max(30_000, Number(process.env.LOW_STOCK_CACHE_TTL_MS || 120_000))
const LOW_STOCK_CACHE_MAX_ENTRIES = Math.max(100, Number(process.env.LOW_STOCK_CACHE_MAX_ENTRIES || 2000))
const analyticsWarmStateByRestaurant = new Map()
const lowStockNotificationsCache = new Map()
const analyticsResponseCache = new Map()
const ANALYTICS_RESPONSE_CACHE_TTL_MS = Math.max(10_000, Number(process.env.ANALYTICS_RESPONSE_CACHE_TTL_MS || 60_000))

function analyticsCacheKey(type, restaurantId, range) {
  return `${type}:${String(restaurantId || '')}:${String(range || '14d')}`
}

function readAnalyticsCache(type, restaurantId, range) {
  const key = analyticsCacheKey(type, restaurantId, range)
  const entry = analyticsResponseCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    analyticsResponseCache.delete(key)
    return null
  }
  return entry.value
}

function writeAnalyticsCache(type, restaurantId, range, value) {
  if (analyticsResponseCache.size > 1000) {
    const oldestKey = analyticsResponseCache.keys().next().value
    if (oldestKey) analyticsResponseCache.delete(oldestKey)
  }
  analyticsResponseCache.set(analyticsCacheKey(type, restaurantId, range), {
    value,
    expiresAt: Date.now() + ANALYTICS_RESPONSE_CACHE_TTL_MS,
  })
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function round6(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1_000_000) / 1_000_000
}

function normalizePurchaseUnitFactor(unit = '') {
  const normalized = String(unit || '').trim()
  if (normalized === 'Kg') return { baseUnit: 'g', factor: 1000 }
  if (normalized === 'Gram' || normalized === 'g') return { baseUnit: 'g', factor: 1 }
  if (normalized === 'Litre') return { baseUnit: 'ml', factor: 1000 }
  if (normalized === 'Ml' || normalized === 'ml') return { baseUnit: 'ml', factor: 1 }
  return { baseUnit: 'unit', factor: 1 }
}

function resolveLowStockThresholdPercent(restaurant) {
  const configured = Number(restaurant?.inventoryAlertConfig?.lowStockThresholdPercent)
  if (!Number.isFinite(configured)) return DEFAULT_LOW_STOCK_THRESHOLD_PERCENT
  const normalized = Math.floor(configured)
  if (normalized < 1 || normalized > 100) return DEFAULT_LOW_STOCK_THRESHOLD_PERCENT
  return normalized
}

function buildLowStockCacheKey(restaurantId, thresholdPercent) {
  return `${String(restaurantId || '')}:${Number(thresholdPercent || DEFAULT_LOW_STOCK_THRESHOLD_PERCENT)}`
}

function readLowStockCache(restaurantId, thresholdPercent) {
  const key = buildLowStockCacheKey(restaurantId, thresholdPercent)
  if (!key) return null
  const entry = lowStockNotificationsCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    lowStockNotificationsCache.delete(key)
    return null
  }
  return entry.value
}

function writeLowStockCache(restaurantId, thresholdPercent, value) {
  const key = buildLowStockCacheKey(restaurantId, thresholdPercent)
  if (!key) return

  if (lowStockNotificationsCache.size >= LOW_STOCK_CACHE_MAX_ENTRIES) {
    const oldestKey = lowStockNotificationsCache.keys().next().value
    if (oldestKey) {
      lowStockNotificationsCache.delete(oldestKey)
    }
  }

  lowStockNotificationsCache.set(key, {
    value,
    expiresAt: Date.now() + LOW_STOCK_CACHE_TTL_MS,
  })
}

async function buildLowStockDashboardNotifications(restaurantId, thresholdPercent = DEFAULT_LOW_STOCK_THRESHOLD_PERCENT) {
  const cached = readLowStockCache(restaurantId, thresholdPercent)
  if (cached) {
    return cached
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + LOW_STOCK_NOTIFICATION_TTL_MS)

  const [inventoryItems, purchaseAggregates] = await Promise.all([
    InventoryItem.find({ restaurantId, isActive: true })
      .select('_id name currentStock currentStockUnit')
      .lean(),
    InventoryPurchase.aggregate([
      { $match: { restaurantId } },
      { $unwind: '$items' },
      {
        $project: {
          itemId: '$items.itemId',
          quantity: { $toDouble: '$items.quantity' },
          unit: '$items.unit',
        },
      },
      {
        $group: {
          _id: {
            itemId: '$itemId',
            unit: '$unit',
          },
          quantity: { $sum: '$quantity' },
        },
      },
    ]),
  ])

  const purchasedByItem = new Map()
  for (const row of purchaseAggregates) {
    const itemId = String(row?._id?.itemId || '')
    if (!itemId) continue

    const { baseUnit, factor } = normalizePurchaseUnitFactor(row?._id?.unit)
    const quantity = Number(row?.quantity || 0)
    if (!Number.isFinite(quantity) || quantity <= 0) continue

    const normalizedQuantity = quantity * factor
    if (!purchasedByItem.has(itemId)) {
      purchasedByItem.set(itemId, { g: 0, ml: 0, unit: 0 })
    }

    const bucket = purchasedByItem.get(itemId)
    bucket[baseUnit] += normalizedQuantity
  }

  const notifications = []
  for (const item of inventoryItems) {
    const itemId = String(item?._id || '')
    const unit = String(item?.currentStockUnit || 'unit')
    const purchased = Number(purchasedByItem.get(itemId)?.[unit] || 0)
    if (!Number.isFinite(purchased) || purchased <= 0) continue

    const currentStock = Math.max(0, Number(item?.currentStock || 0))
    const currentPercent = purchased > 0 ? (currentStock / purchased) * 100 : 0
    if (!Number.isFinite(currentPercent) || currentPercent >= thresholdPercent) continue

    const roundedPercent = round2(currentPercent)
    notifications.push({
      restaurantId,
      type: 'LOW_STOCK_THRESHOLD',
      itemId: item._id,
      itemName: String(item?.name || 'Item'),
      thresholdPercent,
      currentPercent: roundedPercent,
      currentStock: round6(currentStock),
      purchasedQuantity: round6(purchased),
      unit,
      message: `${String(item?.name || 'Item')} is below ${thresholdPercent}% (${roundedPercent}%). Kindly refill stock.`,
      expiresAt,
    })
  }

  if (notifications.length) {
    const operations = notifications.map((notification) => ({
      updateOne: {
        filter: {
          restaurantId,
          type: 'LOW_STOCK_THRESHOLD',
          itemId: notification.itemId,
        },
        update: {
          $set: notification,
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    }))

    await DashboardNotification.bulkWrite(operations, { ordered: false })

    const lowItemIds = notifications.map((notification) => notification.itemId)
    await DashboardNotification.deleteMany({
      restaurantId,
      type: 'LOW_STOCK_THRESHOLD',
      itemId: { $nin: lowItemIds },
    })
  } else {
    await DashboardNotification.deleteMany({
      restaurantId,
      type: 'LOW_STOCK_THRESHOLD',
    })
  }

  const active = await DashboardNotification.find({
    restaurantId,
    type: 'LOW_STOCK_THRESHOLD',
    expiresAt: { $gt: now },
  })
    .sort({ currentPercent: 1, updatedAt: -1 })
    .limit(MAX_LOW_STOCK_NOTIFICATIONS)
    .select('itemId itemName thresholdPercent currentPercent currentStock purchasedQuantity unit message expiresAt updatedAt')
    .lean()

  writeLowStockCache(restaurantId, thresholdPercent, active)
  return active
}

function cleanupAnalyticsWarmState(now = Date.now()) {
  for (const [restaurantKey, lastWarmAt] of analyticsWarmStateByRestaurant.entries()) {
    if (Number(lastWarmAt || 0) + ANALYTICS_WARM_STATE_RETENTION_MS < now) {
      analyticsWarmStateByRestaurant.delete(restaurantKey)
    }
  }

  while (analyticsWarmStateByRestaurant.size > ANALYTICS_WARM_STATE_MAX_ENTRIES) {
    const oldestKey = analyticsWarmStateByRestaurant.keys().next().value
    if (!oldestKey) break
    analyticsWarmStateByRestaurant.delete(oldestKey)
  }
}

async function warmAnalyticsState(restaurantId) {
  const restaurantKey = String(restaurantId || '')
  const now = Date.now()
  cleanupAnalyticsWarmState(now)
  const lastWarmAt = Number(analyticsWarmStateByRestaurant.get(restaurantKey) || 0)

  // Keep request freshness while capping synchronous work on hot endpoints.
  if (now - lastWarmAt >= ANALYTICS_INLINE_BACKFILL_MIN_INTERVAL_MS) {
    await backfillCompletedOrderAnalytics({
      restaurantId,
      batchSize: ANALYTICS_INLINE_BACKFILL_BATCH_SIZE,
    })
    analyticsWarmStateByRestaurant.set(restaurantKey, now)
  }

  void scheduleCompletedOrderAnalyticsBackfill({ restaurantId })
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
    const ownerRestaurant = await resolveRequestRestaurant(req, req.params.restaurantId)
    if (!ownerRestaurant) return res.status(404).json({ message: 'Restaurant not found' })
    const lowStockThresholdPercent = resolveLowStockThresholdPercent(ownerRestaurant)

    const now = new Date()
    const startDay = new Date(now)
    startDay.setHours(0, 0, 0, 0)
    const trendStart = new Date(startDay)
    trendStart.setDate(trendStart.getDate() - 6)

    const [metricsDocs, activeTables, lowStockNotifications] = await Promise.all([
      ensureOrderMetricsRange({
        restaurantId: ownerRestaurant._id,
        startDate: trendStart,
        endDate: startDay,
      }),
      Table.countDocuments({ restaurantId: ownerRestaurant._id, active: true }),
      LOW_STOCK_NOTIFICATIONS_ENABLED
        ? buildLowStockDashboardNotifications(ownerRestaurant._id, lowStockThresholdPercent)
        : Promise.resolve([]),
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
      notifications: {
        lowStock: lowStockNotifications,
        ttlHours: 24,
        enabled: LOW_STOCK_NOTIFICATIONS_ENABLED,
        thresholdPercent: lowStockThresholdPercent,
      },
    })
  } catch (error) {
    next(error)
  }
}

export async function getAnalytics(req, res, next) {
  try {
    const ownerRestaurant = await resolveRequestRestaurant(req, req.params.restaurantId)
    if (!ownerRestaurant) return res.status(404).json({ message: 'Restaurant not found' })

    const range = req.query.range || req.query.rangeDays
    const cached = readAnalyticsCache('advanced', ownerRestaurant._id, range)
    if (cached) {
      void warmAnalyticsState(ownerRestaurant._id)
      return res.json(cached)
    }

    void warmAnalyticsState(ownerRestaurant._id)
    const analytics = await buildAdvancedAnalytics({
      restaurantId: ownerRestaurant._id,
      range,
    })

    const responsePayload = {
      restaurantId: String(ownerRestaurant._id),
      ...analytics,
    }
    writeAnalyticsCache('advanced', ownerRestaurant._id, range, responsePayload)

    return res.json(responsePayload)
  } catch (error) {
    next(error)
  }
}

export async function getDecisionAnalytics(req, res, next) {
  try {
    const ownerRestaurant = await resolveRequestRestaurant(req, req.params.restaurantId)
    if (!ownerRestaurant) return res.status(404).json({ message: 'Restaurant not found' })

    const range = req.query.range || req.query.rangeDays
    const cached = readAnalyticsCache('decision', ownerRestaurant._id, range)
    if (cached) {
      void warmAnalyticsState(ownerRestaurant._id)
      return res.json(cached)
    }

    void warmAnalyticsState(ownerRestaurant._id)
    const analytics = await buildDecisionAnalytics({
      restaurantId: ownerRestaurant._id,
      range,
    })

    const responsePayload = {
      restaurantId: String(ownerRestaurant._id),
      ...analytics,
    }
    writeAnalyticsCache('decision', ownerRestaurant._id, range, responsePayload)

    return res.json(responsePayload)
  } catch (error) {
    next(error)
  }
}

export async function getAnalyticsIntegrity(req, res, next) {
  try {
    const ownerRestaurant = await resolveRequestRestaurant(req, req.params.restaurantId)
    if (!ownerRestaurant) return res.status(404).json({ message: 'Restaurant not found' })

    const days = Number(req.query.days || 30)
    const report = await runAnalyticsIntegrityCheck({
      restaurantId: ownerRestaurant._id,
      days,
    })

    return res.json({
      restaurantId: String(ownerRestaurant._id),
      ...report,
    })
  } catch (error) {
    next(error)
  }
}

export async function trackPublicMenuExposure(req, res, next) {
  try {
    const restaurantSlug = String(req.body?.restaurantSlug || '').trim()
    const sessionId = String(req.body?.sessionId || '').trim()
    const eventId = String(req.body?.eventId || '').trim()
    const rawMenuItemIds = Array.isArray(req.body?.menuItemIds) ? req.body.menuItemIds : []
    const menuItemIds = [...new Set(rawMenuItemIds.map((id) => String(id || '').trim()).filter(Boolean))]

    if (!restaurantSlug || !sessionId || !menuItemIds.length) {
      return res.status(400).json({ message: 'restaurantSlug, sessionId, and menuItemIds are required' })
    }

    const restaurantLookup = await resolveRestaurantIdentityBySlug(restaurantSlug)
    if (!restaurantLookup?.restaurantId) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const validItemIds = await MenuItem.find({
      restaurantId: restaurantLookup.restaurantId,
      _id: { $in: menuItemIds },
      available: true,
    })
      .select('_id categoryId name')
      .lean()

    if (!validItemIds.length) {
      return res.status(202).json({ tracked: 0 })
    }

    const result = await trackMenuExposure({
      restaurantId: restaurantLookup.restaurantId,
      sessionId,
      eventId,
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
    const eventId = String(req.body?.eventId || '').trim()
    const menuItemId = String(req.body?.menuItemId || '').trim()
    const quantity = Number(req.body?.quantity || 1)

    if (!restaurantSlug || !menuItemId) {
      return res.status(400).json({ message: 'restaurantSlug and menuItemId are required' })
    }

    const restaurantLookup = await resolveRestaurantIdentityBySlug(restaurantSlug)
    if (!restaurantLookup?.restaurantId) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const result = await trackAddToCart({
      restaurantId: restaurantLookup.restaurantId,
      eventId,
      menuItemId,
      quantity,
    })

    return res.status(202).json(result)
  } catch (error) {
    next(error)
  }
}
