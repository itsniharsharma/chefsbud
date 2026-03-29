/**
 * Archive Service
 * Manages archival of old orders to Azure Blob Storage
 * Designed for:
 * - Reducing MongoDB storage costs
 * - Creating cold storage backup
 * - Maintaining query performance for hot data
 *
 * Safety features:
 * - Idempotent (won't re-archive already archived orders)
 * - Batch processing (configurable size)
 * - Retry logic with exponential backoff
 * - Comprehensive logging
 */

import { BlobServiceClient } from '@azure/storage-blob'
import Order from '../models/Order.js'
import { logger } from '../utils/logger.js'
import config from '../config/dataLifecycle.js'

let blobServiceClient = null

/**
 * Initialize Azure Blob Storage client
 */
const initializeBlobClient = () => {
  if (blobServiceClient) return
  
  if (!config.azure.connectionString) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING not configured')
  }
  
  try {
    blobServiceClient = BlobServiceClient.fromConnectionString(
      config.azure.connectionString,
    )
    logger.info('Azure Blob Storage client initialized')
  } catch (error) {
    logger.error('Failed to initialize Azure Blob client', { error: error.message })
    throw error
  }
}

/**
 * Generate blob path for archived orders
 * Format: orders-archive/restaurantId/YYYY/MM/DD.json
 */
const generateBlobPath = (restaurantId, date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  
  return `${config.azure.archivePath}/${restaurantId}/${year}/${month}/${day}.json`
}

/**
 * Upload orders to Azure Blob Storage
 * Groups orders by restaurantId and date
 */
const uploadOrdersToBlobStorage = async (orders) => {
  if (!orders || orders.length === 0) {
    return { uploaded: 0, failed: 0, errors: [], uploadedOrderIds: [] }
  }
  
  initializeBlobClient()
  
  // Group orders by restaurantId and date
  const groupedOrders = orders.reduce((acc, order) => {
    const dateKey = `${order.restaurantId}_${order.createdAt.toISOString().split('T')[0]}`
    if (!acc[dateKey]) {
      acc[dateKey] = []
    }
    acc[dateKey].push(order)
    return acc
  }, {})
  
  const containerClient = blobServiceClient.getContainerClient(config.azure.containerName)
  
  let uploaded = 0
  let failed = 0
  const errors = []
  const uploadedOrderIds = []
  
  try {
    await containerClient.createIfNotExists()
  } catch (error) {
    const msg = `Failed to ensure container exists: ${error.message}`
    logger.error(msg)
    errors.push(msg)
    return { uploaded, failed, errors, uploadedOrderIds }
  }
  
  // Upload each group
  for (const [groupKey, groupOrders] of Object.entries(groupedOrders)) {
    try {
      const [restaurantId, dateStr] = groupKey.split('_')
      const blobPath = generateBlobPath(restaurantId, new Date(dateStr))
      const blobClient = containerClient.getBlockBlobClient(blobPath)
      
      // Prepare data: include only necessary fields
      const archiveData = {
        archived_at: new Date().toISOString(),
        order_count: groupOrders.length,
        orders: groupOrders.map((order) => ({
          _id: order._id,
          restaurantId: order.restaurantId,
          orderId: order._id.toString(),
          totalAmount: order.totalAmount,
          status: order.orderStatus,
          createdAt: order.createdAt,
          completedAt: order.completedAt,
          paymentStatus: order.paymentStatus,
          items: order.items,
        })),
      }
      
      const data = JSON.stringify(archiveData)
      await blobClient.upload(Buffer.from(data), data.length)
      
      uploaded += groupOrders.length
      uploadedOrderIds.push(...groupOrders.map((order) => order._id))
      logger.info('Orders archived to blob storage', {
        path: blobPath,
        count: groupOrders.length,
        restaurantId,
      })
    } catch (error) {
      failed += groupOrders.length
      const msg = `Failed to upload group ${groupKey}: ${error.message}`
      logger.error(msg)
      errors.push(msg)
    }
  }
  
  return { uploaded, failed, errors, uploadedOrderIds }
}

/**
 * Archive old orders to Azure Blob Storage
 * Main entry point for archival process
 *
 * Process:
 * 1. Find orders older than ARCHIVE_AFTER_DAYS
 * 2. Verify not already archived
 * 3. Upload to Azure Blob Storage
 * 4. Mark as archived in MongoDB (set isArchived = true)
 * 5. Log results
 */
const archiveOldOrders = async () => {
  const startTime = Date.now()
  
  try {
    if (!config.archive.enabled) {
      logger.info('Order archival is disabled in configuration')
      return { status: 'disabled', message: 'Archive job disabled' }
    }
    
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - config.archive.afterDays)
    
    logger.info('Starting order archival', {
      cutoffDate: cutoffDate.toISOString(),
      batchSize: config.archive.batchSize,
    })
    
    let totalProcessed = 0
    let totalArchived = 0
    let totalFailed = 0
    const allErrors = []
    
    // Process in batches
    let batch = 0
    let hasMore = true
    
    while (hasMore) {
      batch++
      
      try {
        // Find orders to archive (only Completed orders, not already archived)
        const ordersToArchive = await Order.find({
          createdAt: { $lt: cutoffDate },
          isArchived: false,
          orderStatus: 'Completed',
        })
          .select([
            '_id',
            'restaurantId',
            'totalAmount',
            'orderStatus',
            'createdAt',
            'completedAt',
            'paymentStatus',
            'items',
          ])
          .limit(config.archive.batchSize)
          .lean()
          .exec()
        
        if (ordersToArchive.length === 0) {
          hasMore = false
          break
        }
        
        logger.info('Archival batch starting', {
          batch,
          orderCount: ordersToArchive.length,
        })
        
        // Upload to blob storage with retry logic
        let attempt = 0
        let blobResult = null
        
        while (attempt < config.archive.maxRetries) {
          try {
            blobResult = await uploadOrdersToBlobStorage(ordersToArchive)
            if (blobResult.uploaded > 0) {
              break
            }
          } catch {
            attempt++
            if (attempt < config.archive.maxRetries) {
              await new Promise((resolve) =>
                setTimeout(resolve, config.archive.retryDelayMs * attempt),
              )
            }
          }
        }
        
        if (!blobResult) {
          logger.error('Failed to upload batch after all retries', { batch })
          hasMore = false
          allErrors.push(`Batch ${batch}: Failed after ${config.archive.maxRetries} retries`)
          continue
        }
        
        let updateResult = { modifiedCount: 0 }
        const uploadedOrderIds = Array.isArray(blobResult.uploadedOrderIds)
          ? blobResult.uploadedOrderIds
          : []

        // Mark only successfully uploaded orders as archived.
        if (uploadedOrderIds.length > 0) {
          updateResult = await Order.updateMany(
            { _id: { $in: uploadedOrderIds } },
            {
              isArchived: true,
              archivedAt: new Date(),
              archiveKey: `${batch}_${Date.now()}`,
            },
          )
        }
        
        totalProcessed += ordersToArchive.length
        totalArchived += updateResult.modifiedCount || 0
        totalFailed += blobResult.failed
        allErrors.push(...blobResult.errors)
        
        logger.info('Archival batch completed', {
          batch,
          uploaded: blobResult.uploaded,
          failed: blobResult.failed,
          mongoUpdated: updateResult.modifiedCount,
        })
        
        // Check if we've hit max documents threshold
        if (totalProcessed >= config.safety.maxDocumentsPerOperation) {
          hasMore = false
          logger.warn('Archival stopped: reached max documents per operation', {
            maxLimit: config.safety.maxDocumentsPerOperation,
            processed: totalProcessed,
          })
        }
      } catch (batchError) {
        logger.error('Error processing archival batch', {
          batch,
          error: batchError.message,
        })
        
        allErrors.push(`Batch ${batch}: ${batchError.message}`)
        
        // Stop on critical errors (e.g., database connection)
        if (batchError.message.includes('connection')) {
          hasMore = false
        }
      }
    }
    
    const duration = Date.now() - startTime
    
    logger.info('Order archival completed', {
      totalProcessed,
      totalArchived,
      totalFailed,
      duration: `${duration}ms`,
      errorCount: allErrors.length,
    })
    
    return {
      status: 'success',
      totalProcessed,
      totalArchived,
      totalFailed,
      duration,
      errors: allErrors,
    }
  } catch (error) {
    logger.error('Critical error in archival service', {
      error: error.message,
      stack: error.stack,
    })
    
    return {
      status: 'failed',
      error: error.message,
      timestamp: new Date().toISOString(),
    }
  }
}

/**
 * Purge archived orders from MongoDB after a safety retention window.
 * Conditions:
 * - isArchived = true
 * - archivedAt exists and older than configured cutoff
 * - archiveKey exists and non-empty
 * - orderStatus = Completed
 */
const purgeArchivedOrders = async (batchSize = config.purge.batchSize) => {
  const startTime = Date.now()

  try {
    if (!config.purge.enabled) {
      logger.info('Order purge is disabled in configuration')
      return { status: 'disabled', message: 'Purge job disabled' }
    }

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - Math.max(0, Number(config.purge.deleteAfterArchiveDays || 0)))

    const safeBatchSize = Math.max(
      1,
      Math.min(Number(batchSize || config.purge.batchSize || 500), config.safety.maxDocumentsPerOperation),
    )

    let totalDeleted = 0
    let totalProcessed = 0
    let batch = 0
    let hasMore = true

    while (hasMore) {
      const elapsed = Date.now() - startTime
      if (elapsed >= config.purge.maxDurationMs) {
        logger.warn('Order purge stopped due to max duration', {
          elapsed,
          maxDurationMs: config.purge.maxDurationMs,
          totalDeleted,
        })
        break
      }

      batch += 1

      const candidates = await Order.find({
        isArchived: true,
        archivedAt: { $exists: true, $lte: cutoffDate },
        archiveKey: { $exists: true, $ne: '' },
        orderStatus: 'Completed',
      })
        .select('_id')
        .sort({ _id: 1 })
        .limit(safeBatchSize)
        .lean()
        .exec()

      if (candidates.length === 0) {
        hasMore = false
        break
      }

      const ids = candidates.map((row) => row._id)
      totalProcessed += ids.length

      if (config.purge.dryRun) {
        totalDeleted += ids.length
        logger.info('purged_orders_batch', {
          batch,
          count: ids.length,
          dryRun: true,
        })
      } else {
        const result = await Order.deleteMany({
          _id: { $in: ids },
          isArchived: true,
          archivedAt: { $exists: true, $lte: cutoffDate },
          archiveKey: { $exists: true, $ne: '' },
          orderStatus: 'Completed',
        })

        totalDeleted += result.deletedCount || 0
        logger.info('purged_orders_batch', {
          batch,
          count: result.deletedCount || 0,
          dryRun: false,
        })
      }

      if (totalProcessed >= config.safety.maxDocumentsPerOperation) {
        logger.warn('Order purge stopped: reached max documents per operation', {
          maxLimit: config.safety.maxDocumentsPerOperation,
          processed: totalProcessed,
        })
        break
      }
    }

    const duration = Date.now() - startTime
    logger.info('purge_completed', {
      totalDeleted,
      batches: batch,
      durationMs: duration,
      dryRun: config.purge.dryRun,
      cutoffDate: cutoffDate.toISOString(),
    })

    return {
      status: 'success',
      totalDeleted,
      batches: batch,
      duration,
      dryRun: config.purge.dryRun,
      cutoffDate: cutoffDate.toISOString(),
    }
  } catch (error) {
    logger.error('Critical error in purge service', {
      error: error.message,
      stack: error.stack,
    })

    return {
      status: 'failed',
      error: error.message,
      timestamp: new Date().toISOString(),
    }
  }
}

/**
 * Get archive statistics
 * Returns count of archived vs. active orders per restaurant
 */
const getArchiveStats = async (restaurantId) => {
  try {
    const [archived, active] = await Promise.all([
      Order.countDocuments({
        restaurantId,
        isArchived: true,
      }),
      Order.countDocuments({
        restaurantId,
        isArchived: false,
      }),
    ])
    
    return {
      restaurantId,
      archived,
      active,
      archivePercentage: ((archived / (archived + active)) * 100).toFixed(2),
    }
  } catch (error) {
    logger.error('Failed to fetch archive stats', {
      restaurantId,
      error: error.message,
    })
    throw error
  }
}

export { archiveOldOrders, purgeArchivedOrders, getArchiveStats, uploadOrdersToBlobStorage }
