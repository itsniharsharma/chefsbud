import mongoose from 'mongoose'
import { BlobServiceClient } from '@azure/storage-blob'
import { randomUUID } from 'crypto'
import { createHash } from 'crypto'
import config from '../config/dataLifecycle.js'
import InventoryLedger from '../models/InventoryLedger.js'
import InventoryDailySummary from '../models/InventoryDailySummary.js'
import InventoryMonthlySummary from '../models/InventoryMonthlySummary.js'
import InventoryRollupJobState from '../models/InventoryRollupJobState.js'
import { logger } from '../utils/logger.js'

/**
 * Phase 1: Generate unique UUID v4 for archive job run
 * Ensures blob paths never collide/overwrite
 */
const generateRunId = () => randomUUID()

function round6(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1_000_000) / 1_000_000
}

function startOfUtcDay(dateLike = new Date()) {
  const date = new Date(dateLike)
  date.setUTCHours(0, 0, 0, 0)
  return date
}

function addUtcDays(dateLike, days) {
  const date = new Date(dateLike)
  date.setUTCDate(date.getUTCDate() + Number(days || 0))
  return date
}

function startOfUtcMonth(dateLike = new Date()) {
  const date = new Date(dateLike)
  date.setUTCDate(1)
  date.setUTCHours(0, 0, 0, 0)
  return date
}

function addUtcMonths(dateLike, months) {
  const date = new Date(dateLike)
  date.setUTCMonth(date.getUTCMonth() + Number(months || 0))
  return date
}

function toDateKey(dateLike) {
  return startOfUtcDay(dateLike).toISOString().slice(0, 10)
}

async function updateRollupState({ jobType, windowKey, status, rowCount = 0, checksum = '', errorMessage = '', runId = '', lockOwner = '', payload = null }) {
  const now = new Date()
  const update = {
    status,
    rowCount: Number(rowCount || 0),
    checksum: String(checksum || ''),
    errorMessage: String(errorMessage || '').slice(0, 1000),
  }

  // Phase 1: Track runId and lockOwner for audit trail
  if (runId) {
    update.runId = String(runId).slice(0, 100)
  }
  if (lockOwner) {
    update.lockOwner = String(lockOwner).slice(0, 100)
  }
  if (payload) {
    update.payload = payload
  }

  if (status === 'processing') {
    update.startedAt = now
    update.completedAt = null
  }

  if (status === 'completed' || status === 'failed') {
    update.completedAt = now
    update.startedAt = now
  }

  await InventoryRollupJobState.updateOne(
    { jobType, windowKey },
    { $set: update },
    { upsert: true },
  )
}

async function rollupSingleDay(dayStart, dayEnd, { retentionDays = 90 } = {}) {
  const dateKey = toDateKey(dayStart)
  const windowKey = `${dateKey}`
  const now = new Date()

  await updateRollupState({
    jobType: 'inventory_daily_rollup',
    windowKey,
    status: 'processing',
  })

  try {
    const rows = await InventoryLedger.aggregate([
      {
        $match: {
          createdAt: { $gte: dayStart, $lt: dayEnd },
        },
      },
      {
        $group: {
          _id: {
            restaurantId: '$restaurantId',
            inventoryItemId: '$inventoryItemId',
          },
          unit: { $first: '$unit' },
          purchaseQty: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$type', 'PURCHASE'] }, { $eq: ['$direction', 1] }] }, '$quantity', 0],
            },
          },
          consumptionQty: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$type', 'CONSUMPTION'] }, { $eq: ['$direction', -1] }] }, '$quantity', 0],
            },
          },
          wastageQty: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$type', 'WASTAGE'] }, { $eq: ['$direction', -1] }] }, '$quantity', 0],
            },
          },
          adjustmentInQty: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$type', 'ADJUSTMENT'] }, { $eq: ['$direction', 1] }] }, '$quantity', 0],
            },
          },
          adjustmentOutQty: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$type', 'ADJUSTMENT'] }, { $eq: ['$direction', -1] }] }, '$quantity', 0],
            },
          },
          conversionInQty: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$type', 'CONVERSION_IN'] }, { $eq: ['$direction', 1] }] }, '$quantity', 0],
            },
          },
          conversionOutQty: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$type', 'CONVERSION_OUT'] }, { $eq: ['$direction', -1] }] }, '$quantity', 0],
            },
          },
          reservationQty: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$type', 'RESERVATION'] }, { $eq: ['$direction', -1] }] }, '$quantity', 0],
            },
          },
          releaseQty: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$type', 'RELEASE'] }, { $eq: ['$direction', 1] }] }, '$quantity', 0],
            },
          },
          transferInQty: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$type', 'TRANSFER_IN'] }, { $eq: ['$direction', 1] }] }, '$quantity', 0],
            },
          },
          transferOutQty: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$type', 'TRANSFER_OUT'] }, { $eq: ['$direction', -1] }] }, '$quantity', 0],
            },
          },
          netChangeQty: {
            $sum: {
              $multiply: ['$quantity', '$direction'],
            },
          },
          ledgerEntryCount: { $sum: 1 },
        },
      },
    ])

    const expiresAt = addUtcDays(dayStart, retentionDays)
    const docs = rows.map((row) => ({
      restaurantId: row?._id?.restaurantId,
      inventoryItemId: row?._id?.inventoryItemId,
      date: dayStart,
      dateKey,
      unit: String(row?.unit || 'unit'),
      purchaseQty: round6(row?.purchaseQty || 0),
      consumptionQty: round6(row?.consumptionQty || 0),
      wastageQty: round6(row?.wastageQty || 0),
      adjustmentInQty: round6(row?.adjustmentInQty || 0),
      adjustmentOutQty: round6(row?.adjustmentOutQty || 0),
      conversionInQty: round6(row?.conversionInQty || 0),
      conversionOutQty: round6(row?.conversionOutQty || 0),
      reservationQty: round6(row?.reservationQty || 0),
      releaseQty: round6(row?.releaseQty || 0),
      transferInQty: round6(row?.transferInQty || 0),
      transferOutQty: round6(row?.transferOutQty || 0),
      netChangeQty: round6(row?.netChangeQty || 0),
      ledgerEntryCount: Number(row?.ledgerEntryCount || 0),
      sourceWindowStart: dayStart,
      sourceWindowEnd: dayEnd,
      rolledUpAt: now,
      expiresAt,
    }))

    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        await InventoryDailySummary.deleteMany({ dateKey }).session(session)
        if (docs.length) {
          await InventoryDailySummary.insertMany(docs, { session, ordered: false })
        }
      })
    } finally {
      session.endSession()
    }

    await updateRollupState({
      jobType: 'inventory_daily_rollup',
      windowKey,
      status: 'completed',
      rowCount: docs.length,
      checksum: `${dateKey}:${docs.length}`,
    })

    return {
      dateKey,
      rowCount: docs.length,
      sourceCount: rows.length,
    }
  } catch (error) {
    await updateRollupState({
      jobType: 'inventory_daily_rollup',
      windowKey,
      status: 'failed',
      errorMessage: error?.message || 'daily_rollup_failed',
    })
    throw error
  }
}

export async function rollupInventoryLedgerToDaily() {
  const enabled = String(process.env.INVENTORY_LEDGER_SUMMARY_ENABLED || 'true').trim().toLowerCase() !== 'false'
  if (!enabled) {
    return { status: 'disabled', dailyWindows: 0 }
  }

  const lookbackDays = Math.max(1, Number(config.inventoryLifecycle.dailyRollupLookbackDays || 3))
  const retentionDays = Math.max(30, Number(config.inventoryLifecycle.dailySummaryRetentionDays || 90))

  const today = startOfUtcDay(new Date())
  const results = []

  for (let offset = lookbackDays; offset >= 1; offset -= 1) {
    const dayStart = addUtcDays(today, -offset)
    const dayEnd = addUtcDays(dayStart, 1)
    const result = await rollupSingleDay(dayStart, dayEnd, { retentionDays })
    results.push(result)
  }

  return {
    status: 'success',
    dailyWindows: results.length,
    rows: results.reduce((sum, row) => sum + Number(row.rowCount || 0), 0),
    windows: results,
  }
}

async function rollupSingleMonth(monthKey) {
  const windowKey = monthKey
  await updateRollupState({
    jobType: 'inventory_monthly_rollup',
    windowKey,
    status: 'processing',
  })

  try {
    const [year, month] = String(monthKey).split('-').map((value) => Number(value))
    const monthStartDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))

    const rows = await InventoryDailySummary.aggregate([
      {
        $match: {
          date: {
            $gte: monthStartDate,
            $lt: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
          },
        },
      },
      {
        $group: {
          _id: {
            restaurantId: '$restaurantId',
            inventoryItemId: '$inventoryItemId',
          },
          unit: { $first: '$unit' },
          purchaseQty: { $sum: '$purchaseQty' },
          consumptionQty: { $sum: '$consumptionQty' },
          wastageQty: { $sum: '$wastageQty' },
          adjustmentInQty: { $sum: '$adjustmentInQty' },
          adjustmentOutQty: { $sum: '$adjustmentOutQty' },
          conversionInQty: { $sum: '$conversionInQty' },
          conversionOutQty: { $sum: '$conversionOutQty' },
          reservationQty: { $sum: '$reservationQty' },
          releaseQty: { $sum: '$releaseQty' },
          transferInQty: { $sum: '$transferInQty' },
          transferOutQty: { $sum: '$transferOutQty' },
          netChangeQty: { $sum: '$netChangeQty' },
          ledgerEntryCount: { $sum: '$ledgerEntryCount' },
          sourceWindowStart: { $min: '$sourceWindowStart' },
          sourceWindowEnd: { $max: '$sourceWindowEnd' },
        },
      },
    ])

    const docs = rows.map((row) => ({
      restaurantId: row?._id?.restaurantId,
      inventoryItemId: row?._id?.inventoryItemId,
      month: monthKey,
      monthStartDate,
      unit: String(row?.unit || 'unit'),
      purchaseQty: round6(row?.purchaseQty || 0),
      consumptionQty: round6(row?.consumptionQty || 0),
      wastageQty: round6(row?.wastageQty || 0),
      adjustmentInQty: round6(row?.adjustmentInQty || 0),
      adjustmentOutQty: round6(row?.adjustmentOutQty || 0),
      conversionInQty: round6(row?.conversionInQty || 0),
      conversionOutQty: round6(row?.conversionOutQty || 0),
      reservationQty: round6(row?.reservationQty || 0),
      releaseQty: round6(row?.releaseQty || 0),
      transferInQty: round6(row?.transferInQty || 0),
      transferOutQty: round6(row?.transferOutQty || 0),
      netChangeQty: round6(row?.netChangeQty || 0),
      ledgerEntryCount: Number(row?.ledgerEntryCount || 0),
      sourceWindowStart: row?.sourceWindowStart || monthStartDate,
      sourceWindowEnd: row?.sourceWindowEnd || addUtcMonths(monthStartDate, 1),
      rolledUpAt: new Date(),
      archivedAt: null,
      archiveBlobPath: '',
    }))

    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        await InventoryMonthlySummary.deleteMany({ month: monthKey }).session(session)
        if (docs.length) {
          await InventoryMonthlySummary.insertMany(docs, { session, ordered: false })
        }
      })
    } finally {
      session.endSession()
    }

    await updateRollupState({
      jobType: 'inventory_monthly_rollup',
      windowKey,
      status: 'completed',
      rowCount: docs.length,
      checksum: `${monthKey}:${docs.length}`,
    })

    return {
      month: monthKey,
      rowCount: docs.length,
    }
  } catch (error) {
    await updateRollupState({
      jobType: 'inventory_monthly_rollup',
      windowKey,
      status: 'failed',
      errorMessage: error?.message || 'monthly_rollup_failed',
    })
    throw error
  }
}

export async function rollupInventoryDailyToMonthly() {
  const enabled = String(process.env.INVENTORY_LEDGER_SUMMARY_ENABLED || 'true').trim().toLowerCase() !== 'false'
  if (!enabled) {
    return { status: 'disabled', monthlyWindows: 0 }
  }

  const now = new Date()
  const currentMonthStart = startOfUtcMonth(now)
  const windowMonths = Math.max(3, Number(config.inventoryLifecycle.monthlyRebuildWindowMonths || 18))
  const fromDate = addUtcMonths(currentMonthStart, -windowMonths)

  const monthKeys = await InventoryDailySummary.aggregate([
    {
      $match: {
        date: { $gte: fromDate, $lt: currentMonthStart },
      },
    },
    {
      $group: {
        _id: {
          monthKey: {
            $dateToString: {
              format: '%Y-%m',
              date: '$date',
            },
          },
        },
      },
    },
    { $sort: { '_id.monthKey': 1 } },
  ])

  const results = []
  for (const row of monthKeys) {
    const monthKey = String(row?._id?.monthKey || '')
    if (!monthKey) continue
    const result = await rollupSingleMonth(monthKey)
    results.push(result)
  }

  return {
    status: 'success',
    monthlyWindows: results.length,
    rows: results.reduce((sum, row) => sum + Number(row.rowCount || 0), 0),
    windows: results,
  }
}

let blobServiceClient = null

function getInventoryArchiveClient() {
  if (blobServiceClient) return blobServiceClient
  if (!config.azure.connectionString) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING not configured')
  }
  blobServiceClient = BlobServiceClient.fromConnectionString(config.azure.connectionString)
  return blobServiceClient
}

function buildInventoryMonthlyBlobPath(restaurantId, monthKey, runId) {
  const basePath = String(config.azure.inventoryArchivePath || 'inventory-monthly-archive').replace(/\/$/, '')
  // Phase 1: Include runId to prevent overwrites
  if (runId) {
    return `${basePath}/${String(restaurantId)}/${String(monthKey)}/run-${String(runId)}/data.json`
  }
  // Fallback for backward compatibility
  return `${basePath}/${String(restaurantId)}/${String(monthKey)}.json`
}

/**
 * Phase 1: Generate manifest blob path for archive verification
 */
function buildInventoryMonthlyManifestPath(restaurantId, monthKey, runId) {
  const basePath = String(config.azure.inventoryArchivePath || 'inventory-monthly-archive').replace(/\/$/, '')
  return `${basePath}/${String(restaurantId)}/${String(monthKey)}/run-${String(runId)}/manifest.json`
}

/**
 * Phase 1: Calculate SHA256 checksum of aggregated inventory payload
 */
function calculateInventoryChecksum(aggregates) {
  const hash = createHash('sha256')
  hash.update(JSON.stringify(aggregates, null, 0))
  return hash.digest('hex')
}

/**
 * Phase 1: Build manifest for inventory archive
 */
function buildInventoryArchiveManifest(restaurantId, monthKey, runId, docCount, checksum) {
  return {
    runId,
    restaurantId,
    month: monthKey,
    timestamp: new Date().toISOString(),
    recordCount: docCount,
    checksum,
    status: 'completed',
  }
}

export async function archiveOldInventoryMonthlySummaries() {
  const enabled = String(config.inventoryLifecycle.monthlyArchiveEnabled || 'false').trim().toLowerCase() === 'true'
  if (!enabled) {
    return { status: 'disabled', archivedGroups: 0, deletedDocs: 0 }
  }

  const archiveAfterMonths = Math.max(6, Number(config.inventoryLifecycle.monthlyArchiveAfterMonths || 12))
  const nowMonth = startOfUtcMonth(new Date())
  const cutoffMonth = addUtcMonths(nowMonth, -archiveAfterMonths)
  const batchSize = Math.max(100, Number(config.inventoryLifecycle.monthlyArchiveBatchSize || 5000))
  
  // Phase 1: Generate unique runId for this archive job invocation
  const runId = generateRunId()

  const candidates = await InventoryMonthlySummary.find({
    monthStartDate: { $lt: cutoffMonth },
  })
    .sort({ monthStartDate: 1, restaurantId: 1, inventoryItemId: 1 })
    .limit(batchSize)
    .lean()

  if (!candidates.length) {
    return { status: 'success', archivedGroups: 0, deletedDocs: 0 }
  }

  const groups = new Map()
  for (const row of candidates) {
    const restaurantId = String(row?.restaurantId || '')
    const month = String(row?.month || '')
    if (!restaurantId || !month) continue
    const key = `${restaurantId}:${month}`
    if (!groups.has(key)) {
      groups.set(key, {
        restaurantId,
        month,
        docs: [],
      })
    }
    groups.get(key).docs.push(row)
  }

  const client = getInventoryArchiveClient()
  const containerName = String(config.azure.inventoryContainerName || 'inventory-archive')
  const containerClient = client.getContainerClient(containerName)
  await containerClient.createIfNotExists()

  let archivedGroups = 0
  let deletedDocs = 0

  for (const group of groups.values()) {
    const windowKey = `${group.restaurantId}:${group.month}`
    await updateRollupState({
      jobType: 'inventory_monthly_archive',
      windowKey,
      status: 'processing',
      runId, // Phase 1: track runId
    })

    try {
      // Phase 1: Pass runId to generate unique blob path
      const blobPath = buildInventoryMonthlyBlobPath(group.restaurantId, group.month, runId)
      const blobClient = containerClient.getBlockBlobClient(blobPath)
      
      const payload = {
        archivedAt: new Date().toISOString(),
        restaurantId: group.restaurantId,
        month: group.month,
        rowCount: group.docs.length,
        rows: group.docs,
      }

      // Phase 1: Calculate checksum for integrity verification
      const checksum = calculateInventoryChecksum(payload)
      const content = JSON.stringify(payload)
      
      await blobClient.uploadData(Buffer.from(content), {
        blobHTTPHeaders: {
          blobContentType: 'application/json',
        },
      })

      // Phase 1: Upload manifest file for verification and audit trail
      const manifest = buildInventoryArchiveManifest(group.restaurantId, group.month, runId, group.docs.length, checksum)
      const manifestPath = buildInventoryMonthlyManifestPath(group.restaurantId, group.month, runId)
      const manifestClient = containerClient.getBlockBlobClient(manifestPath)
      await manifestClient.uploadData(Buffer.from(JSON.stringify(manifest, null, 2)), {
        blobHTTPHeaders: {
          blobContentType: 'application/json',
        },
      })

      // Delete from MongoDB only after successful blob uploads
      const ids = group.docs.map((row) => row._id)
      const deleteResult = await InventoryMonthlySummary.deleteMany({ _id: { $in: ids } })
      const removed = Number(deleteResult?.deletedCount || 0)

      deletedDocs += removed
      archivedGroups += 1

      await updateRollupState({
        jobType: 'inventory_monthly_archive',
        windowKey,
        status: 'completed',
        rowCount: removed,
        checksum, // Phase 1: store actual payload checksum
        runId, // Phase 1: track runId
      })
    } catch (error) {
      await updateRollupState({
        jobType: 'inventory_monthly_archive',
        windowKey,
        status: 'failed',
        errorMessage: error?.message || 'inventory_monthly_archive_failed',
        runId, // Phase 1: track runId even on failure
      })
      logger.error('inventory_monthly_archive_failed', {
        restaurantId: group.restaurantId,
        month: group.month,
        runId, // Phase 1: log runId for debugging
        error: error?.message,
      })
    }
  }

  return {
    status: 'success',
    archivedGroups,
    deletedDocs,
  }
}

export async function runInventoryLedgerLifecycleCycle() {
  const startedAt = Date.now()

  const daily = await rollupInventoryLedgerToDaily()
  const monthly = await rollupInventoryDailyToMonthly()
  const archive = await archiveOldInventoryMonthlySummaries()

  return {
    status: 'success',
    durationMs: Date.now() - startedAt,
    daily,
    monthly,
    archive,
  }
}
