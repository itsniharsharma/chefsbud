import Order from '../models/Order.js'
import InventoryReservation from '../models/InventoryReservation.js'
import InventoryLedger from '../models/InventoryLedger.js'
import AnalyticsDailyMetrics from '../models/AnalyticsDailyMetrics.js'
import AnalyticsItemDailyMetrics from '../models/AnalyticsItemDailyMetrics.js'
import AnalyticsBasketPairDaily from '../models/AnalyticsBasketPairDaily.js'
import AnalyticsMonthlyMetrics from '../models/AnalyticsMonthlyMetrics.js'
import AnalyticsItemMonthlyMetrics from '../models/AnalyticsItemMonthlyMetrics.js'
import AnalyticsBasketPairMonthly from '../models/AnalyticsBasketPairMonthly.js'
import { logger } from '../utils/logger.js'

const INVENTORY_RESERVATION_TTL_INDEX_NAME = 'expiresAt_1'

function hasLegacyOrderField(index = {}) {
  const key = index?.key || {}
  return Object.prototype.hasOwnProperty.call(key, 'archived') || Object.prototype.hasOwnProperty.call(key, 'archiveBatchId')
}

async function ensureInventoryReservationTtlIndex() {
  const indexes = await InventoryReservation.collection.indexes()
  const existing = indexes.find((index) => index?.name === INVENTORY_RESERVATION_TTL_INDEX_NAME)

  if (existing && Number(existing.expireAfterSeconds) === 0) {
    logger.info('lifecycle_index_inventory_reservation_ttl_ready', {
      indexName: INVENTORY_RESERVATION_TTL_INDEX_NAME,
    })
    return { repaired: false }
  }

  if (existing) {
    await InventoryReservation.collection.dropIndex(INVENTORY_RESERVATION_TTL_INDEX_NAME)
    logger.warn('lifecycle_index_inventory_reservation_ttl_dropped_non_ttl', {
      indexName: INVENTORY_RESERVATION_TTL_INDEX_NAME,
    })
  }

  await InventoryReservation.collection.createIndex(
    { expiresAt: 1 },
    {
      name: INVENTORY_RESERVATION_TTL_INDEX_NAME,
      expireAfterSeconds: 0,
    },
  )

  logger.info('lifecycle_index_inventory_reservation_ttl_created', {
    indexName: INVENTORY_RESERVATION_TTL_INDEX_NAME,
  })

  return { repaired: true }
}

async function dropLegacyOrderIndexes() {
  const indexes = await Order.collection.indexes()
  const legacyIndexes = indexes.filter((index) => hasLegacyOrderField(index))

  if (legacyIndexes.length === 0) {
    logger.info('lifecycle_index_order_legacy_none_found')
    return { dropped: [] }
  }

  const dropped = []
  for (const index of legacyIndexes) {
    if (!index?.name || index.name === '_id_') continue
    await Order.collection.dropIndex(index.name)
    dropped.push(index.name)
  }

  logger.warn('lifecycle_index_order_legacy_dropped', {
    dropped,
  })

  return { dropped }
}

async function ensureOrderLifecycleIndexes() {
  await Order.collection.createIndex({ restaurantId: 1, isArchived: 1, createdAt: -1 })
  await Order.collection.createIndex({ isArchived: 1, archivedAt: 1, orderStatus: 1 })

  logger.info('lifecycle_index_order_core_ready', {
    required: ['restaurantId_1_isArchived_1_createdAt_-1', 'isArchived_1_archivedAt_1_orderStatus_1'],
  })
}

async function ensureInventoryIndexes() {
  await InventoryLedger.collection.createIndex({ restaurantId: 1, inventoryItemId: 1, createdAt: -1 })
  logger.info('lifecycle_index_inventory_core_ready', {
    required: ['restaurantId_1_inventoryItemId_1_createdAt_-1'],
  })
}

async function ensureAnalyticsIndexes() {
  await AnalyticsDailyMetrics.collection.createIndex({ restaurantId: 1, date: 1 })
  await AnalyticsItemDailyMetrics.collection.createIndex({ restaurantId: 1, date: 1, menuItemId: 1 })
  await AnalyticsBasketPairDaily.collection.createIndex({ restaurantId: 1, date: 1, count: -1 })
  await AnalyticsMonthlyMetrics.collection.createIndex({ restaurantId: 1, year: 1, month: 1 })
  await AnalyticsItemMonthlyMetrics.collection.createIndex({ restaurantId: 1, year: 1, month: 1, menuItemId: 1 })
  await AnalyticsBasketPairMonthly.collection.createIndex({ restaurantId: 1, year: 1, month: 1, count: -1 })

  logger.info('lifecycle_index_analytics_core_ready', {
    daily: ['restaurantId_1_date_1', 'restaurantId_1_date_1_menuItemId_1', 'restaurantId_1_date_1_count_-1'],
    monthly: [
      'restaurantId_1_year_1_month_1',
      'restaurantId_1_year_1_month_1_menuItemId_1',
      'restaurantId_1_year_1_month_1_count_-1',
    ],
  })
}

export async function runLifecycleIndexMaintenance() {
  const startedAt = Date.now()
  const result = {
    inventoryReservationTtl: { repaired: false },
    legacyOrderIndexesDropped: [],
  }

  result.inventoryReservationTtl = await ensureInventoryReservationTtlIndex()
  const legacy = await dropLegacyOrderIndexes()
  result.legacyOrderIndexesDropped = legacy.dropped
  await ensureOrderLifecycleIndexes()
  await ensureInventoryIndexes()
  await ensureAnalyticsIndexes()

  logger.info('lifecycle_index_maintenance_completed', {
    durationMs: Date.now() - startedAt,
    repairedInventoryReservationTtl: result.inventoryReservationTtl.repaired,
    legacyOrderIndexesDropped: result.legacyOrderIndexesDropped.length,
  })

  return result
}
