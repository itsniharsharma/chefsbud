/**
 * Analytics Hybrid Query Service
 * Combines daily and monthly analytics for consistent range queries
 *
 * Strategy:
 * - Recent data (< 90 days): Use daily metrics
 * - Historical data (>= 90 days): Use monthly metrics
 * - Seamless merging for accurate trend analysis
 *
 * Benefits:
 * - Reduced storage footprint (monthly aggregation)
 * - Maintained query accuracy without re-computation
 * - Consistent performance across time ranges
 */

import AnalyticsDailyMetrics from '../models/AnalyticsDailyMetrics.js'
import AnalyticsMonthlyMetrics from '../models/AnalyticsMonthlyMetrics.js'
import AnalyticsItemDailyMetrics from '../models/AnalyticsItemDailyMetrics.js'
import AnalyticsItemMonthlyMetrics from '../models/AnalyticsItemMonthlyMetrics.js'
import AnalyticsBasketPairDaily from '../models/AnalyticsBasketPairDaily.js'
import AnalyticsBasketPairMonthly from '../models/AnalyticsBasketPairMonthly.js'
import { logger } from '../utils/logger.js'

const ROLLUP_THRESHOLD_DAYS = 90

/**
 * Get analytics for a date range, combining daily and monthly data
 * Returns restaurant-level aggregation
 */
const getRestaurantAnalyticsByRange = async (restaurantId, startDate, endDate) => {
  try {
    const now = new Date()
    const thresholdDate = new Date()
    thresholdDate.setDate(thresholdDate.getDate() - ROLLUP_THRESHOLD_DAYS)
    
    const results = {
      views: 0,
      addToCart: 0,
      completedOrders: 0,
      revenue: 0,
      dataSource: [],
    }
    
    // Query recent daily data
    if (endDate > thresholdDate) {
      const dailyStart = startDate > thresholdDate ? startDate : thresholdDate
      const dailyRecords = await AnalyticsDailyMetrics.find({
        restaurantId,
        date: { $gte: dailyStart, $lte: endDate },
      }).lean()
      
      for (const record of dailyRecords) {
        results.views += record.views || 0
        results.addToCart += record.addToCart || 0
        results.completedOrders += record.completedOrders || 0
        results.revenue += record.revenue || 0
      }
      
      results.dataSource.push(`daily (${dailyRecords.length} records)`)
    }
    
    // Query historical monthly data
    if (startDate < thresholdDate) {
      const monthlyEnd = endDate < thresholdDate ? endDate : thresholdDate
      
      const monthlyRecords = await AnalyticsMonthlyMetrics.find({
        restaurantId,
        rolledUpAt: { $lte: monthlyEnd },
      })
        .hint({ restaurantId: 1, year: 1, month: 1 })
        .lean()
      
      // Filter by date range from monthly
      for (const record of monthlyRecords) {
        const recordDate = new Date(record.createdAt)
        if (recordDate >= startDate && recordDate <= monthlyEnd) {
          results.views += record.views || 0
          results.addToCart += record.addToCart || 0
          results.completedOrders += record.completedOrders || 0
          results.revenue += record.revenue || 0
        }
      }
      
      results.dataSource.push(`monthly (${monthlyRecords.length} records)`)
    }
    
    return results
  } catch (error) {
    logger.error('Error fetching analytics by range', {
      restaurantId,
      error: error.message,
    })
    throw error
  }
}

/**
 * Get item-level analytics for a range
 */
const getItemAnalyticsByRange = async (restaurantId, menuItemId, startDate, endDate) => {
  try {
    const now = new Date()
    const thresholdDate = new Date()
    thresholdDate.setDate(thresholdDate.getDate() - ROLLUP_THRESHOLD_DAYS)
    
    const results = {
      views: 0,
      addToCart: 0,
      orders: 0,
      quantitySold: 0,
      revenue: 0,
      dataSource: [],
    }
    
    // Query recent daily data
    if (endDate > thresholdDate) {
      const dailyStart = startDate > thresholdDate ? startDate : thresholdDate
      const dailyRecords = await AnalyticsItemDailyMetrics.find({
        restaurantId,
        menuItemId,
        date: { $gte: dailyStart, $lte: endDate },
      }).lean()
      
      for (const record of dailyRecords) {
        results.views += record.views || 0
        results.addToCart += record.addToCart || 0
        results.orders += record.orders || 0
        results.quantitySold += record.quantitySold || 0
        results.revenue += record.revenue || 0
      }
      
      results.dataSource.push(`daily (${dailyRecords.length} records)`)
    }
    
    // Query historical monthly data
    if (startDate < thresholdDate) {
      const monthlyEnd = endDate < thresholdDate ? endDate : thresholdDate
      
      const monthlyRecords = await AnalyticsItemMonthlyMetrics.find({
        restaurantId,
        menuItemId,
        rolledUpAt: { $lte: monthlyEnd },
      })
        .hint({ restaurantId: 1, year: 1, month: 1, menuItemId: 1 })
        .lean()
      
      for (const record of monthlyRecords) {
        const recordDate = new Date(record.createdAt)
        if (recordDate >= startDate && recordDate <= monthlyEnd) {
          results.views += record.views || 0
          results.addToCart += record.addToCart || 0
          results.orders += record.orders || 0
          results.quantitySold += record.quantitySold || 0
          results.revenue += record.revenue || 0
        }
      }
      
      results.dataSource.push(`monthly (${monthlyRecords.length} records)`)
    }
    
    return results
  } catch (error) {
    logger.error('Error fetching item analytics by range', {
      restaurantId,
      menuItemId,
      error: error.message,
    })
    throw error
  }
}

/**
 * Get top items by metric (revenue, orders, views)
 * Uses hybrid data for accurate rankings
 */
const getTopItemsByMetric = async (restaurantId, metric = 'revenue', limit = 10, startDate, endDate) => {
  try {
    const now = new Date()
    const thresholdDate = new Date()
    thresholdDate.setDate(thresholdDate.getDate() - ROLLUP_THRESHOLD_DAYS)
    
    const results = {
      views: {},
      orders: {},
      revenue: {},
    }
    
    // Collect daily data
    if (endDate > thresholdDate) {
      const dailyStart = startDate > thresholdDate ? startDate : thresholdDate
      const dailyRecords = await AnalyticsItemDailyMetrics.find({
        restaurantId,
        date: { $gte: dailyStart, $lte: endDate },
      })
        .select(['menuItemId', 'menuItemName', 'views', 'orders', 'revenue'])
        .lean()
      
      for (const record of dailyRecords) {
        const id = record.menuItemId.toString()
        if (!results[metric][id]) {
          results[metric][id] = {
            menuItemId: record.menuItemId,
            menuItemName: record.menuItemName,
            views: 0,
            orders: 0,
            revenue: 0,
          }
        }
        results[metric][id].views += record.views || 0
        results[metric][id].orders += record.orders || 0
        results[metric][id].revenue += record.revenue || 0
      }
    }
    
    // Collect monthly data
    if (startDate < thresholdDate) {
      const monthlyEnd = endDate < thresholdDate ? endDate : thresholdDate
      
      const monthlyRecords = await AnalyticsItemMonthlyMetrics.find({
        restaurantId,
        rolledUpAt: { $lte: monthlyEnd },
      })
        .select(['menuItemId', 'menuItemName', 'views', 'orders', 'revenue'])
        .lean()
      
      for (const record of monthlyRecords) {
        const recordDate = new Date(record.createdAt)
        if (recordDate >= startDate && recordDate <= monthlyEnd) {
          const id = record.menuItemId.toString()
          if (!results[metric][id]) {
            results[metric][id] = {
              menuItemId: record.menuItemId,
              menuItemName: record.menuItemName,
              views: 0,
              orders: 0,
              revenue: 0,
            }
          }
          results[metric][id].views += record.views || 0
          results[metric][id].orders += record.orders || 0
          results[metric][id].revenue += record.revenue || 0
        }
      }
    }
    
    // Sort by metric and return top N
    const sorted = Object.values(results[metric])
      .sort((a, b) => {
        if (metric === 'revenue') return b.revenue - a.revenue
        if (metric === 'orders') return b.orders - a.orders
        return b.views - a.views
      })
      .slice(0, limit)
    
    return sorted
  } catch (error) {
    logger.error('Error fetching top items', {
      restaurantId,
      metric,
      error: error.message,
    })
    throw error
  }
}

/**
 * Get basket pair recommendations from hybrid data
 */
const getBasketPairRecommendations = async (restaurantId, menuItemId, limit = 5, startDate, endDate) => {
  try {
    const now = new Date()
    const thresholdDate = new Date()
    thresholdDate.setDate(thresholdDate.getDate() - ROLLUP_THRESHOLD_DAYS)
    
    const pairs = {}
    
    // Collect daily pair data
    if (endDate > thresholdDate) {
      const dailyStart = startDate > thresholdDate ? startDate : thresholdDate
      const dailyRecords = await AnalyticsBasketPairDaily.find({
        restaurantId,
        $or: [{ itemA: menuItemId }, { itemB: menuItemId }],
        date: { $gte: dailyStart, $lte: endDate },
      })
        .select(['itemA', 'itemB', 'itemAName', 'itemBName', 'count'])
        .lean()
      
      for (const record of dailyRecords) {
        const pairKey = record.pairKey
        const otherItem = record.itemA.toString() === menuItemId ? record.itemB : record.itemA
        const otherName = record.itemA.toString() === menuItemId ? record.itemBName : record.itemAName
        
        if (!pairs[pairKey]) {
          pairs[pairKey] = { itemId: otherItem, name: otherName, count: 0 }
        }
        pairs[pairKey].count += record.count || 0
      }
    }
    
    // Collect monthly pair data
    if (startDate < thresholdDate) {
      const monthlyEnd = endDate < thresholdDate ? endDate : thresholdDate
      
      const monthlyRecords = await AnalyticsBasketPairMonthly.find({
        restaurantId,
        $or: [{ itemA: menuItemId }, { itemB: menuItemId }],
        rolledUpAt: { $lte: monthlyEnd },
      })
        .select(['itemA', 'itemB', 'itemAName', 'itemBName', 'count'])
        .lean()
      
      for (const record of monthlyRecords) {
        const pairKey = record.pairKey
        const otherItem = record.itemA.toString() === menuItemId ? record.itemB : record.itemA
        const otherName = record.itemA.toString() === menuItemId ? record.itemBName : record.itemAName
        
        if (!pairs[pairKey]) {
          pairs[pairKey] = { itemId: otherItem, name: otherName, count: 0 }
        }
        pairs[pairKey].count += record.count || 0
      }
    }
    
    // Sort and return top N
    const sorted = Object.values(pairs)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
    
    return sorted
  } catch (error) {
    logger.error('Error fetching basket pair recommendations', {
      restaurantId,
      menuItemId,
      error: error.message,
    })
    throw error
  }
}

export {
  getRestaurantAnalyticsByRange,
  getItemAnalyticsByRange,
  getTopItemsByMetric,
  getBasketPairRecommendations,
}
