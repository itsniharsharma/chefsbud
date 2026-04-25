import Order from '../models/Order.js'
import { getOrderInventoryBehavior, isInventoryConstraintError } from '../config/inventoryRuntime.js'
import { processOrderConsumption, reverseOrderConsumption } from './inventoryService.js'
import { consumeReservationsForOrder } from './inventoryV2Service.js'
import { logger } from '../utils/logger.js'
import { rebuildOrderMetricsForDate } from './orderMetricsService.js'
import { revertCompletedOrderAnalytics, syncCompletedOrderAnalytics } from './itemAnalyticsService.js'
import { getRestaurantFeatureFlagsById } from './restaurantFeatureFlags.js'

function toDate(value) {
  const date = value ? new Date(value) : new Date()
  return Number.isFinite(date.getTime()) ? date : new Date()
}

async function markInventoryProcessed(orderId, cycle, processedAt = new Date()) {
  await Order.updateOne(
    { _id: orderId, isArchived: false },
    {
      $set: {
        inventoryConsumptionCycle: cycle,
        inventoryProcessedAt: processedAt,
      },
    },
  )
}

async function markInventoryReversed(orderId) {
  await Order.updateOne(
    { _id: orderId, isArchived: false },
    {
      $set: {
        inventoryProcessedAt: null,
      },
    },
  )
}

export async function processOrderStatusTransition({
  orderId,
  restaurantId,
  fromStatus,
  toStatus,
  createdBy = null,
  inventoryCycle = 0,
  completedAt = null,
}) {
  const normalizedOrderId = String(orderId || '').trim()
  const normalizedRestaurantId = String(restaurantId || '').trim()
  if (!normalizedOrderId || !normalizedRestaurantId) {
    throw new Error('order_status_transition_invalid_payload')
  }

  const order = await Order.findOne({ _id: normalizedOrderId, restaurantId: normalizedRestaurantId, isArchived: false })
    .select(
      '_id restaurantId orderStatus items totalAmount completedAt inventoryProcessedAt inventoryConsumptionCycle analyticsTrackedAt analyticsTrackingState tableNumber floorNumber',
    )
    .lean()

  if (!order) {
    logger.warn('order_status_transition_missing_order', {
      orderId: normalizedOrderId,
      restaurantId: normalizedRestaurantId,
      fromStatus,
      toStatus,
    })
    return { processed: false, reason: 'order_not_found' }
  }

  const targetStatus = String(toStatus || '').trim()
  const sourceStatus = String(fromStatus || '').trim()
  const currentStatus = String(order.orderStatus || '')
  const featureFlags = await getRestaurantFeatureFlagsById(normalizedRestaurantId)
  const inventoryEnabled = featureFlags.inventoryEnabled
  const analyticsEnabled = featureFlags.analyticsEnabled

  if (currentStatus !== targetStatus) {
    logger.info('order_status_transition_skipped', {
      orderId: normalizedOrderId,
      restaurantId: normalizedRestaurantId,
      fromStatus: sourceStatus,
      toStatus: targetStatus,
      currentStatus,
    })
    return { processed: false, reason: 'stale_transition' }
  }

  if (targetStatus === 'Completed') {
    const inventoryBehavior = getOrderInventoryBehavior()
    const cycle = Math.max(1, Number(inventoryCycle || order.inventoryConsumptionCycle || 0) + 1)

    try {
      if (!order.inventoryProcessedAt) {
        if (inventoryEnabled && inventoryBehavior.mode !== 'off') {
          let consumedFromReservation = 0
          try {
            const reservationResult = await consumeReservationsForOrder({
              restaurantId: normalizedRestaurantId,
              orderId: normalizedOrderId,
              createdBy,
              cycle,
              policy: inventoryBehavior.consumptionPolicy,
            })
            consumedFromReservation = Number(reservationResult?.consumedCount || 0)
          } catch (inventoryError) {
            if (inventoryBehavior.blockOrderCompletionOnInventoryFailure || isInventoryConstraintError(inventoryError)) {
              logger.error('order_status_inventory_reservation_failed_non_blocking', {
                orderId: normalizedOrderId,
                restaurantId: normalizedRestaurantId,
                message: inventoryError?.message || 'inventory_reservation_failed',
              })
            } else {
              logger.warn('order_status_inventory_reservation_failed', {
                orderId: normalizedOrderId,
                restaurantId: normalizedRestaurantId,
                message: inventoryError?.message || 'inventory_reservation_failed',
              })
            }
          }

          if (!consumedFromReservation && inventoryBehavior.allowLegacyFallback) {
            try {
              await processOrderConsumption(order, {
                createdBy,
                cycle,
              })
            } catch (inventoryError) {
              if (inventoryBehavior.blockOrderCompletionOnInventoryFailure || isInventoryConstraintError(inventoryError)) {
                logger.error('order_status_inventory_processing_failed_non_blocking', {
                  orderId: normalizedOrderId,
                  restaurantId: normalizedRestaurantId,
                  message: inventoryError?.message || 'inventory_processing_failed',
                })
              } else {
                logger.warn('order_status_inventory_processing_failed', {
                  orderId: normalizedOrderId,
                  restaurantId: normalizedRestaurantId,
                  message: inventoryError?.message || 'inventory_processing_failed',
                })
              }
            }
          }
        }

        await markInventoryProcessed(order._id, cycle, toDate(completedAt || order.completedAt || order.updatedAt))
      }

      if (analyticsEnabled && !order.analyticsTrackedAt) {
        await syncCompletedOrderAnalytics(order._id)
      }

      await rebuildOrderMetricsForDate({
        restaurantId: normalizedRestaurantId,
        date: toDate(completedAt || order.completedAt || order.updatedAt),
      })

      return { processed: true, state: 'completed' }
    } catch (error) {
      logger.warn('order_status_completed_async_processing_failed', {
        orderId: normalizedOrderId,
        restaurantId: normalizedRestaurantId,
        message: error?.message || 'order_status_completed_processing_failed',
      })
      throw error
    }
  }

  if (sourceStatus === 'Completed' && targetStatus !== 'Completed') {
    try {
      if (inventoryEnabled && order.inventoryProcessedAt) {
        const cycle = Math.max(1, Number(order.inventoryConsumptionCycle || inventoryCycle || 1))
        await reverseOrderConsumption(order, {
          createdBy,
          cycle,
        })
        await markInventoryReversed(order._id)
      }

      if (analyticsEnabled && order.analyticsTrackedAt) {
        await revertCompletedOrderAnalytics(order)
      }

      await rebuildOrderMetricsForDate({
        restaurantId: normalizedRestaurantId,
        date: toDate(order.completedAt || completedAt || order.updatedAt),
      })

      return { processed: true, state: 'reversed' }
    } catch (error) {
      logger.warn('order_status_reversal_async_processing_failed', {
        orderId: normalizedOrderId,
        restaurantId: normalizedRestaurantId,
        message: error?.message || 'order_status_reversal_failed',
      })
      throw error
    }
  }

  return { processed: true, state: 'noop' }
}
