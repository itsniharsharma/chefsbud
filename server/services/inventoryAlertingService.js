import InventoryViolation from '../models/InventoryViolation.js'
import { logger } from '../utils/logger.js'

export async function logInventoryViolation({
  restaurantId,
  type,
  severity = 'warning',
  referenceType = null,
  referenceId = null,
  orderId = null,
  inventoryItemId = null,
  locationId = null,
  quantity = 0,
  unit = 'unit',
  message = '',
  metadata = {},
  session = null,
}) {
  try {
    const violation = await InventoryViolation.create(
      [{
        restaurantId,
        type,
        severity,
        referenceType,
        referenceId,
        orderId,
        inventoryItemId,
        locationId,
        quantity,
        unit,
        message: String(message || '').trim().substring(0, 500),
        metadata: Object(metadata) || {},
      }],
      { session: session || undefined },
    )

    const logLevel = severity === 'critical' ? 'error' : 'warn'
    logger[logLevel]('inventory_violation', {
      violationType: type,
      severity,
      restaurantId: String(restaurantId || ''),
      orderId: String(orderId || ''),
      itemId: String(inventoryItemId || ''),
      locationId: String(locationId || ''),
      message,
      violationId: String(violation[0]?._id || ''),
    })

    return violation[0]
  } catch (error) {
    logger.error('inventory_violation_log_failed', {
      message: error?.message || 'failed_to_log_violation',
      violationType: type,
      restaurantId: String(restaurantId || ''),
    })
    return null
  }
}

export async function resolveInventoryViolation(violationId, resolutionNote = '', session = null) {
  try {
    const violation = await InventoryViolation.findByIdAndUpdate(
      violationId,
      {
        $set: {
          resolvedAt: new Date(),
          resolutionNote: String(resolutionNote || '').trim().substring(0, 300),
        },
      },
      { new: true, session: session || undefined },
    )

    if (violation) {
      logger.info('inventory_violation_resolved', {
        violationId: String(violation._id),
        restaurantId: String(violation.restaurantId),
        type: violation.type,
      })
    }

    return violation
  } catch (error) {
    logger.warn('inventory_violation_resolution_failed', {
      violationId: String(violationId),
      message: error?.message || 'failed_to_resolve_violation',
    })
    return null
  }
}

export async function getUnresolvedViolations(restaurantId, { severity = null, type = null } = {}) {
  try {
    const filter = {
      restaurantId,
      resolvedAt: null,
    }

    if (severity) {
      filter.severity = severity
    }

    if (type) {
      filter.type = type
    }

    const violations = await InventoryViolation.find(filter)
      .sort({ severity: -1, createdAt: -1 })
      .limit(1000)
      .lean()

    return violations
  } catch (error) {
    logger.warn('inventory_violations_fetch_failed', {
      restaurantId: String(restaurantId),
      message: error?.message,
    })
    return []
  }
}

export async function triggerInventoryAlert({
  restaurantId,
  type,
  orderId = null,
  itemId = null,
  locationId = null,
  message = '',
  metadata = {},
}) {
  const violationId = await logInventoryViolation({
    restaurantId,
    type,
    severity: 'critical',
    orderId,
    inventoryItemId: itemId,
    locationId,
    message,
    metadata,
  })

  logger.error('INVENTORY_ALERT', {
    type,
    restaurantId: String(restaurantId),
    orderId: String(orderId || ''),
    itemId: String(itemId || ''),
    locationId: String(locationId || ''),
    message,
    violationId: String(violationId?._id || ''),
  })

  return violationId
}
