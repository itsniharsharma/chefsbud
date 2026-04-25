import AnalyticsBasketPairDaily from '../models/AnalyticsBasketPairDaily.js'
import AnalyticsBasketPairMonthly from '../models/AnalyticsBasketPairMonthly.js'
import AnalyticsDailyMetrics from '../models/AnalyticsDailyMetrics.js'
import AnalyticsEventIngestion from '../models/AnalyticsEventIngestion.js'
import AnalyticsExposureSession from '../models/AnalyticsExposureSession.js'
import AnalyticsItemDailyMetrics from '../models/AnalyticsItemDailyMetrics.js'
import AnalyticsItemMonthlyMetrics from '../models/AnalyticsItemMonthlyMetrics.js'
import AnalyticsMonthlyMetrics from '../models/AnalyticsMonthlyMetrics.js'
import AnalyticsOrderInsightsDaily from '../models/AnalyticsOrderInsightsDaily.js'
import OrderHourlyMetrics from '../models/OrderHourlyMetrics.js'
import InventoryDailySummary from '../models/InventoryDailySummary.js'
import InventoryMonthlySummary from '../models/InventoryMonthlySummary.js'
import InventoryReservation from '../models/InventoryReservation.js'
import InventoryRollupJobState from '../models/InventoryRollupJobState.js'
import { logger } from '../utils/logger.js'

function normalizeRestaurantId(restaurantId) {
  return String(restaurantId || '').trim()
}

export async function purgeAnalyticsModuleData(restaurantId) {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId)
  if (!normalizedRestaurantId) return

  const [daily, monthly, itemDaily, itemMonthly, pairDaily, pairMonthly, insights, hourly, events, exposures] = await Promise.all([
    AnalyticsDailyMetrics.deleteMany({ restaurantId: normalizedRestaurantId }),
    AnalyticsMonthlyMetrics.deleteMany({ restaurantId: normalizedRestaurantId }),
    AnalyticsItemDailyMetrics.deleteMany({ restaurantId: normalizedRestaurantId }),
    AnalyticsItemMonthlyMetrics.deleteMany({ restaurantId: normalizedRestaurantId }),
    AnalyticsBasketPairDaily.deleteMany({ restaurantId: normalizedRestaurantId }),
    AnalyticsBasketPairMonthly.deleteMany({ restaurantId: normalizedRestaurantId }),
    AnalyticsOrderInsightsDaily.deleteMany({ restaurantId: normalizedRestaurantId }),
    OrderHourlyMetrics.deleteMany({ restaurantId: normalizedRestaurantId }),
    AnalyticsEventIngestion.deleteMany({ restaurantId: normalizedRestaurantId }),
    AnalyticsExposureSession.deleteMany({ restaurantId: normalizedRestaurantId }),
  ])

  logger.info('analytics_module_data_purged', {
    restaurantId: normalizedRestaurantId,
    deleted: {
      daily: Number(daily?.deletedCount || 0),
      monthly: Number(monthly?.deletedCount || 0),
      itemDaily: Number(itemDaily?.deletedCount || 0),
      itemMonthly: Number(itemMonthly?.deletedCount || 0),
      pairDaily: Number(pairDaily?.deletedCount || 0),
      pairMonthly: Number(pairMonthly?.deletedCount || 0),
      insights: Number(insights?.deletedCount || 0),
      hourly: Number(hourly?.deletedCount || 0),
      events: Number(events?.deletedCount || 0),
      exposures: Number(exposures?.deletedCount || 0),
    },
  })
}

export async function purgeInventoryLifecycleData(restaurantId) {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId)
  if (!normalizedRestaurantId) return

  const [reservations, dailySummaries, monthlySummaries, rollupStates] = await Promise.all([
    InventoryReservation.deleteMany({ restaurantId: normalizedRestaurantId }),
    InventoryDailySummary.deleteMany({ restaurantId: normalizedRestaurantId }),
    InventoryMonthlySummary.deleteMany({ restaurantId: normalizedRestaurantId }),
    InventoryRollupJobState.deleteMany({
      $or: [
        { 'payload.restaurantId': normalizedRestaurantId },
        { windowKey: { $regex: `^${normalizedRestaurantId}:` } },
      ],
    }),
  ])

  logger.info('inventory_lifecycle_data_purged', {
    restaurantId: normalizedRestaurantId,
    deleted: {
      reservations: Number(reservations?.deletedCount || 0),
      dailySummaries: Number(dailySummaries?.deletedCount || 0),
      monthlySummaries: Number(monthlySummaries?.deletedCount || 0),
      rollupStates: Number(rollupStates?.deletedCount || 0),
    },
  })
}
