import Restaurant from '../models/Restaurant.js'
import { invalidateCacheByTags } from './responseCache.js'
import { invalidateRestaurantFeatureFlagsCache, getRestaurantFeatureFlagsFromEntity } from './restaurantFeatureFlags.js'
import { purgeAnalyticsModuleData, purgeInventoryLifecycleData } from './moduleDataCleanupService.js'
import { logger } from '../utils/logger.js'

const PLAN_CODE_CORE = 'core'
const PLAN_CODE_PRO = 'pro'

export function getFeatureEntitlementForPlanCode(planCode) {
  const normalizedPlanCode = String(planCode || '').trim().toLowerCase()
  if (normalizedPlanCode === PLAN_CODE_CORE) {
    return {
      inventoryEnabled: false,
      analyticsEnabled: false,
    }
  }
  if (normalizedPlanCode === PLAN_CODE_PRO) {
    return {
      inventoryEnabled: true,
      analyticsEnabled: true,
    }
  }
  return null
}

export async function syncRestaurantFeatureEntitlementsForOwner({
  ownerId,
  planCode,
  source = 'unknown',
}) {
  const entitlement = getFeatureEntitlementForPlanCode(planCode)
  if (!entitlement || !ownerId) {
    return null
  }

  const restaurant = await Restaurant.findOne({ ownerId })
  if (!restaurant) {
    return null
  }

  const previousFlags = getRestaurantFeatureFlagsFromEntity(restaurant)
  const alreadyInDesiredState =
    previousFlags.inventoryEnabled === entitlement.inventoryEnabled &&
    previousFlags.analyticsEnabled === entitlement.analyticsEnabled

  if (alreadyInDesiredState) {
    return restaurant
  }

  restaurant.featureConfig = {
    ...(restaurant.featureConfig?.toObject ? restaurant.featureConfig.toObject() : restaurant.featureConfig),
    inventoryEnabled: entitlement.inventoryEnabled,
    analyticsEnabled: entitlement.analyticsEnabled,
  }
  await restaurant.save()

  invalidateRestaurantFeatureFlagsCache(restaurant._id)
  invalidateCacheByTags([`analytics:${String(restaurant._id)}`])

  if (previousFlags.analyticsEnabled && !entitlement.analyticsEnabled) {
    void purgeAnalyticsModuleData(restaurant._id).catch((error) => {
      logger.warn('analytics_module_data_purge_failed', {
        restaurantId: String(restaurant._id || ''),
        source,
        message: error?.message || 'analytics module data purge failed',
      })
    })
  }

  if (previousFlags.inventoryEnabled && !entitlement.inventoryEnabled) {
    void purgeInventoryLifecycleData(restaurant._id).catch((error) => {
      logger.warn('inventory_lifecycle_data_purge_failed', {
        restaurantId: String(restaurant._id || ''),
        source,
        message: error?.message || 'inventory lifecycle data purge failed',
      })
    })
  }

  return restaurant
}
