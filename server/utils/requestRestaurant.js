import Restaurant from '../models/Restaurant.js'

const restaurantProjection = '_id ownerId slug name gstin address phone paymentConfig inventoryAlertConfig featureConfig'

export async function resolveRequestRestaurant(req, restaurantId = null) {
  const requestedRestaurantId = restaurantId ? String(restaurantId) : ''
  const currentRestaurantId = req.restaurant?._id ? String(req.restaurant._id) : ''

  if (req.restaurant && (!requestedRestaurantId || currentRestaurantId === requestedRestaurantId)) {
    return req.restaurant
  }

  if (!req.user?._id) {
    return null
  }

  const query = { ownerId: req.user._id }
  if (requestedRestaurantId) {
    query._id = requestedRestaurantId
  }

  const restaurant = await Restaurant.findOne(query).select(restaurantProjection).lean()
  if (restaurant && (!requestedRestaurantId || String(restaurant._id) === requestedRestaurantId)) {
    req.restaurant = restaurant
  }

  return restaurant
}