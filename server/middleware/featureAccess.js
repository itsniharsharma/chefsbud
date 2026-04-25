import { resolveRequestRestaurant } from '../utils/requestRestaurant.js'
import { getRestaurantFeatureFlagsFromEntity } from '../services/restaurantFeatureFlags.js'

async function resolveFeatureFlags(req) {
  const restaurant = await resolveRequestRestaurant(req, req.params?.restaurantId || null)
  if (!restaurant) return null
  return {
    restaurant,
    flags: getRestaurantFeatureFlagsFromEntity(restaurant),
  }
}

export async function requireInventoryEnabled(req, res, next) {
  try {
    const resolved = await resolveFeatureFlags(req)
    if (!resolved?.restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }
    if (!resolved.flags.inventoryEnabled) {
      return res.status(403).json({ message: 'Inventory module is disabled in settings' })
    }
    req.restaurant = resolved.restaurant
    return next()
  } catch (error) {
    return next(error)
  }
}

export async function requireAnalyticsEnabled(req, res, next) {
  try {
    const resolved = await resolveFeatureFlags(req)
    if (!resolved?.restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }
    if (!resolved.flags.analyticsEnabled) {
      return res.status(403).json({ message: 'Analytics module is disabled in settings' })
    }
    req.restaurant = resolved.restaurant
    return next()
  } catch (error) {
    return next(error)
  }
}
