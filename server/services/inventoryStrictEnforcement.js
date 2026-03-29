// ENHANCED VERSION OF applyBalanceDelta WITH STRICT OPERATIONAL BEHAVIOR

import { logInventoryViolation, triggerInventoryAlert } from './inventoryAlertingService.js'
import { logger } from '../utils/logger.js'

function round6(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1_000_000) / 1_000_000
}

export async function applyBalanceDeltaStrict({
  restaurantId,
  locationId,
  inventoryItemId,
  baseUnit,
  onHandDelta = 0,
  reservedDelta = 0,
  policy = 'soft',
  enforceStrictLocation = true,
  session = null,
  balance = null,
}) {
  // STEP 5: LOCATION DISCIPLINE - ALL OPERATIONS MUST INCLUDE LOCATION
  if (!locationId || !restaurantId || !inventoryItemId) {
    const error = new Error('LOCATION_DISCIPLINE_VIOLATION: locationId, restaurantId, and inventoryItemId required')
    error.isLocationViolation = true
    throw error
  }

  if (enforceStrictLocation && !locationId) {
    await triggerInventoryAlert({
      restaurantId,
      type: 'LOCATION_MISMATCH',
      itemId: inventoryItemId,
      locationId: null,
      message: 'Operation attempted without location',
    })
    throw new Error('STRICT: All inventory operations require explicit locationId')
  }

  // Calculate next state
  const nextOnHand = round6(Number(balance?.onHandQty || 0) + Number(onHandDelta || 0))
  const nextReserved = round6(Number(balance?.reservedQty || 0) + Number(reservedDelta || 0))
  const nextAvailable = round6(nextOnHand - nextReserved)

  // STEP 1: REMOVE "SOFT SYSTEM" - EXPLICIT FAILURES
  if (nextReserved < -0.000001) {
    const violation = await logInventoryViolation({
      restaurantId,
      type: 'POLICY_BREACH',
      severity: 'critical',
      inventoryItemId,
      locationId,
      quantity: nextReserved,
      unit: baseUnit,
      message: 'Reserved stock would become negative',
      metadata: {
        currentReserved: balance?.reservedQty,
        delta: reservedDelta,
        resultingReserved: nextReserved,
      },
      session,
    })

    await triggerInventoryAlert({
      restaurantId,
      type: 'NEGATIVE_STOCK',
      itemId: inventoryItemId,
      locationId,
      message: `Critical: Reserved stock negative. Item: ${inventoryItemId}, Location: ${locationId}, Delta: ${reservedDelta}`,
      metadata: { violationId: String(violation?._id) },
    })

    throw new Error('Reserved stock cannot become negative')
  }

  if (policy === 'hard' && nextAvailable < -0.000001) {
    const violation = await logInventoryViolation({
      restaurantId,
      type: 'POLICY_BREACH',
      severity: 'critical',
      inventoryItemId,
      locationId,
      quantity: nextAvailable,
      unit: baseUnit,
      message: `Hard policy: Insufficient stock under hard policy`,
      metadata: {
        policy: 'hard',
        currentAvailable: balance?.availableQty,
        delta: onHandDelta - reservedDelta,
        resultingAvailable: nextAvailable,
      },
      session,
    })

    await triggerInventoryAlert({
      restaurantId,
      type: 'POLICY_BREACH',
      itemId: inventoryItemId,
      locationId,
      message: `Hard Policy Violation: Insufficient available stock.`,
      metadata: { violationId: String(violation?._id) },
    })

    throw new Error('Insufficient available stock under hard policy')
  }

  if (policy === 'soft' && nextAvailable < -0.000001) {
    await logInventoryViolation({
      restaurantId,
      type: 'NEGATIVE_STOCK',
      severity: 'warning',
      inventoryItemId,
      locationId,
      quantity: nextAvailable,
      unit: baseUnit,
      message: 'Soft policy: Negative available stock allowed but tracked',
      metadata: {
        policy: 'soft',
        currentAvailable: balance?.availableQty,
        resultingAvailable: nextAvailable,
      },
      session,
    })

    logger.warn('inventory_negative_stock_soft_policy', {
      restaurantId: String(restaurantId),
      itemId: String(inventoryItemId),
      locationId: String(locationId),
      negativeQty: nextAvailable,
    })
  }

  // Update balance
  if (balance) {
    balance.onHandQty = nextOnHand
    balance.reservedQty = Math.max(0, nextReserved)
    balance.availableQty = round6(nextOnHand - balance.reservedQty)
    balance.rowVersion = Number(balance.rowVersion || 0) + 1
    await balance.save({ session: session || undefined })
  }

  return balance
}

export async function consumeReservationStrict({
  restaurantId,
  orderId,
  balance,
  reservation,
  cycle: _cycle,
  session,
}) {
  // STEP 3: STRICT RESERVATION-FIRST MODEL
  if (!reservation) {
    const violation = await logInventoryViolation({
      restaurantId,
      type: 'NO_RESERVATION',
      severity: 'critical',
      orderId,
      inventoryItemId: balance?.inventoryItemId,
      locationId: balance?.locationId,
      message: 'Consumption attempted without matching reservation',
      session,
    })

    logger.error('CONSUMPTION_WITHOUT_RESERVATION', {
      restaurantId: String(restaurantId),
      orderId: String(orderId),
      itemId: String(balance?.inventoryItemId),
      violationId: String(violation?._id),
    })

    return { consumed: false, violation }
  }

  const qty = Number(reservation.reservedQty || 0)

  // Deduct from reserved and on-hand together
  const nextOnHand = round6(Number(balance.onHandQty || 0) - qty)
  const nextReserved = 0 // Consumption releases entire reservation
  const nextAvailable = nextOnHand

  if (nextOnHand < -0.000001) {
    await logInventoryViolation({
      restaurantId,
      type: 'NEGATIVE_STOCK',
      severity: 'critical',
      orderId,
      inventoryItemId: balance.inventoryItemId,
      locationId: balance.locationId,
      quantity: nextOnHand,
      unit: reservation.unit,
      message: `On-hand stock would become negative during consumption. Order: ${orderId}`,
      metadata: {
        currentOnHand: balance.onHandQty,
        consumedQty: qty,
        resultingOnHand: nextOnHand,
      },
      session,
    })
  }

  balance.onHandQty = nextOnHand
  balance.reservedQty = nextReserved
  balance.availableQty = nextAvailable
  balance.rowVersion = Number(balance.rowVersion || 0) + 1
  await balance.save({ session })

  return { consumed: true, qty }
}
