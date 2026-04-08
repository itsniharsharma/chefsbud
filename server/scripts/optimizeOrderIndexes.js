import 'dotenv/config'
import { connectDB, closeDB } from '../config/db.js'
import Order from '../models/Order.js'
import { logger } from '../utils/logger.js'

function getArgValue(name) {
  const prefix = `--${name}=`
  const arg = process.argv.find((entry) => entry.startsWith(prefix))
  if (!arg) return undefined
  return arg.slice(prefix.length)
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue
  }

  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return defaultValue
}

const DRY_RUN = parseBoolean(getArgValue('dry-run') ?? process.env.ORDER_INDEX_DRY_RUN, true)
const DROP_EXTRA = parseBoolean(getArgValue('drop-extra') ?? process.env.ORDER_INDEX_DROP_EXTRA, false)
const KEEP_INDEXES = new Set(['_id_'])

function normalizeKey(key = {}) {
  return JSON.stringify(key)
}

function indexNameFromSpec(spec = {}) {
  return Object.entries(spec)
    .map(([k, v]) => `${k}_${v}`)
    .join('_')
}

function buildTargetIndexSpecs() {
  return [
    {
      key: { restaurantId: 1, isArchived: 1, createdAt: -1 },
      options: { name: 'restaurantId_1_isArchived_1_createdAt_-1' },
    },
    {
      key: { restaurantId: 1, isArchived: 1, hiddenFromActive: 1, createdAt: -1 },
      options: { name: 'restaurantId_1_isArchived_1_hiddenFromActive_1_createdAt_-1' },
    },
    {
      key: { restaurantId: 1, isArchived: 1, hiddenFromActive: 1, orderStatus: 1, createdAt: -1 },
      options: { name: 'restaurantId_1_isArchived_1_hiddenFromActive_1_orderStatus_1_createdAt_-1' },
    },
    {
      key: { restaurantId: 1, isArchived: 1, orderStatus: 1, completedAt: -1, createdAt: -1 },
      options: { name: 'restaurantId_1_isArchived_1_orderStatus_1_completedAt_-1_createdAt_-1' },
    },
    {
      key: { restaurantId: 1, isArchived: 1, hiddenFromActive: 1, floorNumber: 1, createdAt: -1 },
      options: { name: 'restaurantId_1_isArchived_1_hiddenFromActive_1_floorNumber_1_createdAt_-1' },
    },
    {
      key: { restaurantId: 1, isArchived: 1, hiddenFromActive: 1, floorNumber: 1, tableNumber: 1 },
      options: { name: 'restaurantId_1_isArchived_1_hiddenFromActive_1_floorNumber_1_tableNumber_1' },
    },
    {
      key: { restaurantSlug: 1, tableNumber: 1, isArchived: 1, createdAt: -1 },
      options: { name: 'restaurantSlug_1_tableNumber_1_isArchived_1_createdAt_-1' },
    },
    {
      key: { restaurantSlug: 1, tableNumber: 1, isArchived: 1, paymentStatus: 1, createdAt: -1 },
      options: { name: 'restaurantSlug_1_tableNumber_1_isArchived_1_paymentStatus_1_createdAt_-1' },
    },
    {
      key: { isArchived: 1, archivedAt: 1, orderStatus: 1 },
      options: { name: 'isArchived_1_archivedAt_1_orderStatus_1' },
    },
    {
      key: { restaurantId: 1, isArchived: 1, orderStatus: 1, analyticsTrackedAt: 1, completedAt: 1, createdAt: 1 },
      options: { name: 'restaurantId_1_isArchived_1_orderStatus_1_analyticsTrackedAt_1_completedAt_1_createdAt_1' },
    },
    {
      key: { providerOrderId: 1 },
      options: { name: 'providerOrderId_1', unique: true, sparse: true },
    },
    {
      key: { providerPaymentId: 1 },
      options: { name: 'providerPaymentId_1', unique: true, sparse: true },
    },
  ]
}

async function run() {
  await connectDB()

  const target = buildTargetIndexSpecs()
  const existing = await Order.collection.indexes()
  const existingByKey = new Map(existing.map((idx) => [normalizeKey(idx.key || {}), idx]))
  const existingKeySignatures = new Set(existing.map((idx) => normalizeKey(idx.key || {})))

  const createPlan = []
  for (const idx of target) {
    const signature = normalizeKey(idx.key)
    if (existingKeySignatures.has(signature)) {
      const matchingExisting = existingByKey.get(signature)
      if (matchingExisting?.name) {
        KEEP_INDEXES.add(String(matchingExisting.name))
      }
      KEEP_INDEXES.add(idx.options.name)
      continue
    }
    createPlan.push(idx)
    KEEP_INDEXES.add(idx.options.name)
  }

  logger.info('order_index_optimization_plan', {
    dryRun: DRY_RUN,
    dropExtra: DROP_EXTRA,
    existingCount: existing.length,
    createCount: createPlan.length,
  })

  if (createPlan.length) {
    for (const idx of createPlan) {
      const indexName = idx.options?.name || indexNameFromSpec(idx.key)
      if (DRY_RUN) {
        logger.info('order_index_create_planned', {
          name: indexName,
          key: idx.key,
          options: idx.options,
        })
      } else {
        await Order.collection.createIndex(idx.key, idx.options)
        logger.info('order_index_created', { name: indexName })
      }
    }
  }

  if (DROP_EXTRA) {
    const refreshed = DRY_RUN ? existing : await Order.collection.indexes()
    for (const idx of refreshed) {
      const name = String(idx?.name || '')
      if (!name || KEEP_INDEXES.has(name)) continue

      if (DRY_RUN) {
        logger.info('order_index_drop_planned', { name, key: idx.key })
      } else {
        await Order.collection.dropIndex(name)
        logger.info('order_index_dropped', { name })
      }
    }
  }

  const finalIndexes = await Order.collection.indexes()
  logger.info('order_index_optimization_completed', {
    dryRun: DRY_RUN,
    dropExtra: DROP_EXTRA,
    finalCount: finalIndexes.length,
    indexNames: finalIndexes.map((idx) => idx.name),
  })

  await closeDB()
}

run().catch(async (error) => {
  logger.error('order_index_optimization_failed', {
    message: error?.message || 'unknown_error',
    stack: error?.stack,
  })
  try {
    await closeDB()
  } catch {
    // no-op
  }
  process.exit(1)
})
