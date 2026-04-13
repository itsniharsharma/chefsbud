import mongoose from 'mongoose'
import InventoryItem from '../models/InventoryItem.js'
import InventoryPurchase from '../models/InventoryPurchase.js'
import InventorySupplier from '../models/InventorySupplier.js'
import MenuItem from '../models/MenuItem.js'
import Recipe from '../models/Recipe.js'
import RecipeVersion from '../models/RecipeVersion.js'
import {
  addLedgerEntries,
  bootstrapStockFromSavedPurchases,
  getCurrentStock,
  reconcileStockFromSavedPurchases,
} from '../services/inventoryService.js'
import { composePurchasePayload } from '../services/inventoryPurchaseService.js'
import { invalidateRecipeVersionRuntimeCache } from '../services/recipeVersionRuntimeCache.js'
import { invalidateCacheByTags } from '../services/responseCache.js'
import { seedCachedResponse } from '../services/responseCache.js'
import { emitInventoryChanged } from '../realtime/inventoryEvents.js'
import { resolveRequestRestaurant } from '../utils/requestRestaurant.js'
import { logger } from '../utils/logger.js'

const supplierProjection = '_id name gstNo phone email address isActive createdAt updatedAt'
const itemProjection = '_id name defaultUnit currentStock currentStockUnit isActive createdAt updatedAt'
const purchaseProjection =
  '_id sourceType supplierId supplierNameSnapshot invoiceDate invoiceNumber gstNo cgstPercent sgstPercent igstPercent deliveryCharge discountType discountValue totalDiscountAmount paymentType items subtotalAmount taxableAmount cgstAmount sgstAmount igstAmount grandTotalAmount createdAt updatedAt'

const activeRecipeRefreshJobs = new Set()
const INVENTORY_ANALYTICS_ASYNC_CACHE_ONLY = String(process.env.INVENTORY_ANALYTICS_ASYNC_CACHE_ONLY || 'true') !== 'false'
const INVENTORY_ANALYTICS_HOT_TTL_MS = Math.max(10_000, Number(process.env.INVENTORY_ANALYTICS_HOT_TTL_MS || 45_000))
const INVENTORY_ANALYTICS_SNAPSHOT_TTL_MS = Math.max(60_000, Number(process.env.INVENTORY_ANALYTICS_SNAPSHOT_TTL_MS || 15 * 60 * 1000))
const INVENTORY_ANALYTICS_REFRESH_COOLDOWN_MS = Math.max(1_000, Number(process.env.INVENTORY_ANALYTICS_REFRESH_COOLDOWN_MS || 8_000))
const inventoryAnalyticsHotCache = new Map()
const inventoryAnalyticsSnapshotCache = new Map()
const inventoryAnalyticsInFlight = new Map()
const inventoryAnalyticsLastQueuedAt = new Map()

function inventoryAnalyticsCacheKey(restaurantId) {
  return String(restaurantId || '').trim()
}

function readInventoryAnalyticsHot(restaurantId) {
  const key = inventoryAnalyticsCacheKey(restaurantId)
  const entry = inventoryAnalyticsHotCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    inventoryAnalyticsHotCache.delete(key)
    return null
  }
  return entry.value
}

function readInventoryAnalyticsSnapshot(restaurantId) {
  const key = inventoryAnalyticsCacheKey(restaurantId)
  const entry = inventoryAnalyticsSnapshotCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    inventoryAnalyticsSnapshotCache.delete(key)
    return null
  }
  return entry.value
}

function writeInventoryAnalyticsCache(restaurantId, value) {
  const key = inventoryAnalyticsCacheKey(restaurantId)
  if (!key) return

  inventoryAnalyticsHotCache.set(key, {
    value,
    expiresAt: Date.now() + INVENTORY_ANALYTICS_HOT_TTL_MS,
  })
  inventoryAnalyticsSnapshotCache.set(key, {
    value,
    expiresAt: Date.now() + INVENTORY_ANALYTICS_SNAPSHOT_TTL_MS,
  })
}

async function buildInventoryAnalyticsOverviewPayload(restaurantId) {
  const now = new Date()
  const start90d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

  const [
    inventoryItems,
    menuItemsCount,
    recipeCount,
    purchaseRateRows,
  ] = await Promise.all([
    InventoryItem.find({ restaurantId, isActive: true })
      .select('_id name currentStock currentStockUnit defaultUnit')
      .lean(),
    MenuItem.countDocuments({ restaurantId }),
    Recipe.countDocuments({ restaurantId }),
    InventoryPurchase.aggregate([
      { $match: { restaurantId, createdAt: { $gte: start90d } } },
      { $unwind: '$items' },
      {
        $project: {
          itemId: '$items.itemId',
          amount: '$items.amount',
          baseUnit: purchaseBaseUnitExpression(),
          baseQuantity: {
            $multiply: ['$items.quantity', purchaseUnitFactorExpression()],
          },
        },
      },
      {
        $group: {
          _id: { itemId: '$itemId', baseUnit: '$baseUnit' },
          totalAmount: { $sum: '$amount' },
          totalBaseQuantity: { $sum: '$baseQuantity' },
        },
      },
    ]),
  ])

  const rateByItemAndUnit = new Map()
  for (const row of purchaseRateRows) {
    const itemId = String(row?._id?.itemId || '')
    const baseUnit = String(row?._id?.baseUnit || 'unit')
    const quantity = Number(row?.totalBaseQuantity || 0)
    const amount = Number(row?.totalAmount || 0)
    const avgRate = quantity > 0 ? amount / quantity : 0
    if (!itemId || !Number.isFinite(avgRate) || avgRate <= 0) continue

    if (!rateByItemAndUnit.has(itemId)) {
      rateByItemAndUnit.set(itemId, new Map())
    }
    rateByItemAndUnit.get(itemId).set(baseUnit, avgRate)
  }

  const stockByItem = []
  const stockTotals = { g: 0, ml: 0, unit: 0 }
  let itemsWithStock = 0
  let zeroOrNegativeStockItems = 0
  let estimatedStockValue = 0

  for (const item of inventoryItems) {
    const itemId = String(item._id)
    const quantity = Number(item.currentStock || 0)
    const unit = String(item.currentStockUnit || resolveBaseUnit(item.defaultUnit || 'Unit'))
    const avgRatePerBaseUnit = Number(rateByItemAndUnit.get(itemId)?.get(unit) || 0)
    const value = quantity > 0 && avgRatePerBaseUnit > 0 ? quantity * avgRatePerBaseUnit : 0

    if (quantity > 0) itemsWithStock += 1
    if (quantity <= 0) zeroOrNegativeStockItems += 1

    if (!stockTotals[unit]) stockTotals[unit] = 0
    stockTotals[unit] += quantity
    estimatedStockValue += value

    stockByItem.push({
      itemId,
      name: String(item.name || ''),
      stockQuantity: round6(quantity),
      stockUnit: unit,
      avgPurchaseRatePerBaseUnit: round6(avgRatePerBaseUnit),
      estimatedStockValue: round2(value),
    })
  }

  stockByItem.sort((a, b) => {
    const byValue = Number(b.estimatedStockValue || 0) - Number(a.estimatedStockValue || 0)
    if (byValue !== 0) return byValue
    return Number(b.stockQuantity || 0) - Number(a.stockQuantity || 0)
  })

  const stockValueDistribution = buildStockDistribution(stockByItem, 'estimatedStockValue', 'value')
  const stockQuantityDistribution = buildStockDistribution(stockByItem, 'stockQuantity', 'mixed')
  const stockValueFullDistribution = stockByItem
    .filter((row) => Number(row?.estimatedStockValue || 0) > 0)
    .map((row) => ({
      itemId: row.itemId,
      name: row.name,
      value: round2(row.estimatedStockValue),
      valueRaw: Number(row.estimatedStockValue || 0),
      stockUnit: row.stockUnit,
      stockQuantity: row.stockQuantity,
      estimatedStockValue: row.estimatedStockValue,
    }))
  const stockQuantityFullDistribution = stockByItem
    .filter((row) => Number(row?.stockQuantity || 0) > 0)
    .map((row) => ({
      itemId: row.itemId,
      name: row.name,
      value: round6(row.stockQuantity),
      valueRaw: Number(row.stockQuantity || 0),
      stockUnit: row.stockUnit,
      stockQuantity: row.stockQuantity,
      estimatedStockValue: row.estimatedStockValue,
    }))
  const pieMetric = stockValueDistribution.length ? 'estimatedStockValue' : 'stockQuantity'
  const stockDistribution = pieMetric === 'estimatedStockValue'
    ? stockValueDistribution
    : stockQuantityDistribution

  return {
    generatedAt: now.toISOString(),
    windows: {
      purchaseRateDays: 90,
    },
    kpis: {
      totalInventoryItems: Number(inventoryItems.length || 0),
      itemsWithStock,
      zeroOrNegativeStockItems,
      stockAvailabilityPercent: toPercent(itemsWithStock, inventoryItems.length),
      estimatedStockValue,
      averageStockValuePerItem: inventoryItems.length ? round2(estimatedStockValue / inventoryItems.length) : 0,
      recipeCoveragePercent: toPercent(recipeCount, menuItemsCount),
      menuItemsCount: Number(menuItemsCount || 0),
      recipeCount: Number(recipeCount || 0),
    },
    stock: {
      totalsByBaseUnit: {
        g: round6(stockTotals.g || 0),
        ml: round6(stockTotals.ml || 0),
        unit: round6(stockTotals.unit || 0),
      },
      pieMetric,
      stockDistribution,
      stockValueDistribution,
      stockQuantityDistribution,
      stockValueFullDistribution,
      stockQuantityFullDistribution,
    },
  }
}

function scheduleInventoryAnalyticsRefresh(restaurantId) {
  const cacheKey = inventoryAnalyticsCacheKey(restaurantId)
  if (!cacheKey) return false

  if (inventoryAnalyticsInFlight.has(cacheKey)) {
    logger.info('inventory_analytics_refresh_queue_state', {
      action: 'skip_inflight',
      cacheKey,
      inFlightDepth: inventoryAnalyticsInFlight.size,
    })
    return false
  }

  const now = Date.now()
  const lastQueuedAt = Number(inventoryAnalyticsLastQueuedAt.get(cacheKey) || 0)
  if (now - lastQueuedAt < INVENTORY_ANALYTICS_REFRESH_COOLDOWN_MS) {
    logger.info('inventory_analytics_refresh_queue_state', {
      action: 'skip_cooldown',
      cacheKey,
      inFlightDepth: inventoryAnalyticsInFlight.size,
      cooldownMsRemaining: Math.max(0, INVENTORY_ANALYTICS_REFRESH_COOLDOWN_MS - (now - lastQueuedAt)),
    })
    return false
  }

  inventoryAnalyticsLastQueuedAt.set(cacheKey, now)
  logger.info('inventory_analytics_refresh_queue_state', {
    action: 'queued',
    cacheKey,
    inFlightDepth: inventoryAnalyticsInFlight.size + 1,
  })
  const task = (async () => {
    try {
      const payload = await buildInventoryAnalyticsOverviewPayload(restaurantId)
      writeInventoryAnalyticsCache(restaurantId, payload)
      await seedCachedResponse({
        key: `inventory:analytics:${cacheKey}`,
        payload,
        status: 200,
        tags: [`inventory:analytics:${cacheKey}`],
        ttlSeconds: 45,
      })
      logger.info('inventory_analytics_refresh_queue_state', {
        action: 'completed',
        cacheKey,
        inFlightDepth: Math.max(0, inventoryAnalyticsInFlight.size - 1),
      })
    } catch (error) {
      logger.warn('inventory_analytics_refresh_queue_state', {
        action: 'failed',
        cacheKey,
        inFlightDepth: Math.max(0, inventoryAnalyticsInFlight.size - 1),
        message: error?.message || 'inventory_analytics_refresh_failed',
      })
    } finally {
      inventoryAnalyticsInFlight.delete(cacheKey)
    }
  })()

  inventoryAnalyticsInFlight.set(cacheKey, task)
  return true
}

function inventoryCacheTags(restaurantId, options = {}) {
  const id = String(restaurantId)
  const {
    suppliers = false,
    items = false,
    purchases = false,
    recipes = false,
    analytics = false,
  } = options

  const tags = []
  if (suppliers) tags.push(`inventory:suppliers:${id}`)
  if (items) tags.push(`inventory:items:${id}`)
  if (purchases) tags.push(`inventory:purchases:${id}`)
  if (recipes) tags.push(`inventory:recipes:${id}`)
  if (analytics) tags.push(`inventory:analytics:${id}`)

  return tags
}

async function invalidateInventoryCaches(restaurantId, options = {}) {
  const normalizedRestaurantId = String(restaurantId || '').trim()
  const tags = inventoryCacheTags(normalizedRestaurantId, options)

  try {
    if (tags.length) {
      await invalidateCacheByTags(tags)
    }
  } catch (cacheError) {
    logger.warn('inventory_cache_invalidation_warning', { message: cacheError?.message })
  }

  emitInventoryChanged(normalizedRestaurantId, {
    reason: 'inventory-write',
  })
}

function applyComposedPurchaseToDoc(purchase, composed) {
  purchase.paymentType = composed.paymentType
  purchase.items = composed.items
  purchase.subtotalAmount = composed.subtotalAmount
  purchase.taxableAmount = composed.taxableAmount
  purchase.cgstAmount = composed.cgstAmount
  purchase.sgstAmount = composed.sgstAmount
  purchase.igstAmount = composed.igstAmount
  purchase.grandTotalAmount = composed.grandTotalAmount
  purchase.totalDiscountAmount = composed.totalDiscountAmount
  purchase.discountType = composed.discountType
  purchase.discountValue = composed.discountValue
  purchase.cgstPercent = composed.cgstPercent
  purchase.sgstPercent = composed.sgstPercent
  purchase.igstPercent = composed.igstPercent
  purchase.deliveryCharge = composed.deliveryCharge
}

function isValidDate(value) {
  const date = new Date(value)
  return !Number.isNaN(date.getTime())
}

function normalizeSearchTerm(value = '') {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseLimit(value, fallback = 250, max = 500) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, max)
}

function sanitizeEnum(value, allowed = [], fallback = '') {
  const normalized = String(value || '').trim()
  return allowed.includes(normalized) ? normalized : fallback
}

function toObjectId(value) {
  return String(value || '').trim()
}

function safeNumber(value, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function round6(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1_000_000) / 1_000_000
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function resolveBaseUnit(unit = 'Unit') {
  const normalized = String(unit || 'Unit').trim().toLowerCase()
  if (normalized === 'kg' || normalized === 'gram' || normalized === 'g') return 'g'
  if (normalized === 'litre' || normalized === 'liter' || normalized === 'ml') return 'ml'
  return 'unit'
}

function convertRecipeUnitToBase(quantity, unit) {
  const normalized = String(unit || '').trim().toLowerCase()
  const qty = Number(quantity || 0)
  if (!Number.isFinite(qty) || qty <= 0) {
    return { quantity: 0, unit: resolveBaseUnit(unit) }
  }

  if (normalized === 'kg') {
    return { quantity: round6(qty * 1000), unit: 'g' }
  }
  if (normalized === 'litre' || normalized === 'liter') {
    return { quantity: round6(qty * 1000), unit: 'ml' }
  }

  return {
    quantity: round6(qty),
    unit: resolveBaseUnit(unit),
  }
}

function toPercent(part, total) {
  const p = Number(part || 0)
  const t = Number(total || 0)
  if (t <= 0) return 0
  return round2((p / t) * 100)
}

function purchaseUnitFactorExpression() {
  return {
    $switch: {
      branches: [
        { case: { $in: ['$items.unit', ['Kg', 'Litre']] }, then: 1000 },
        { case: { $in: ['$items.unit', ['Gram', 'Ml', 'Unit', 'Packet']] }, then: 1 },
      ],
      default: 1,
    },
  }
}

function purchaseBaseUnitExpression() {
  return {
    $switch: {
      branches: [
        { case: { $in: ['$items.unit', ['Kg', 'Gram']] }, then: 'g' },
        { case: { $in: ['$items.unit', ['Litre', 'Ml']] }, then: 'ml' },
      ],
      default: 'unit',
    },
  }
}

function buildStockDistribution(rows = [], metricKey = 'estimatedStockValue', othersUnit = 'mixed') {
  const candidates = rows
    .filter((row) => Number(row?.[metricKey] || 0) > 0)
    .sort((a, b) => Number(b?.[metricKey] || 0) - Number(a?.[metricKey] || 0))

  const topRows = candidates.slice(0, 8)
  const topTotal = topRows.reduce((sum, row) => sum + Number(row?.[metricKey] || 0), 0)
  const remaining = candidates
    .slice(8)
    .reduce((sum, row) => sum + Number(row?.[metricKey] || 0), 0)
  const total = topTotal + remaining

  const distribution = topRows.map((row) => {
    const rawValue = Number(row?.[metricKey] || 0)
    const roundedValue =
      metricKey === 'stockQuantity'
        ? round6(rawValue)
        : round2(rawValue)

    return {
      itemId: row.itemId,
      name: row.name,
      value: roundedValue > 0 ? roundedValue : rawValue,
      valueRaw: rawValue,
      stockUnit: row.stockUnit,
      stockQuantity: row.stockQuantity,
      estimatedStockValue: row.estimatedStockValue,
      sharePercent: toPercent(rawValue, total),
    }
  })

  if (remaining > 0) {
    const roundedRemaining = metricKey === 'stockQuantity' ? round6(remaining) : round2(remaining)
    distribution.push({
      itemId: 'others',
      name: 'Others',
      value: roundedRemaining > 0 ? roundedRemaining : remaining,
      valueRaw: remaining,
      stockUnit: othersUnit,
      stockQuantity: 0,
      estimatedStockValue: 0,
      sharePercent: toPercent(remaining, total),
    })
  }

  return distribution
}

function buildPurchaseLedgerEntries({ restaurantId, purchase, createdBy, referenceType = 'purchase' }) {
  const rows = Array.isArray(purchase?.items) ? purchase.items : []
  return rows
    .map((row, index) => {
      const itemId = String(row?.itemId || '').trim()
      const quantity = safeNumber(row?.quantity)
      const unit = String(row?.unit || '').trim()
      if (!itemId || quantity <= 0 || !unit) return null

      return {
        restaurantId,
        inventoryItemId: itemId,
        type: 'PURCHASE',
        quantity,
        direction: 1,
        unit,
        referenceType,
        referenceId: purchase?._id || null,
        metadata: {
          purchaseId: String(purchase?._id || ''),
          invoiceNumber: String(purchase?.invoiceNumber || ''),
          sourceType: String(purchase?.sourceType || ''),
          itemIndex: index,
        },
        createdBy,
        idempotencyKey: purchase?._id
          ? `purchase:${String(purchase._id)}:item:${itemId}:${index}`
          : '',
      }
    })
    .filter(Boolean)
}

function buildPurchaseAdjustmentEntries({
  restaurantId,
  purchaseId,
  oldRow,
  newRow,
  itemIndex,
  createdBy,
}) {
  const result = []

  const oldQty = safeNumber(oldRow?.quantity)
  const newQty = safeNumber(newRow?.quantity)

  if (oldRow?.itemId && oldQty > 0 && oldRow?.unit) {
    result.push({
      restaurantId,
      inventoryItemId: String(oldRow.itemId),
      type: 'ADJUSTMENT',
      quantity: oldQty,
      direction: -1,
      unit: String(oldRow.unit),
      referenceType: 'purchase_update',
      referenceId: purchaseId,
      metadata: {
        purchaseId: String(purchaseId || ''),
        itemIndex,
        mode: 'revert_old_row',
      },
      createdBy,
    })
  }

  if (newRow?.itemId && newQty > 0 && newRow?.unit) {
    result.push({
      restaurantId,
      inventoryItemId: String(newRow.itemId),
      type: 'ADJUSTMENT',
      quantity: newQty,
      direction: 1,
      unit: String(newRow.unit),
      referenceType: 'purchase_update',
      referenceId: purchaseId,
      metadata: {
        purchaseId: String(purchaseId || ''),
        itemIndex,
        mode: 'apply_new_row',
      },
      createdBy,
    })
  }

  return result
}

function normalizeRecipeIngredientRows(rows = []) {
  return rows
    .map((row) => {
      const sourceType = String(row?.sourceType || 'inventory').trim().toLowerCase() === 'menu' ? 'menu' : 'inventory'
      const inventoryItemIdRaw = String(row?.inventoryItemId || '').trim()
      const menuItemIdRaw = String(row?.menuItemId || '').trim()

      return {
        sourceType,
        inventoryItemId: sourceType === 'menu' ? null : (inventoryItemIdRaw || null),
        menuItemId: sourceType === 'menu' ? (menuItemIdRaw || null) : null,
        quantity: round6(Math.max(0, safeNumber(row?.quantity))),
        unit: String(row?.unit || '').trim(),
      }
    })
    .filter((row) => {
      if (!(row.quantity > 0) || !row.unit) return false
      if (row.sourceType === 'menu') return Boolean(row.menuItemId)
      return Boolean(row.inventoryItemId)
    })
}

function aggregateVersionedIngredients(rows = []) {
  const totalsByKey = new Map()

  for (const row of rows) {
    const inventoryItemId = String(row?.inventoryItemId || '').trim()
    const unit = String(row?.unit || '').trim()
    const quantity = round6(Math.max(0, Number(row?.quantity || 0)))
    if (!inventoryItemId || !unit || quantity <= 0) continue

    const key = `${inventoryItemId}:${unit}`
    const current = totalsByKey.get(key) || {
      inventoryItemId,
      unit,
      quantity: 0,
    }
    current.quantity = round6(current.quantity + quantity)
    totalsByKey.set(key, current)
  }

  return [...totalsByKey.values()].filter((row) => row.quantity > 0)
}

function extractMenuDependencyIds(ingredients = []) {
  return [
    ...new Set(
      (Array.isArray(ingredients) ? ingredients : [])
        .filter((row) => String(row?.sourceType || '').trim().toLowerCase() === 'menu')
        .map((row) => String(row?.menuItemId || '').trim())
        .filter(Boolean),
    ),
  ]
}

function buildDependencyMaps(recipes = []) {
  const depsByMenuId = new Map()
  const parentsByMenuId = new Map()

  for (const recipe of recipes) {
    const menuId = String(recipe?.menuItemId || '').trim()
    if (!menuId) continue
    const deps = extractMenuDependencyIds(recipe?.ingredients)
    depsByMenuId.set(menuId, deps)

    for (const depId of deps) {
      if (!parentsByMenuId.has(depId)) {
        parentsByMenuId.set(depId, new Set())
      }
      parentsByMenuId.get(depId).add(menuId)
    }
  }

  return { depsByMenuId, parentsByMenuId }
}

function findCyclePathToTarget({ depsByMenuId, startMenuItemId, targetMenuItemId }) {
  const start = String(startMenuItemId || '').trim()
  const target = String(targetMenuItemId || '').trim()
  if (!start || !target) return null
  if (start === target) return [target]

  const queue = [{ node: start, path: [start] }]
  const visited = new Set([start])

  while (queue.length) {
    const current = queue.shift()
    const dependencies = depsByMenuId.get(current.node) || []
    for (const dep of dependencies) {
      if (dep === target) {
        return [...current.path, dep]
      }
      if (visited.has(dep)) continue
      visited.add(dep)
      queue.push({ node: dep, path: [...current.path, dep] })
    }
  }

  return null
}

async function assertNoRecipeDependencyCycle({
  restaurantId,
  targetMenuItemId,
  nextMenuDependencyIds = [],
}) {
  if (!nextMenuDependencyIds.length) return

  const targetId = String(targetMenuItemId || '').trim()
  const uniqueDependencies = [...new Set(nextMenuDependencyIds.map((id) => String(id || '').trim()).filter(Boolean))]
  if (!targetId || !uniqueDependencies.length) return

  const existingRecipes = await Recipe.find({ restaurantId })
    .select('menuItemId ingredients.sourceType ingredients.menuItemId')
    .lean()

  const { depsByMenuId } = buildDependencyMaps(existingRecipes)
  depsByMenuId.set(targetId, uniqueDependencies)

  for (const depId of uniqueDependencies) {
    const cyclePath = findCyclePathToTarget({
      depsByMenuId,
      startMenuItemId: depId,
      targetMenuItemId: targetId,
    })
    if (cyclePath) {
      throw new Error(
        `Recipe dependency cycle detected: ${[targetId, ...cyclePath].join(' -> ')}`,
      )
    }
  }
}

async function computeFlattenedVersionedIngredients({
  restaurantId,
  menuItemId,
  ingredients = [],
}) {
  const normalized = normalizeRecipeIngredientRows(ingredients)
  const inventoryRows = normalized.filter((row) => row.sourceType !== 'menu')
  const menuRows = normalized.filter((row) => row.sourceType === 'menu')

  const versionedFromInventory = inventoryRows
    .map((row) => {
      const converted = convertRecipeUnitToBase(row.quantity, row.unit)
      return {
        inventoryItemId: row.inventoryItemId,
        quantity: converted.quantity,
        unit: converted.unit,
      }
    })
    .filter((row) => row.quantity > 0)

  const versionedFromMenu = await resolveMenuBackedVersionedIngredients({
    restaurantId,
    targetMenuItemId: menuItemId,
    menuIngredientRows: menuRows,
  })

  return aggregateVersionedIngredients([...versionedFromInventory, ...versionedFromMenu])
}

async function rebuildRecipeVersionSnapshot({
  restaurantId,
  menuItemId,
  createdBy = null,
}) {
  const recipe = await Recipe.findOne({ restaurantId, menuItemId })
    .select('_id restaurantId menuItemId ingredients version')

  if (!recipe) return false

  const flattenedIngredients = await computeFlattenedVersionedIngredients({
    restaurantId,
    menuItemId,
    ingredients: recipe.ingredients,
  })

  if (!flattenedIngredients.length) {
    logger.warn('recipe_snapshot_rebuild_skipped_empty', {
      restaurantId: String(restaurantId),
      menuItemId: String(menuItemId),
    })
    return false
  }

  const advancedRecipe = await Recipe.findOneAndUpdate(
    {
      _id: recipe._id,
      version: Number(recipe.version || 1),
    },
    {
      $inc: { version: 1 },
    },
    {
      returnDocument: 'after',
    },
  )

  if (!advancedRecipe) {
    return false
  }

  const nextVersion = Number(advancedRecipe.version || 1)
  await RecipeVersion.findOneAndUpdate(
    {
      restaurantId,
      menuItemId,
      version: nextVersion,
    },
    {
      $setOnInsert: {
        restaurantId,
        menuItemId,
        version: nextVersion,
        ingredients: flattenedIngredients,
        createdBy,
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
    },
  )

  invalidateRecipeVersionRuntimeCache({
    restaurantId,
    menuItemIds: [String(menuItemId)],
  })

  return true
}

function scheduleAncestorRecipeRefresh({
  restaurantId,
  changedMenuItemId,
  createdBy = null,
}) {
  const tenantId = String(restaurantId || '').trim()
  const changedId = String(changedMenuItemId || '').trim()
  if (!tenantId || !changedId) return

  const jobKey = `${tenantId}:${changedId}`
  if (activeRecipeRefreshJobs.has(jobKey)) return
  activeRecipeRefreshJobs.add(jobKey)

  setTimeout(async () => {
    try {
      const recipes = await Recipe.find({ restaurantId: tenantId })
        .select('menuItemId ingredients.sourceType ingredients.menuItemId')
        .lean()
      const { parentsByMenuId } = buildDependencyMaps(recipes)

      const levels = new Map()
      const queue = [{ id: changedId, depth: 0 }]

      while (queue.length) {
        const current = queue.shift()
        const parents = [...(parentsByMenuId.get(current.id) || [])]
        for (const parentId of parents) {
          const nextDepth = current.depth + 1
          const existingDepth = levels.get(parentId)
          if (existingDepth != null && existingDepth <= nextDepth) continue
          levels.set(parentId, nextDepth)
          queue.push({ id: parentId, depth: nextDepth })
        }
      }

      const orderedAncestors = [...levels.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([menuItemId]) => menuItemId)

      for (const ancestorMenuId of orderedAncestors) {
        try {
          await rebuildRecipeVersionSnapshot({
            restaurantId: tenantId,
            menuItemId: ancestorMenuId,
            createdBy,
          })
        } catch (error) {
          logger.warn('recipe_ancestor_refresh_failed', {
            restaurantId: tenantId,
            changedMenuItemId: changedId,
            ancestorMenuItemId: ancestorMenuId,
            message: error?.message,
          })
        }
      }
    } catch (error) {
      logger.warn('recipe_ancestor_refresh_job_failed', {
        restaurantId: tenantId,
        changedMenuItemId: changedId,
        message: error?.message,
      })
    } finally {
      activeRecipeRefreshJobs.delete(jobKey)
    }
  }, 0)
}

async function resolveMenuBackedVersionedIngredients({
  restaurantId,
  targetMenuItemId,
  menuIngredientRows = [],
}) {
  if (!menuIngredientRows.length) return []

  const referencedMenuIds = [
    ...new Set(
      menuIngredientRows.map((row) => String(row?.menuItemId || '').trim()).filter(Boolean),
    ),
  ]

  if (referencedMenuIds.includes(String(targetMenuItemId || '').trim())) {
    throw new Error('A recipe cannot directly reference itself as a menu ingredient')
  }

  const referencedMenus = await MenuItem.find({
    restaurantId,
    _id: { $in: referencedMenuIds },
  })
    .select('_id name')
    .lean()

  if (referencedMenus.length !== referencedMenuIds.length) {
    throw new Error('One or more menu ingredients are invalid for this restaurant')
  }

  const referencedObjectIds = referencedMenuIds.map((id) => new mongoose.Types.ObjectId(id))
  const latestRecipeVersions = await RecipeVersion.aggregate([
    {
      $match: {
        restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
        menuItemId: { $in: referencedObjectIds },
      },
    },
    { $sort: { version: -1 } },
    {
      $group: {
        _id: '$menuItemId',
        version: { $first: '$version' },
        ingredients: { $first: '$ingredients' },
      },
    },
  ])

  const versionByMenuItemId = new Map(
    latestRecipeVersions.map((row) => [String(row?._id || ''), row]),
  )

  const unresolvedNames = []
  const referencedMenuById = new Map(referencedMenus.map((row) => [String(row._id), row]))
  for (const menuItemId of referencedMenuIds) {
    const versionDoc = versionByMenuItemId.get(menuItemId)
    if (!versionDoc || !Array.isArray(versionDoc.ingredients) || !versionDoc.ingredients.length) {
      unresolvedNames.push(referencedMenuById.get(menuItemId)?.name || menuItemId)
    }
  }

  if (unresolvedNames.length) {
    throw new Error(`Referenced menu items are missing saved recipes: ${unresolvedNames.join(', ')}`)
  }

  const rows = []
  for (const menuIngredient of menuIngredientRows) {
    const menuItemId = String(menuIngredient?.menuItemId || '').trim()
    const multiplier = round6(Math.max(0, Number(menuIngredient?.quantity || 0)))
    if (!menuItemId || multiplier <= 0) continue

    const versionDoc = versionByMenuItemId.get(menuItemId)
    const ingredients = Array.isArray(versionDoc?.ingredients) ? versionDoc.ingredients : []
    for (const row of ingredients) {
      const inventoryItemId = String(row?.inventoryItemId || '').trim()
      const unit = String(row?.unit || '').trim()
      const quantity = round6(Math.max(0, Number(row?.quantity || 0)) * multiplier)
      if (!inventoryItemId || !unit || quantity <= 0) continue

      rows.push({ inventoryItemId, quantity, unit })
    }
  }

  return aggregateVersionedIngredients(rows)
}

export async function listInventorySuppliers(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const q = normalizeSearchTerm(req.query?.q)
    const limit = parseLimit(req.query?.limit)
    const query = {
      restaurantId: restaurant._id,
      isActive: true,
    }

    if (q) {
      query.normalizedName = { $regex: `^${escapeRegex(q)}` }
    }

    const suppliers = await InventorySupplier.find({
      ...query,
    })
      .sort({ name: 1 })
      .limit(limit)
      .select(supplierProjection)
      .lean()

    return res.json({ suppliers })
  } catch (error) {
    next(error)
  }
}

export async function createInventorySupplier(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const supplier = await InventorySupplier.create({
      restaurantId: restaurant._id,
      name: req.body.name,
      gstNo: req.body.gstNo || '',
      phone: req.body.phone || '',
      email: req.body.email || '',
      address: req.body.address || '',
    })

    try {
      await invalidateCacheByTags([`inventory:suppliers:${String(restaurant._id)}`])
    } catch (cacheError) {
      logger.warn('inventory_supplier_cache_invalidation', { message: cacheError?.message })
    }

    return res.status(201).json(supplier)
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Supplier already exists' })
    }
    if (error?.name === 'ValidationError') {
      const messages = Object.entries(error.errors)
        .map(([field, err]) => `${field}: ${err.message}`)
        .join(', ')
      logger.warn('inventory_supplier_validation_error', { errors: messages })
      return res.status(400).json({ message: `Validation failed: ${messages}` })
    }
    logger.error('inventory_supplier_creation_failed', { message: error?.message })
    next(error)
  }
}

export async function listInventoryItems(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const q = normalizeSearchTerm(req.query?.q)
    const limit = parseLimit(req.query?.limit)
    const query = {
      restaurantId: restaurant._id,
      isActive: true,
    }

    if (q) {
      query.normalizedName = { $regex: `^${escapeRegex(q)}` }
    }

    const items = await InventoryItem.find({
      ...query,
    })
      .sort({ name: 1 })
      .limit(limit)
      .select(itemProjection)
      .lean()

    return res.json({ items })
  } catch (error) {
    next(error)
  }
}

export async function createInventoryItem(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const item = await InventoryItem.create({
      restaurantId: restaurant._id,
      name: req.body.name,
      defaultUnit: req.body.defaultUnit || 'Unit',
    })

    await invalidateInventoryCaches(restaurant._id, {
      items: true,
      analytics: true,
    })

    return res.status(201).json(item)
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Item already exists' })
    }
    if (error?.name === 'ValidationError') {
      const messages = Object.entries(error.errors)
        .map(([field, err]) => `${field}: ${err.message}`)
        .join(', ')
      logger.warn('inventory_item_validation_error', { errors: messages })
      return res.status(400).json({ message: `Validation failed: ${messages}` })
    }
    logger.error('inventory_item_creation_failed', { message: error?.message })
    next(error)
  }
}

export async function updateInventoryItemDefaultUnit(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const inventoryItemId = String(req.params?.inventoryItemId || '').trim()
    const defaultUnit = String(req.body?.defaultUnit || '').trim()

    if (!inventoryItemId) {
      return res.status(400).json({ message: 'inventoryItemId is required' })
    }

    if (!defaultUnit) {
      return res.status(400).json({ message: 'defaultUnit is required' })
    }

    const item = await InventoryItem.findOne({
      _id: inventoryItemId,
      restaurantId: restaurant._id,
    })

    if (!item) {
      return res.status(404).json({ message: 'Inventory item not found' })
    }

    const currentStock = Number(item.currentStock || 0)
    const nextBaseUnit = resolveBaseUnit(defaultUnit)
    const currentBaseUnit = String(item.currentStockUnit || resolveBaseUnit(item.defaultUnit || 'Unit'))

    // Prevent changing dimensional family while stock exists (mass -> volume, etc.).
    if (Math.abs(currentStock) > 0.000001 && nextBaseUnit !== currentBaseUnit) {
      return res.status(400).json({
        message:
          'Cannot change default unit across measurement dimensions while stock is non-zero. Please consume/adjust stock first.',
      })
    }

    item.defaultUnit = defaultUnit
    if (Math.abs(currentStock) <= 0.000001) {
      item.currentStockUnit = nextBaseUnit
    }
    await item.save()

    await invalidateInventoryCaches(restaurant._id, {
      items: true,
      analytics: true,
    })

    return res.json(item)
  } catch (error) {
    next(error)
  }
}

export async function createInventoryPurchase(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const sourceType = String(req.body?.sourceType || '').trim()
    const supplierId = req.body?.supplierId ? String(req.body.supplierId) : ''
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : []

    if (!isValidDate(req.body?.invoiceDate)) {
      return res.status(400).json({ message: 'Valid invoice date is required' })
    }

    if (!String(req.body?.invoiceNumber || '').trim()) {
      return res.status(400).json({ message: 'Invoice number is required' })
    }

    if (!rawItems.length) {
      return res.status(400).json({ message: 'At least one purchase item is required' })
    }

    const uniqueItemIds = [...new Set(rawItems.map((row) => String(row?.itemId || '').trim()).filter(Boolean))]
    const items = await InventoryItem.find({
      restaurantId: restaurant._id,
      _id: { $in: uniqueItemIds },
      isActive: true,
    })
      .select('_id name defaultUnit')
      .lean()
    const itemById = new Map(items.map((item) => [String(item._id), item]))

    if (itemById.size !== uniqueItemIds.length) {
      return res.status(400).json({ message: 'One or more selected items are invalid' })
    }

    let supplier = null
    if (sourceType === 'Supplier') {
      if (!supplierId) {
        return res.status(400).json({ message: 'Supplier is required for source type Supplier' })
      }

      supplier = await InventorySupplier.findOne({
        restaurantId: restaurant._id,
        _id: supplierId,
        isActive: true,
      })
        .select('_id name')
        .lean()

      if (!supplier) {
        return res.status(400).json({ message: 'Selected supplier is invalid' })
      }
    }

    const composed = composePurchasePayload({
      payload: req.body,
      itemById,
      supplierName: supplier?.name || '',
    })

    const session = await mongoose.startSession()
    let purchase = null

    try {
      await session.withTransaction(async () => {
        purchase = await InventoryPurchase.create(
          [
            {
              restaurantId: restaurant._id,
              sourceType: composed.sourceType,
              supplierId: supplier?._id || null,
              supplierNameSnapshot: composed.supplierNameSnapshot,
              invoiceDate: composed.invoiceDate,
              invoiceNumber: composed.invoiceNumber,
              gstNo: composed.gstNo,
              cgstPercent: composed.cgstPercent,
              sgstPercent: composed.sgstPercent,
              igstPercent: composed.igstPercent,
              deliveryCharge: composed.deliveryCharge,
              discountType: composed.discountType,
              discountValue: composed.discountValue,
              totalDiscountAmount: composed.totalDiscountAmount,
              paymentType: composed.paymentType,
              items: composed.items,
              subtotalAmount: composed.subtotalAmount,
              taxableAmount: composed.taxableAmount,
              cgstAmount: composed.cgstAmount,
              sgstAmount: composed.sgstAmount,
              igstAmount: composed.igstAmount,
              grandTotalAmount: composed.grandTotalAmount,
              createdByUserId: req.user?._id,
              createdByRole: req.user?.role === 'staff' ? 'staff' : 'owner',
            },
          ],
          { session },
        )

        purchase = purchase[0]

        const ledgerEntries = buildPurchaseLedgerEntries({
          restaurantId: restaurant._id,
          purchase,
          createdBy: req.user?._id || null,
        })

        if (ledgerEntries.length) {
          await addLedgerEntries(ledgerEntries, { session })
        }
      })
    } finally {
      session.endSession()
    }

    const responsePayload = await InventoryPurchase.findOne({ _id: purchase._id })
      .select(purchaseProjection)
      .lean()

    await invalidateInventoryCaches(restaurant._id, {
      items: true,
      purchases: true,
      analytics: true,
    })

    return res.status(201).json(responsePayload)
  } catch (error) {
    next(error)
  }
}

export async function listInventoryPurchaseRows(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const limit = parseLimit(req.query?.limit, 100, 300)
    const paymentType = sanitizeEnum(req.query?.paymentType, ['Unpaid', 'Paid'])
    const sourceType = sanitizeEnum(req.query?.sourceType, ['Supplier', 'Restaurant', 'Kitchen'])

    const match = { restaurantId: restaurant._id }
    if (paymentType) {
      match.paymentType = paymentType
    }
    if (sourceType) {
      match.sourceType = sourceType
    }

    const purchaseWindow = Math.min(limit * 4, 1200)

    const rows = await InventoryPurchase.aggregate([
      { $match: match },
      { $sort: { createdAt: -1, _id: -1 } },
      { $limit: purchaseWindow },
      {
        $project: {
          _id: 1,
          invoiceDate: 1,
          invoiceNumber: 1,
          gstNo: 1,
          cgstPercent: 1,
          sgstPercent: 1,
          igstPercent: 1,
          deliveryCharge: 1,
          discountType: 1,
          discountValue: 1,
          totalDiscountAmount: 1,
          subtotalAmount: 1,
          taxableAmount: 1,
          cgstAmount: 1,
          sgstAmount: 1,
          igstAmount: 1,
          grandTotalAmount: 1,
          sourceType: 1,
          supplierNameSnapshot: 1,
          paymentType: 1,
          items: 1,
          updatedAt: 1,
          createdAt: 1,
        },
      },
      { $unwind: { path: '$items', includeArrayIndex: 'itemIndex' } },
      {
        $project: {
          _id: 0,
          purchaseId: '$_id',
          itemIndex: '$itemIndex',
          invoiceDate: '$invoiceDate',
          invoiceNumber: '$invoiceNumber',
          gstNo: '$gstNo',
          cgstPercent: '$cgstPercent',
          sgstPercent: '$sgstPercent',
          igstPercent: '$igstPercent',
          deliveryCharge: '$deliveryCharge',
          discountType: '$discountType',
          discountValue: '$discountValue',
          totalDiscountAmount: '$totalDiscountAmount',
          subtotalAmount: '$subtotalAmount',
          taxableAmount: '$taxableAmount',
          cgstAmount: '$cgstAmount',
          sgstAmount: '$sgstAmount',
          igstAmount: '$igstAmount',
          grandTotalAmount: '$grandTotalAmount',
          sourceType: '$sourceType',
          supplierName: '$supplierNameSnapshot',
          paymentType: '$paymentType',
          itemId: '$items.itemId',
          itemName: '$items.itemName',
          quantity: '$items.quantity',
          unit: '$items.unit',
          rate: '$items.rate',
          amount: '$items.amount',
          updatedAt: '$updatedAt',
          createdAt: '$createdAt',
        },
      },
      { $limit: limit },
    ])

    return res.json({ rows })
  } catch (error) {
    next(error)
  }
}

export async function updateInventoryPurchaseItem(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const purchaseId = toObjectId(req.params?.purchaseId)
    const itemIndex = Number(req.params?.itemIndex)

    if (!Number.isInteger(itemIndex) || itemIndex < 0) {
      return res.status(400).json({ message: 'Invalid item index' })
    }

    const purchase = await InventoryPurchase.findOne({
      _id: purchaseId,
      restaurantId: restaurant._id,
    }).select(
      '_id restaurantId sourceType supplierNameSnapshot invoiceDate invoiceNumber gstNo cgstPercent sgstPercent igstPercent deliveryCharge discountType discountValue paymentType items subtotalAmount taxableAmount cgstAmount sgstAmount igstAmount grandTotalAmount',
    )

    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' })
    }

    const currentItems = Array.isArray(purchase.items) ? purchase.items : []
    if (itemIndex >= currentItems.length) {
      return res.status(400).json({ message: 'Item row not found for update' })
    }

    const quantity = req.body?.quantity == null ? currentItems[itemIndex].quantity : Number(req.body.quantity)
    const rate = req.body?.rate == null ? currentItems[itemIndex].rate : Number(req.body.rate)
    const unit = String(req.body?.unit || currentItems[itemIndex].unit || 'Unit').trim()
    const paymentType = String(req.body?.paymentType || purchase.paymentType || 'Unpaid').trim()

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ message: 'Quantity must be greater than 0' })
    }

    if (!Number.isFinite(rate) || rate < 0) {
      return res.status(400).json({ message: 'Rate must be greater than or equal to 0' })
    }

    const draftItems = currentItems.map((row, index) => {
      if (index !== itemIndex) return row
      return {
        itemId: String(row.itemId || ''),
        itemName: row.itemName,
        quantity,
        unit,
        rate,
      }
    })

    const composed = composePurchasePayload({
      payload: {
        sourceType: purchase.sourceType,
        invoiceDate: purchase.invoiceDate,
        invoiceNumber: purchase.invoiceNumber,
        gstNo: purchase.gstNo,
        cgstPercent: purchase.cgstPercent,
        sgstPercent: purchase.sgstPercent,
        igstPercent: purchase.igstPercent,
        deliveryCharge: purchase.deliveryCharge,
        discountType: purchase.discountType,
        discountValue: purchase.discountValue,
        paymentType,
        items: draftItems,
      },
      itemById: new Map(),
      supplierName: purchase.supplierNameSnapshot,
    })

    const previousRow = currentItems[itemIndex]
    const updatedRow = composed.items?.[itemIndex]

    const session = await mongoose.startSession()

    try {
      await session.withTransaction(async () => {
        applyComposedPurchaseToDoc(purchase, composed)

        await purchase.save({ session })

        const adjustmentEntries = buildPurchaseAdjustmentEntries({
          restaurantId: restaurant._id,
          purchaseId: purchase._id,
          oldRow: previousRow,
          newRow: updatedRow,
          itemIndex,
          createdBy: req.user?._id || null,
        })

        if (adjustmentEntries.length) {
          await addLedgerEntries(adjustmentEntries, { session })
        }
      })
    } finally {
      session.endSession()
    }

    await invalidateInventoryCaches(restaurant._id, {
      items: true,
      purchases: true,
      analytics: true,
    })

    const updatedRowResponse = purchase.items?.[itemIndex]

    return res.json({
      purchaseId: purchase._id,
      itemIndex,
      row: {
        purchaseId: purchase._id,
        itemIndex,
        invoiceDate: purchase.invoiceDate,
        invoiceNumber: purchase.invoiceNumber,
        gstNo: purchase.gstNo,
        cgstPercent: purchase.cgstPercent,
        sgstPercent: purchase.sgstPercent,
        igstPercent: purchase.igstPercent,
        deliveryCharge: purchase.deliveryCharge,
        discountType: purchase.discountType,
        discountValue: purchase.discountValue,
        totalDiscountAmount: purchase.totalDiscountAmount,
        subtotalAmount: purchase.subtotalAmount,
        taxableAmount: purchase.taxableAmount,
        cgstAmount: purchase.cgstAmount,
        sgstAmount: purchase.sgstAmount,
        igstAmount: purchase.igstAmount,
        grandTotalAmount: purchase.grandTotalAmount,
        sourceType: purchase.sourceType,
        supplierName: purchase.supplierNameSnapshot,
        paymentType: purchase.paymentType,
        itemId: updatedRowResponse?.itemId,
        itemName: updatedRowResponse?.itemName,
        quantity: updatedRowResponse?.quantity,
        unit: updatedRowResponse?.unit,
        rate: updatedRowResponse?.rate,
        amount: updatedRowResponse?.amount,
        updatedAt: purchase.updatedAt,
        createdAt: purchase.createdAt,
      },
    })
  } catch (error) {
    next(error)
  }
}

export async function deleteInventoryPurchaseItem(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const purchaseId = toObjectId(req.params?.purchaseId)
    const itemIndex = Number(req.params?.itemIndex)

    if (!Number.isInteger(itemIndex) || itemIndex < 0) {
      return res.status(400).json({ message: 'Invalid item index' })
    }

    const purchase = await InventoryPurchase.findOne({
      _id: purchaseId,
      restaurantId: restaurant._id,
    }).select(
      '_id restaurantId sourceType supplierNameSnapshot invoiceDate invoiceNumber gstNo cgstPercent sgstPercent igstPercent deliveryCharge discountType discountValue paymentType items subtotalAmount taxableAmount cgstAmount sgstAmount igstAmount grandTotalAmount',
    )

    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' })
    }

    const currentItems = Array.isArray(purchase.items) ? purchase.items : []
    if (itemIndex >= currentItems.length) {
      return res.status(400).json({ message: 'Item row not found for deletion' })
    }

    const remainingItems = currentItems
      .filter((_row, index) => index !== itemIndex)
      .map((row) => ({
        itemId: String(row.itemId || ''),
        itemName: String(row.itemName || '').trim(),
        quantity: Number(row.quantity || 0),
        unit: String(row.unit || 'Unit').trim() || 'Unit',
        rate: Number(row.rate || 0),
      }))

    const removedRow = currentItems[itemIndex]

    if (remainingItems.length === 0) {
      const session = await mongoose.startSession()

      try {
        await session.withTransaction(async () => {
          await InventoryPurchase.deleteOne({ _id: purchase._id, restaurantId: restaurant._id }).session(session)

          const adjustmentEntries = buildPurchaseAdjustmentEntries({
            restaurantId: restaurant._id,
            purchaseId: purchase._id,
            oldRow: removedRow,
            newRow: null,
            itemIndex,
            createdBy: req.user?._id || null,
          })

          if (adjustmentEntries.length) {
            await addLedgerEntries(adjustmentEntries, { session })
          }
        })
      } finally {
        session.endSession()
      }

      await invalidateInventoryCaches(restaurant._id, {
        items: true,
        purchases: true,
        analytics: true,
      })

      return res.json({
        deleted: true,
        purchaseDeleted: true,
        purchaseId: purchase._id,
        itemIndex,
      })
    }

    const composed = composePurchasePayload({
      payload: {
        sourceType: purchase.sourceType,
        invoiceDate: purchase.invoiceDate,
        invoiceNumber: purchase.invoiceNumber,
        gstNo: purchase.gstNo,
        cgstPercent: purchase.cgstPercent,
        sgstPercent: purchase.sgstPercent,
        igstPercent: purchase.igstPercent,
        deliveryCharge: purchase.deliveryCharge,
        discountType: purchase.discountType,
        discountValue: purchase.discountValue,
        paymentType: purchase.paymentType,
        items: remainingItems,
      },
      itemById: new Map(),
      supplierName: purchase.supplierNameSnapshot,
    })

    const session = await mongoose.startSession()

    try {
      await session.withTransaction(async () => {
        applyComposedPurchaseToDoc(purchase, composed)

        await purchase.save({ session })

        const adjustmentEntries = buildPurchaseAdjustmentEntries({
          restaurantId: restaurant._id,
          purchaseId: purchase._id,
          oldRow: removedRow,
          newRow: null,
          itemIndex,
          createdBy: req.user?._id || null,
        })

        if (adjustmentEntries.length) {
          await addLedgerEntries(adjustmentEntries, { session })
        }
      })
    } finally {
      session.endSession()
    }

    await invalidateInventoryCaches(restaurant._id, {
      items: true,
      purchases: true,
      analytics: true,
    })

    return res.json({
      deleted: true,
      purchaseDeleted: false,
      purchaseId: purchase._id,
      itemIndex,
      remainingItemCount: purchase.items.length,
    })
  } catch (error) {
    next(error)
  }
}

export async function upsertRecipe(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const menuItemId = String(req.body?.menuItemId || '').trim()
    const ingredients = normalizeRecipeIngredientRows(req.body?.ingredients)

    if (!menuItemId) {
      return res.status(400).json({ message: 'menuItemId is required' })
    }

    const menuItem = await MenuItem.findOne({
      _id: menuItemId,
      restaurantId: restaurant._id,
    })
      .select('_id name')
      .lean()

    if (!menuItem) {
      return res.status(400).json({ message: 'Menu item not found for this restaurant' })
    }

    if (!ingredients.length) {
      return res.status(400).json({ message: 'At least one ingredient is required' })
    }

    const inventoryIngredientRows = ingredients.filter((row) => row.sourceType !== 'menu')
    const menuIngredientRows = ingredients.filter((row) => row.sourceType === 'menu')

    const invalidMenuUnit = menuIngredientRows.find(
      (row) => !['Unit', 'unit'].includes(String(row?.unit || '').trim()),
    )
    if (invalidMenuUnit) {
      return res.status(400).json({ message: 'Menu ingredients must use Unit as unit' })
    }

    const inventoryIds = [
      ...new Set(inventoryIngredientRows.map((row) => String(row.inventoryItemId || '').trim()).filter(Boolean)),
    ]
    if (inventoryIds.length) {
      const validInventoryItems = await InventoryItem.find({
        _id: { $in: inventoryIds },
        restaurantId: restaurant._id,
        isActive: true,
      })
        .select('_id')
        .lean()

      if (validInventoryItems.length !== inventoryIds.length) {
        return res.status(400).json({ message: 'One or more inventory ingredients are invalid for this restaurant' })
      }
    }

    const menuIngredientIds = [
      ...new Set(menuIngredientRows.map((row) => String(row.menuItemId || '').trim()).filter(Boolean)),
    ]
    if (menuIngredientIds.includes(menuItemId)) {
      return res.status(400).json({ message: 'A recipe cannot reference itself as menu ingredient' })
    }
    if (menuIngredientIds.length) {
      const validMenuIngredients = await MenuItem.find({
        _id: { $in: menuIngredientIds },
        restaurantId: restaurant._id,
      })
        .select('_id')
        .lean()
      if (validMenuIngredients.length !== menuIngredientIds.length) {
        return res.status(400).json({ message: 'One or more menu ingredients are invalid for this restaurant' })
      }
    }

    try {
      await assertNoRecipeDependencyCycle({
        restaurantId: restaurant._id,
        targetMenuItemId: menuItemId,
        nextMenuDependencyIds: menuIngredientIds,
      })
    } catch (cycleError) {
      return res.status(400).json({
        message: cycleError?.message || 'Recipe dependency cycle detected',
      })
    }

    let versionedIngredients = []
    try {
      versionedIngredients = await computeFlattenedVersionedIngredients({
        restaurantId: restaurant._id,
        menuItemId,
        ingredients,
      })
    } catch (resolutionError) {
      return res.status(400).json({
        message: resolutionError?.message || 'Failed to resolve menu ingredient recipes',
      })
    }

    if (!versionedIngredients.length) {
      return res.status(400).json({ message: 'At least one resolved inventory ingredient is required' })
    }

    const existingRecipe = await Recipe.findOne({
      restaurantId: restaurant._id,
      menuItemId,
    })

    let recipe = null
    let recipeVersion = null
    if (!existingRecipe) {
      recipe = await Recipe.create({
        restaurantId: restaurant._id,
        menuItemId,
        ingredients,
        version: 1,
      })

      recipeVersion = await RecipeVersion.findOneAndUpdate(
        {
          restaurantId: restaurant._id,
          menuItemId,
          version: 1,
        },
        {
          $setOnInsert: {
            restaurantId: restaurant._id,
            menuItemId,
            version: 1,
            ingredients: versionedIngredients,
            createdBy: req.user?._id || null,
          },
        },
        { upsert: true, returnDocument: 'after' },
      )
    } else {
      existingRecipe.ingredients = ingredients
      existingRecipe.version = Math.max(1, Number(existingRecipe.version || 1) + 1)
      recipe = await existingRecipe.save()

      recipeVersion = await RecipeVersion.findOneAndUpdate(
        {
          restaurantId: restaurant._id,
          menuItemId,
          version: Number(recipe.version || 1),
        },
        {
          $setOnInsert: {
            restaurantId: restaurant._id,
            menuItemId,
            version: Number(recipe.version || 1),
            ingredients: versionedIngredients,
            createdBy: req.user?._id || null,
          },
        },
        { upsert: true, returnDocument: 'after' },
      )
    }

    await invalidateInventoryCaches(restaurant._id, {
      recipes: true,
      analytics: true,
    })

    invalidateRecipeVersionRuntimeCache({
      restaurantId: restaurant._id,
      menuItemIds: [menuItemId],
    })
    scheduleAncestorRecipeRefresh({
      restaurantId: restaurant._id,
      changedMenuItemId: menuItemId,
      createdBy: req.user?._id || null,
    })

    const recipePayload = recipe?.toObject ? recipe.toObject() : recipe
    if (recipeVersion?._id) {
      recipePayload.latestRecipeVersionId = recipeVersion._id
      recipePayload.latestRecipeVersion = Number(recipeVersion.version || recipePayload.version || 1)
    }

    return res.status(201).json(recipePayload)
  } catch (error) {
    if (error?.name === 'ValidationError' || error?.name === 'CastError') {
      return res.status(400).json({
        message: error?.message || 'Recipe validation failed',
      })
    }
    next(error)
  }
}

export async function listRecipes(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const recipes = await Recipe.find({ restaurantId: restaurant._id })
      .sort({ updatedAt: -1 })
      .select('_id menuItemId ingredients version createdAt updatedAt')
      .lean()

    return res.json({ recipes })
  } catch (error) {
    next(error)
  }
}

export async function getInventoryAnalyticsOverview(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const restaurantId = String(restaurant._id)
    const fresh = readInventoryAnalyticsHot(restaurantId)
    if (fresh) {
      res.set('X-Inventory-Analytics-Cache', 'hot')
      return res.json(fresh)
    }

    const stale = readInventoryAnalyticsSnapshot(restaurantId)
    if (INVENTORY_ANALYTICS_ASYNC_CACHE_ONLY) {
      scheduleInventoryAnalyticsRefresh(restaurantId)

      if (stale) {
        res.set('X-Inventory-Analytics-Cache', 'stale')
        return res.json(stale)
      }

      res.locals.skipResponseCache = true
      return res.status(202).json({ status: 'processing', data: null })
    }

    const payload = await buildInventoryAnalyticsOverviewPayload(restaurantId)
    writeInventoryAnalyticsCache(restaurantId, payload)
    return res.json(payload)
  } catch (error) {
    next(error)
  }
}

export async function createInventoryWastage(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const inventoryItemId = String(req.body?.inventoryItemId || '').trim()
    const quantity = safeNumber(req.body?.quantity)
    const unit = String(req.body?.unit || '').trim()
    const reason = String(req.body?.reason || '').trim()

    if (!inventoryItemId || quantity <= 0 || !unit) {
      return res.status(400).json({ message: 'inventoryItemId, quantity and unit are required' })
    }

    await addLedgerEntries(
      [
        {
          restaurantId: restaurant._id,
          inventoryItemId,
          type: 'WASTAGE',
          quantity,
          direction: -1,
          unit,
          referenceType: 'wastage',
          referenceId: null,
          metadata: { reason },
          createdBy: req.user?._id || null,
        },
      ],
      {},
    )

    await invalidateInventoryCaches(restaurant._id, {
      items: true,
      analytics: true,
    })

    return res.status(201).json({ success: true })
  } catch (error) {
    next(error)
  }
}

export async function createInventoryConversion(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const fromInventoryItemId = String(req.body?.fromInventoryItemId || '').trim()
    const fromQuantity = safeNumber(req.body?.fromQuantity)
    const fromUnit = String(req.body?.fromUnit || '').trim()

    const toInventoryItemId = String(req.body?.toInventoryItemId || '').trim()
    const toQuantity = safeNumber(req.body?.toQuantity)
    const toUnit = String(req.body?.toUnit || '').trim()

    const note = String(req.body?.note || '').trim()

    if (!fromInventoryItemId || !toInventoryItemId) {
      return res.status(400).json({ message: 'fromInventoryItemId and toInventoryItemId are required' })
    }

    if (fromQuantity <= 0 || toQuantity <= 0) {
      return res.status(400).json({ message: 'fromQuantity and toQuantity must be greater than 0' })
    }

    if (!fromUnit || !toUnit) {
      return res.status(400).json({ message: 'fromUnit and toUnit are required' })
    }

    const conversionReference = new mongoose.Types.ObjectId()

    await addLedgerEntries(
      [
        {
          restaurantId: restaurant._id,
          inventoryItemId: fromInventoryItemId,
          type: 'CONVERSION_OUT',
          quantity: fromQuantity,
          direction: -1,
          unit: fromUnit,
          referenceType: 'conversion',
          referenceId: conversionReference,
          metadata: {
            direction: 'from',
            toInventoryItemId,
            toQuantity,
            toUnit,
            note,
          },
          createdBy: req.user?._id || null,
        },
        {
          restaurantId: restaurant._id,
          inventoryItemId: toInventoryItemId,
          type: 'CONVERSION_IN',
          quantity: toQuantity,
          direction: 1,
          unit: toUnit,
          referenceType: 'conversion',
          referenceId: conversionReference,
          metadata: {
            direction: 'to',
            fromInventoryItemId,
            fromQuantity,
            fromUnit,
            note,
          },
          createdBy: req.user?._id || null,
        },
      ],
      {},
    )

    await invalidateInventoryCaches(restaurant._id, {
      items: true,
      analytics: true,
    })

    return res.status(201).json({ success: true, conversionId: conversionReference })
  } catch (error) {
    next(error)
  }
}

export async function getInventoryItemStock(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const inventoryItemId = String(req.params?.inventoryItemId || '').trim()
    if (!inventoryItemId) {
      return res.status(400).json({ message: 'inventoryItemId is required' })
    }

    const stock = await getCurrentStock({
      inventoryItemId,
      restaurantId: restaurant._id,
      preferCached: req.query?.source !== 'ledger',
    })

    return res.json(stock)
  } catch (error) {
    next(error)
  }
}

export async function bootstrapInventoryStock(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const mode = String(req.body?.mode || 'bootstrap_and_reconcile').trim()
    const inventoryItemId = String(req.body?.inventoryItemId || '').trim() || null
    let bootstrapResult = null
    let reconcileResult = null

    if (mode !== 'reconcile_only') {
      bootstrapResult = await bootstrapStockFromSavedPurchases({
        restaurantId: restaurant._id,
        createdBy: req.user?._id || null,
        batchSize: Number(req.body?.batchSize || 200),
        inventoryItemId,
      })
    }

    if (mode !== 'bootstrap_only') {
      reconcileResult = await reconcileStockFromSavedPurchases({
        restaurantId: restaurant._id,
        createdBy: req.user?._id || null,
        inventoryItemId,
      })
    }

    await invalidateInventoryCaches(restaurant._id, {
      items: true,
      purchases: true,
      analytics: true,
    })

    return res.json({
      success: true,
      summary: {
        mode,
        bootstrap: bootstrapResult,
        reconcile: reconcileResult,
      },
      message: 'Inventory stock sync completed',
    })
  } catch (error) {
    next(error)
  }
}
