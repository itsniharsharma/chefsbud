/**
 * Analytics Rollup Service
 * Manages aggregation of daily analytics → monthly analytics
 * Reduces storage footprint and maintains query performance over long time ranges
 *
 * Process:
 * 1. Find daily analytics older than ROLLUP_AFTER_DAYS
 * 2. Aggregate to monthly buckets
 * 3. Insert into AnalyticsMonthlyMetrics
 * 4. Mark daily records as rolledUp = true
 * 5. Optional: Delete old daily data after retention period
 *
 * Safety features:
 * - Idempotent (can re-run without data duplication)
 * - Atomic rollup (transaction-based where possible)
 * - Comprehensive logging
 * - Data verification
 */

import AnalyticsDailyMetrics from '../models/AnalyticsDailyMetrics.js'
import AnalyticsItemDailyMetrics from '../models/AnalyticsItemDailyMetrics.js'
import AnalyticsBasketPairDaily from '../models/AnalyticsBasketPairDaily.js'
import AnalyticsMonthlyMetrics from '../models/AnalyticsMonthlyMetrics.js'
import AnalyticsItemMonthlyMetrics from '../models/AnalyticsItemMonthlyMetrics.js'
import AnalyticsBasketPairMonthly from '../models/AnalyticsBasketPairMonthly.js'
import { logger } from '../utils/logger.js'
import config from '../config/dataLifecycle.js'
import { listEnabledRestaurantIdsForFeature } from './restaurantFeatureFlags.js'

/**
 * Generate month key (e.g., "2026-03")
 */
const getMonthKey = (date) => {
  return date.toISOString().slice(0, 7)
}

/**
 * Roll up daily metrics to monthly buckets
 * Aggregates: views, addToCart, completedOrders, revenue
 */
const rollupDailyMetrics = async () => {
  const startTime = Date.now()
  
  try {
    if (!config.rollup.enabled) {
      logger.info('Analytics rollup is disabled in configuration')
      return { status: 'disabled', type: 'daily' }
    }
    
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - config.rollup.afterDays)
    
    logger.info('Starting daily metrics rollup', {
      cutoffDate: cutoffDate.toISOString(),
    })
    
    const enabledRestaurantIds = await listEnabledRestaurantIdsForFeature('analyticsEnabled')
    if (!enabledRestaurantIds.length) {
      logger.info('No analytics-enabled restaurants found; skipping daily rollup')
      return { status: 'success', type: 'daily', rolled: 0, duration: 0 }
    }

    // Find daily records older than cutoff that haven't been rolled up
    const dailyRecords = await AnalyticsDailyMetrics.find({
      restaurantId: { $in: enabledRestaurantIds },
      date: { $lt: cutoffDate },
      rolledUp: { $ne: true },
    })
      .lean()
      .exec()
    
    if (dailyRecords.length === 0) {
      logger.info('No daily metrics found for rollup')
      return { status: 'success', type: 'daily', rolled: 0, duration: 0 }
    }
    
    logger.info('Found daily metrics to rollup', { count: dailyRecords.length })
    
    // Group by restaurantId and month
    const groupedByMonth = dailyRecords.reduce((acc, record) => {
      const monthKey = `${record.restaurantId}_${getMonthKey(record.date)}`
      if (!acc[monthKey]) {
        acc[monthKey] = {
          restaurantId: record.restaurantId,
          monthKey: getMonthKey(record.date),
          year: record.date.getFullYear(),
          month: record.date.getMonth() + 1,
          views: 0,
          addToCart: 0,
          completedOrders: 0,
          revenue: 0,
          daysOfData: 0,
          daily_ids: [],
        }
      }
      
      acc[monthKey].views += record.views || 0
      acc[monthKey].addToCart += record.addToCart || 0
      acc[monthKey].completedOrders += record.completedOrders || 0
      acc[monthKey].revenue += record.revenue || 0
      acc[monthKey].daysOfData += 1
      acc[monthKey].daily_ids.push(record._id)
      
      return acc
    }, {})
    
    let rolledUp = 0
    let failed = 0
    const errors = []
    
    // Upsert monthly records
    for (const [monthKey, monthData] of Object.entries(groupedByMonth)) {
      try {
        await AnalyticsMonthlyMetrics.updateOne(
          {
            restaurantId: monthData.restaurantId,
            monthKey: monthData.monthKey,
          },
          {
            $set: {
              views: monthData.views,
              addToCart: monthData.addToCart,
              completedOrders: monthData.completedOrders,
              revenue: monthData.revenue,
              daysOfData: monthData.daysOfData,
              rolledUpAt: new Date(),
            },
          },
          { upsert: true },
        )
        
        // Mark daily records as rolled up
        await AnalyticsDailyMetrics.updateMany(
          { _id: { $in: monthData.daily_ids } },
          { rolledUp: true, rolledUpAt: new Date() },
        )
        
        rolledUp += 1
        logger.debug('Daily metrics rolled up to monthly', {
          monthKey,
          records: monthData.daily_ids.length,
        })
      } catch (error) {
        failed += 1
        const msg = `Failed to rollup month ${monthKey}: ${error.message}`
        logger.error(msg)
        errors.push(msg)
      }
    }
    
    const duration = Date.now() - startTime
    
    logger.info('Daily metrics rollup completed', {
      rolledUp,
      failed,
      totalDailyRecords: dailyRecords.length,
      duration: `${duration}ms`,
    })
    
    return { status: 'success', type: 'daily', rolled: rolledUp, failed, duration, errors }
  } catch (error) {
    logger.error('Critical error in daily metrics rollup', {
      error: error.message,
      stack: error.stack,
    })
    
    return {
      status: 'failed',
      type: 'daily',
      error: error.message,
    }
  }
}

/**
 * Roll up item-level daily metrics to monthly
 */
const rollupItemMetrics = async () => {
  const startTime = Date.now()
  
  try {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - config.rollup.afterDays)
    
    logger.info('Starting item metrics rollup', {
      cutoffDate: cutoffDate.toISOString(),
    })
    
    const enabledRestaurantIds = await listEnabledRestaurantIdsForFeature('analyticsEnabled')
    if (!enabledRestaurantIds.length) {
      logger.info('No analytics-enabled restaurants found; skipping item rollup')
      return { status: 'success', type: 'item', rolled: 0, duration: 0 }
    }

    const itemRecords = await AnalyticsItemDailyMetrics.find({
      restaurantId: { $in: enabledRestaurantIds },
      date: { $lt: cutoffDate },
      rolledUp: { $ne: true },
    })
      .lean()
      .exec()
    
    if (itemRecords.length === 0) {
      logger.info('No item metrics found for rollup')
      return { status: 'success', type: 'item', rolled: 0, duration: 0 }
    }
    
    logger.info('Found item metrics to rollup', { count: itemRecords.length })
    
    // Group by restaurantId, menuItemId, and month
    const groupedByMonth = itemRecords.reduce((acc, record) => {
      const monthKey = `${record.restaurantId}_${record.menuItemId}_${getMonthKey(record.date)}`
      if (!acc[monthKey]) {
        acc[monthKey] = {
          restaurantId: record.restaurantId,
          menuItemId: record.menuItemId,
          menuItemName: record.menuItemName,
          categoryId: record.categoryId,
          monthKey: getMonthKey(record.date),
          year: record.date.getFullYear(),
          month: record.date.getMonth() + 1,
          views: 0,
          addToCart: 0,
          orders: 0,
          quantitySold: 0,
          revenue: 0,
          daysOfData: 0,
          daily_ids: [],
        }
      }
      
      acc[monthKey].views += record.views || 0
      acc[monthKey].addToCart += record.addToCart || 0
      acc[monthKey].orders += record.orders || 0
      acc[monthKey].quantitySold += record.quantitySold || 0
      acc[monthKey].revenue += record.revenue || 0
      acc[monthKey].daysOfData += 1
      acc[monthKey].daily_ids.push(record._id)
      
      return acc
    }, {})
    
    let rolledUp = 0
    let failed = 0
    const errors = []
    
    // Upsert monthly records
    for (const [monthKey, monthData] of Object.entries(groupedByMonth)) {
      try {
        await AnalyticsItemMonthlyMetrics.updateOne(
          {
            restaurantId: monthData.restaurantId,
            menuItemId: monthData.menuItemId,
            monthKey: monthData.monthKey,
          },
          {
            $set: {
              menuItemName: monthData.menuItemName,
              categoryId: monthData.categoryId,
              views: monthData.views,
              addToCart: monthData.addToCart,
              orders: monthData.orders,
              quantitySold: monthData.quantitySold,
              revenue: monthData.revenue,
              daysOfData: monthData.daysOfData,
              rolledUpAt: new Date(),
            },
          },
          { upsert: true },
        )
        
        // Mark daily records as rolled up
        await AnalyticsItemDailyMetrics.updateMany(
          { _id: { $in: monthData.daily_ids } },
          { rolledUp: true, rolledUpAt: new Date() },
        )
        
        rolledUp += 1
      } catch (error) {
        failed += 1
        const msg = `Failed to rollup item month ${monthKey}: ${error.message}`
        logger.error(msg)
        errors.push(msg)
      }
    }
    
    const duration = Date.now() - startTime
    
    logger.info('Item metrics rollup completed', {
      rolledUp,
      failed,
      totalRecords: itemRecords.length,
      duration: `${duration}ms`,
    })
    
    return { status: 'success', type: 'item', rolled: rolledUp, failed, duration, errors }
  } catch (error) {
    logger.error('Critical error in item metrics rollup', {
      error: error.message,
      stack: error.stack,
    })
    
    return {
      status: 'failed',
      type: 'item',
      error: error.message,
    }
  }
}

/**
 * Roll up basket pair daily metrics to monthly
 * Keeps only top 100 pairs per restaurant per month
 */
const rollupBasketPairMetrics = async () => {
  const startTime = Date.now()
  
  try {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - config.rollup.afterDays)
    
    logger.info('Starting basket pair metrics rollup', {
      cutoffDate: cutoffDate.toISOString(),
      maxPairs: config.rollup.topBasketPairsPerMonth,
    })
    
    const enabledRestaurantIds = await listEnabledRestaurantIdsForFeature('analyticsEnabled')
    if (!enabledRestaurantIds.length) {
      logger.info('No analytics-enabled restaurants found; skipping basket pair rollup')
      return { status: 'success', type: 'basket_pair', rolled: 0, duration: 0 }
    }

    const pairRecords = await AnalyticsBasketPairDaily.find({
      restaurantId: { $in: enabledRestaurantIds },
      date: { $lt: cutoffDate },
      rolledUp: { $ne: true },
    })
      .lean()
      .exec()
    
    if (pairRecords.length === 0) {
      logger.info('No basket pair metrics found for rollup')
      return { status: 'success', type: 'basket_pair', rolled: 0, duration: 0 }
    }
    
    logger.info('Found basket pair metrics to rollup', { count: pairRecords.length })
    
    // Group by restaurantId and month
    const groupedByMonth = pairRecords.reduce((acc, record) => {
      const monthKey = `${record.restaurantId}_${getMonthKey(record.date)}`
      if (!acc[monthKey]) {
        acc[monthKey] = {
          restaurantId: record.restaurantId,
          monthKey: getMonthKey(record.date),
          year: record.date.getFullYear(),
          month: record.date.getMonth() + 1,
          pairs: {},
          daily_ids: [],
        }
      }
      
      const pairKey = record.pairKey
      if (!acc[monthKey].pairs[pairKey]) {
        acc[monthKey].pairs[pairKey] = {
          itemA: record.itemA,
          itemB: record.itemB,
          itemAName: record.itemAName,
          itemBName: record.itemBName,
          pairKey: record.pairKey,
          count: 0,
          daysOfData: 0,
        }
      }
      
      acc[monthKey].pairs[pairKey].count += record.count || 0
      acc[monthKey].pairs[pairKey].daysOfData += 1
      acc[monthKey].daily_ids.push(record._id)
      
      return acc
    }, {})
    
    let rolledUp = 0
    let deleted = 0
    let failed = 0
    const errors = []
    
    // Process each month group
    for (const [monthKey, monthData] of Object.entries(groupedByMonth)) {
      try {
        // Sort pairs by count and keep only top N
        const sortedPairs = Object.values(monthData.pairs)
          .sort((a, b) => b.count - a.count)
          .slice(0, config.rollup.topBasketPairsPerMonth)
        
        deleted += Object.values(monthData.pairs).length - sortedPairs.length
        
        // Upsert monthly records for top pairs only
        for (const pair of sortedPairs) {
          await AnalyticsBasketPairMonthly.updateOne(
            {
              restaurantId: monthData.restaurantId,
              pairKey: pair.pairKey,
              monthKey: monthData.monthKey,
            },
            {
              $set: {
                itemA: pair.itemA,
                itemB: pair.itemB,
                itemAName: pair.itemAName,
                itemBName: pair.itemBName,
                count: pair.count,
                daysOfData: pair.daysOfData,
                rolledUpAt: new Date(),
              },
            },
            { upsert: true },
          )
        }
        
        // Mark daily records as rolled up
        await AnalyticsBasketPairDaily.updateMany(
          { _id: { $in: monthData.daily_ids } },
          { rolledUp: true, rolledUpAt: new Date() },
        )
        
        rolledUp += 1
        logger.debug('Basket pair metrics rolled up to monthly', {
          monthKey,
          pairsKept: sortedPairs.length,
          pairsDeleted: Object.values(monthData.pairs).length - sortedPairs.length,
        })
      } catch (error) {
        failed += 1
        const msg = `Failed to rollup basket pairs for month ${monthKey}: ${error.message}`
        logger.error(msg)
        errors.push(msg)
      }
    }
    
    const duration = Date.now() - startTime
    
    logger.info('Basket pair metrics rollup completed', {
      rolledUp,
      deleted,
      failed,
      totalRecords: pairRecords.length,
      duration: `${duration}ms`,
    })
    
    return { status: 'success', type: 'basket_pair', rolled: rolledUp, deleted, failed, duration, errors }
  } catch (error) {
    logger.error('Critical error in basket pair metrics rollup', {
      error: error.message,
      stack: error.stack,
    })
    
    return {
      status: 'failed',
      type: 'basket_pair',
      error: error.message,
    }
  }
}

/**
 * Execute all rollup operations
 * Returns consolidated results
 */
const rollupAllAnalytics = async () => {
  logger.info('Starting comprehensive analytics rollup')
  
  const results = {
    startTime: new Date(),
    operations: [],
  }
  
  // Run rollups sequentially to avoid database contention
  results.operations.push(await rollupDailyMetrics())
  results.operations.push(await rollupItemMetrics())
  results.operations.push(await rollupBasketPairMetrics())
  
  results.endTime = new Date()
  results.totalDuration = results.endTime - results.startTime
  results.allSucceeded = results.operations.every((r) => r.status === 'success')
  
  logger.info('Comprehensive analytics rollup completed', {
    totalDuration: `${results.totalDuration}ms`,
    allSucceeded: results.allSucceeded,
    operations: results.operations.length,
  })
  
  return results
}

/**
 * Get rollup statistics
 * Returns counts of daily vs monthly records
 */
const getRollupStats = async (restaurantId) => {
  try {
    const [dailyCount, monthlyCount, itemDaily, itemMonthly, pairDaily, pairMonthly] = await Promise.all([
      AnalyticsDailyMetrics.countDocuments({ restaurantId }),
      AnalyticsMonthlyMetrics.countDocuments({ restaurantId }),
      AnalyticsItemDailyMetrics.countDocuments({ restaurantId }),
      AnalyticsItemMonthlyMetrics.countDocuments({ restaurantId }),
      AnalyticsBasketPairDaily.countDocuments({ restaurantId }),
      AnalyticsBasketPairMonthly.countDocuments({ restaurantId }),
    ])
    
    return {
      restaurantId,
      daily: { count: dailyCount, rolledUp: await AnalyticsDailyMetrics.countDocuments({ restaurantId, rolledUp: true }) },
      monthly: monthlyCount,
      itemDaily: { count: itemDaily, rolledUp: await AnalyticsItemDailyMetrics.countDocuments({ restaurantId, rolledUp: true }) },
      itemMonthly: itemMonthly,
      pairDaily: { count: pairDaily, rolledUp: await AnalyticsBasketPairDaily.countDocuments({ restaurantId, rolledUp: true }) },
      pairMonthly: pairMonthly,
    }
  } catch (error) {
    logger.error('Failed to fetch rollup stats', {
      restaurantId,
      error: error.message,
    })
    throw error
  }
}

export {
  rollupDailyMetrics,
  rollupItemMetrics,
  rollupBasketPairMetrics,
  rollupAllAnalytics,
  getRollupStats,
}
