import InventoryReservation from '../models/InventoryReservation.js'
import Order from '../models/Order.js'
import { addLedgerEntries } from './inventoryService.js'
import { logInventoryViolation } from './inventoryAlertingService.js'
import { logger } from '../utils/logger.js'

let cleanupJobInterval = null

async function cleanupStaleReservations() {
  const startTime = Date.now()
  let cleanedCount = 0
  let failureCount = 0

  try {
    // Find stale reservations that have expired or are orphaned
    const staleReservations = await InventoryReservation.find({
      $or: [
        { expiresAt: { $lt: new Date() }, status: 'active' },
        {
          status: 'active',
          orderId: {
            $nin: await Order.find({
              orderStatus: { $nin: ['Completed', 'Served'] },
              isArchived: false,
            })
              .distinct('_id')
              .catch(() => []),
          },
        },
      ],
    }).lean()

    if (!staleReservations.length) {
      logger.info('cleanup_stale_reservations_completed', {
        cleanedCount: 0,
        durationMs: Date.now() - startTime,
      })
      return
    }

    // Group by restaurant to maintain transaction isolation
    const byRestaurant = new Map()
    for (const reservation of staleReservations) {
      const key = String(reservation.restaurantId || '')
      if (!key) continue
      if (!byRestaurant.has(key)) {
        byRestaurant.set(key, [])
      }
      byRestaurant.get(key).push(reservation)
    }

    // Process each restaurant
    for (const [restaurantId, reservations] of byRestaurant) {
      try {
        await cleanupReservationBatch(restaurantId, reservations)
        cleanedCount += reservations.length
      } catch (error) {
        failureCount += reservations.length
        logger.error('cleanup_reservation_batch_failed', {
          restaurantId,
          count: reservations.length,
          message: error?.message || 'unknown_error',
        })
      }
    }

    logger.info('cleanup_stale_reservations_completed', {
      cleanedCount,
      failureCount,
      durationMs: Date.now() - startTime,
    })
  } catch (error) {
    logger.error('cleanup_stale_reservations_failed', {
      message: error?.message || 'unknown_error',
      durationMs: Date.now() - startTime,
    })
  }
}

async function cleanupReservationBatch(restaurantId, reservations) {
  const ledgerEntries = []

  for (const reservation of reservations) {
    try {
      // Mark as expired
      await InventoryReservation.updateOne(
        { _id: reservation._id },
        {
          $set: {
            status: 'expired',
            releasedQty: Number(reservation.reservedQty || 0),
          },
        },
      )

      // Create ledger entry for the release
      ledgerEntries.push({
        restaurantId,
        locationId: reservation.locationId,
        inventoryItemId: reservation.inventoryItemId,
        type: 'RELEASE',
        quantity: Number(reservation.reservedQty || 0),
        direction: 0,
        unit: reservation.unit,
        referenceType: 'expired_reservation_cleanup',
        referenceId: reservation._id,
        metadata: {
          reason: 'stale_expiry_cleanup',
          originalExpiresAt: reservation.expiresAt,
        },
        createdBy: null,
        idempotencyKey: `cleanup:expire:${String(reservation._id)}`,
      })

      // Log violation for operational tracking
      await logInventoryViolation({
        restaurantId,
        type: 'EXPIRED_UNCLEANED',
        severity: 'warning',
        orderId: reservation.orderId,
        inventoryItemId: reservation.inventoryItemId,
        locationId: reservation.locationId,
        quantity: Number(reservation.reservedQty || 0),
        unit: reservation.unit,
        message: `Expired reservation cleaned up: ${String(reservation._id)}`,
        metadata: {
          reservationId: String(reservation._id),
          expiresAt: reservation.expiresAt,
        },
      })
    } catch (error) {
      logger.warn('cleanup_individual_reservation_failed', {
        restaurantId,
        reservationId: String(reservation._id),
        message: error?.message,
      })
    }
  }

  if (ledgerEntries.length) {
    await addLedgerEntries(ledgerEntries)
  }
}

export function startStaleReservationCleanupJob() {
  if (cleanupJobInterval) {
    return
  }

  const intervalMs = Math.max(10 * 60 * 1000, Number(process.env.INVENTORY_CLEANUP_INTERVAL_MS || 15 * 60 * 1000))

  cleanupJobInterval = setInterval(() => {
    cleanupStaleReservations().catch((error) => {
      logger.error('cleanup_job_error', {
        message: error?.message || 'unknown_error',
      })
    })
  }, intervalMs)

  logger.info('stale_reservation_cleanup_job_started', {
    intervalMs,
  })
}

export function stopStaleReservationCleanupJob() {
  if (cleanupJobInterval) {
    clearInterval(cleanupJobInterval)
    cleanupJobInterval = null
    logger.info('stale_reservation_cleanup_job_stopped')
  }
}

export async function runCleanupNow() {
  await cleanupStaleReservations()
}
