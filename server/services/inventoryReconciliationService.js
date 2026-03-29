import Order from '../models/Order.js'
import InventoryBalance from '../models/InventoryBalance.js'
import InventoryViolation from '../models/InventoryViolation.js'
import { logger } from '../utils/logger.js'
import { getOrCreateCircuitBreaker } from './circuitBreaker.js'

/**
 * Periodic reconciliation service for orders with inventory inconsistencies
 * Validates orders against current inventory state and generates recommendations
 */

const RECONCILIATION_BREAKER = getOrCreateCircuitBreaker('inventory_reconciliation', {
  failureThreshold: 3,
  successThreshold: 2,
  timeout: 300000, // 5 minutes
})

const RECONCILIATION_TIMEOUT_MS = 30000 // 30 second max per reconciliation run
const BATCH_QUERY_SIZE = 50 // Process in smaller batches to prevent memory issues

/**
 * Find all orders with inventory policy violations
 */
export async function findOrdersWithInconsistencies(restaurantId, options = {}) {
  const {
    limit = 100,
    sortOrder = -1,
    includeResolved = false,
  } = options

  try {
    const query = {
      restaurantId,
      inventoryInconsistencies: { $exists: true, $ne: [] },
    }

    if (!includeResolved) {
      // Exclude orders already marked as resolved (empty arrays)
      query.inventoryInconsistencies = { $ne: [] }
    }

    const orders = await Order.find(query)
      .select('_id tableNumber floorNumber totalAmount inventoryConsumptionCycle inventoryInconsistencies items createdAt completedAt')
      .sort({ completedAt: sortOrder })
      .limit(limit)
      .lean()

    return orders
  } catch (error) {
    logger.error('find_orders_with_inconsistencies_failed', {
      restaurantId: String(restaurantId),
      error: error.message,
    })
    throw error
  }
}

/**
 * Validate an order's items against current inventory levels
 * Uses batch queries to prevent N+1 queries
 */
export async function validateOrderAgainstInventory(order, restaurantId, session) {
  const validationResult = {
    orderId: order._id,
    isValid: true,
    violations: [],
    recommendations: [],
  }

  try {
    // Batch query: get all balances at once instead of one per item
    const itemIds = order.items.map((i) => i.menuItemId)
    const balances = await InventoryBalance.find(
      {
        restaurantId,
        itemId: { $in: itemIds },
      },
      null,
      { session },
    ).lean()

    // Create lookup map for O(1) access instead of O(n)
    const balanceMap = new Map(balances.map((b) => [b.itemId.toString(), b]))

    for (const item of order.items) {
      const balance = balanceMap.get(item.menuItemId.toString())

      if (!balance || balance.quantityOnHand < 0) {
        validationResult.violations.push({
          itemId: item.menuItemId,
          itemName: item.name,
          quantity: item.quantity,
          currentBalance: balance?.quantityOnHand || 0,
          recommendation: 'Review consumption, item may have been over-allocated',
        })
        validationResult.isValid = false
      }
    }

    if (validationResult.violations.length > 0) {
      // Generate recommendations
      validationResult.recommendations.push(
        'Verify consumption ledger entries for this order',
        'Check if subsequent orders consumed from reservations incorrectly',
        'Consider manual adjustment for affected items',
      )
    }
  } catch (error) {
    logger.error('order_inventory_validation_failed', {
      orderId: String(order._id),
      restaurantId: String(restaurantId),
      error: error.message,
    })
    validationResult.isValid = false
    validationResult.violations.push({
      error: 'Validation process failed',
      message: error.message,
    })
  }

  return validationResult
}

/**
 * Get reconciliation report for all orders with inconsistencies
 */
export async function generateReconciliationReport(restaurantId, options = {}) {
  const { limit = 50 } = options

  try {
    const ordersWithInconsistencies = await findOrdersWithInconsistencies(restaurantId, { limit })

    const report = {
      restaurantId,
      generatedAt: new Date(),
      totalOrdersWithInconsistencies: ordersWithInconsistencies.length,
      orders: [],
      summary: {
        criticalViolations: 0,
        warningViolations: 0,
        totalRecommendations: 0,
      },
    }

    for (const order of ordersWithInconsistencies) {
      const inconsistenciesCount = order.inventoryInconsistencies?.length || 0
      const latestInconsistency = order.inventoryInconsistencies?.[inconsistenciesCount - 1]

      report.orders.push({
        orderId: order._id,
        tableNumber: order.tableNumber,
        floorNumber: order.floorNumber,
        completedAt: order.completedAt,
        inconsistencyCount: inconsistenciesCount,
        latestInconsistency: latestInconsistency
          ? {
              cycle: latestInconsistency.cycle,
              timestamp: latestInconsistency.timestamp,
              error: latestInconsistency.error,
            }
          : null,
        severity: inconsistenciesCount > 3 ? 'critical' : 'warning',
      })

      if (inconsistenciesCount > 3) {
        report.summary.criticalViolations++
      } else {
        report.summary.warningViolations++
      }
    }

    report.summary.totalRecommendations = ordersWithInconsistencies.length

    return report
  } catch (error) {
    logger.error('reconciliation_report_generation_failed', {
      restaurantId: String(restaurantId),
      error: error.message,
    })
    throw error
  }
}

/**
 * Clear inconsistencies for resolved orders with audit logging
 */
export async function clearOrderInconsistencies(orderId, restaurantId, userId = null) {
  try {
    const result = await Order.findOneAndUpdate(
      { _id: orderId, restaurantId },
      { $set: { inventoryInconsistencies: [] } },
      { new: false },
    )

    if (!result) {
      throw new Error('Order not found')
    }

    // Audit log the reconciliation action
    logger.info('order_reconciliation_completed', {
      orderId: String(orderId),
      restaurantId: String(restaurantId),
      userId: userId ? String(userId) : 'system',
      violationCount: result.inventoryInconsistencies?.length || 0,
      timestamp: new Date(),
    })

    result.inventoryInconsistencies = []
    return result
  } catch (error) {
    logger.error('clear_order_inconsistencies_failed', {
      orderId: String(orderId),
      restaurantId: String(restaurantId),
      userId: userId ? String(userId) : 'system',
      error: error.message,
    })
    throw error
  }
}

/**
 * Get analytics summary of inventory violations
 */
export async function getViolationAnalytics(restaurantId, options = {}) {
  const {
    daysBack = 30,
  } = options

  try {
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - daysBack)

    const violationsByType = await InventoryViolation.aggregate([
      {
        $match: {
          restaurantId,
          createdAt: { $gte: fromDate },
        },
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          criticalCount: {
            $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] },
          },
        },
      },
    ])

    const severitySummary = await InventoryViolation.aggregate([
      {
        $match: {
          restaurantId,
          createdAt: { $gte: fromDate },
          resolvedAt: null,
        },
      },
      {
        $group: {
          _id: '$severity',
          unresolved: { $sum: 1 },
        },
      },
    ])

    return {
      restaurantId,
      period: { startDate: fromDate, endDate: new Date() },
      daysAnalyzed: daysBack,
      violationsByType,
      severitySummary,
      totalUnresolved: severitySummary.reduce((sum, s) => sum + s.unresolved, 0),
    }
  } catch (error) {
    logger.error('violation_analytics_generation_failed', {
      restaurantId: String(restaurantId),
      error: error.message,
    })
    throw error
  }
}

/**
 * Periodic reconciliation task with timeout protection
 * Uses circuit breaker to prevent cascading failures
 */
export async function runPeriodicReconciliation() {
  try {
    // Use circuit breaker to prevent cascading failures
    await RECONCILIATION_BREAKER.execute(async () => {
      // Wrap in timeout to prevent hanging
      await Promise.race([
        executeReconciliationWithTimeout(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Reconciliation timeout exceeded')),
            RECONCILIATION_TIMEOUT_MS,
          ),
        ),
      ])
    })
  } catch (error) {
    logger.error('periodic_reconciliation_failed', {
      error: error.message,
      circuitState: RECONCILIATION_BREAKER.getStatus().state,
    })
  }
}

/**
 * Internal function that executes reconciliation without timeout wrapper
 */
async function executeReconciliationWithTimeout() {
  const startTime = Date.now()
  const restaurants = await Order.distinct('restaurantId')
  let processedCount = 0

  for (const restaurantId of restaurants) {
    // Check if we're running out of time
    if (Date.now() - startTime > RECONCILIATION_TIMEOUT_MS * 0.9) {
      logger.warn('reconciliation_timeout_approaching', {
        restaurantId: String(restaurantId),
        elapsedMs: Date.now() - startTime,
        processedCount,
      })
      break
    }

    try {
      const report = await generateReconciliationReport(restaurantId, {
        limit: BATCH_QUERY_SIZE,
      })

      if (report.summary.criticalViolations > 0) {
        logger.warn('reconciliation_critical_violations_found', {
          restaurantId: String(restaurantId),
          criticalCount: report.summary.criticalViolations,
          totalCount: report.totalOrdersWithInconsistencies,
        })
      }

      // Log successful reconciliation
      logger.info('reconciliation_periodic_run_complete', {
        restaurantId: String(restaurantId),
        ordersChecked: report.totalOrdersWithInconsistencies,
        violations: report.summary.criticalViolations + report.summary.warningViolations,
      })

      processedCount++
    } catch (error) {
      logger.error('reconciliation_periodic_run_failed', {
        restaurantId: String(restaurantId),
        error: error.message,
      })
    }
  }

  logger.info('reconciliation_periodic_cycle_complete', {
    totalRestaurants: restaurants.length,
    processedCount,
    elapsedMs: Date.now() - startTime,
  })
}

let reconciliationTimer = null
let reconciliationRunning = false
let isLeader = false

/**
 * Start the periodic inventory reconciliation scheduler with leader election
 */
export async function startInventoryReconciliationScheduler() {
  const { electSchedulerLeader } = await import('./schedulerLeaderElection.js')

  const enabled = String(process.env.INVENTORY_RECONCILIATION_ENABLED || 'true').trim().toLowerCase() !== 'false'
  if (!enabled) {
    logger.info('Inventory reconciliation scheduler disabled by environment')
    return
  }

  const processRole = String(process.env.PROCESS_ROLE || 'all').trim().toLowerCase()
  if (!['all', 'worker', 'jobs'].includes(processRole)) {
    logger.info('Inventory reconciliation scheduler skipped for process role', { processRole })
    return
  }

  const intervalMinutes = Number(process.env.INVENTORY_RECONCILIATION_INTERVAL_MINUTES || 60)
  const safeMinutes = Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 60
  const intervalMs = safeMinutes * 60 * 1000

  const tick = async () => {
    if (reconciliationRunning) return

    // Try to be or maintain leadership
    const becameLeader = await electSchedulerLeader('INVENTORY_RECONCILIATION')
    isLeader = becameLeader

    if (!isLeader) {
      return // Not leader, skip this cycle
    }

    reconciliationRunning = true
    try {
      await runPeriodicReconciliation()
      logger.info('Inventory reconciliation cycle complete')
    } catch (error) {
      logger.error('Inventory reconciliation cycle failed', { error: String(error?.message || error) })
    } finally {
      reconciliationRunning = false
    }
  }

  reconciliationTimer = setInterval(tick, intervalMs)
  reconciliationTimer.unref?.()

  // Kick one cycle shortly after startup.
  setTimeout(async () => {
    await tick()
  }, 10000).unref?.()

  logger.info('Inventory reconciliation scheduler started', { intervalMinutes: safeMinutes, processRole })
}

/**
 * Stop the periodic inventory reconciliation scheduler
 */
export async function stopInventoryReconciliationScheduler() {
  const { releaseSchedulerLeadership } = await import('./schedulerLeaderElection.js')

  if (!reconciliationTimer) return

  clearInterval(reconciliationTimer)
  reconciliationTimer = null

  if (isLeader) {
    await releaseSchedulerLeadership('INVENTORY_RECONCILIATION')
    isLeader = false
  }

  logger.info('Inventory reconciliation scheduler stopped')
}

