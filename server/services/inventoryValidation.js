import InventoryBalance from '../models/InventoryBalance.js'
import InventoryLedger from '../models/InventoryLedger.js'
import InventoryReservation from '../models/InventoryReservation.js'
import Order from '../models/Order.js'
import { logger } from '../utils/logger.js'

/**
 * Inventory startup validation service
 * Performs consistency checks on application startup
 */

export async function validateInventoryConsistency() {
  logger.info('inventory_consistency_validation_started')

  const results = {
    checks: [],
    warning: false,
    error: false,
  }

  try {
    // Check 1: Detect negative balances
    const negativeBalances = await InventoryBalance.countDocuments({
      quantityOnHand: { $lt: 0 },
    })

    results.checks.push({
      name: 'negative_balances',
      passed: negativeBalances === 0,
      details: `Found ${negativeBalances} items with negative balance`,
      severity: negativeBalances > 0 ? 'warning' : 'info',
    })

    if (negativeBalances > 0) {
      results.warning = true
      logger.warn('startup_validation_negative_balances_detected', { count: negativeBalances })
    }

    // Check 2: Orphaned reservations (no corresponding active order)
    const orphanedReservations = await InventoryReservation.aggregate([
      {
        $lookup: {
          from: 'orders',
          let: { orderId: '$orderId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ['$_id', '$$orderId'],
                },
                orderStatus: { $nin: ['Completed', 'Cancelled'] },
              },
            },
          ],
          as: 'order',
        },
      },
      {
        $match: { order: { $size: 0 } },
      },
      {
        $count: 'count',
      },
    ])

    const orphanedCount = orphanedReservations.length > 0 ? orphanedReservations[0].count : 0

    results.checks.push({
      name: 'orphaned_reservations',
      passed: orphanedCount === 0,
      details: `Found ${orphanedCount} orphaned reservations`,
      severity: orphanedCount > 10 ? 'error' : orphanedCount > 0 ? 'warning' : 'info',
    })

    if (orphanedCount > 0) {
      if (orphanedCount > 10) {
        results.error = true
      } else {
        results.warning = true
      }
      logger.warn('startup_validation_orphaned_reservations_detected', { count: orphanedCount })
    }

    // Check 3: Orders with violations that aren't marked for resolution
    const unresolvedViolations = await Order.countDocuments({
      inventoryInconsistencies: { $exists: true, $ne: [] },
      isArchived: false,
      completedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Completed > 24h ago
    })

    results.checks.push({
      name: 'unresolved_violations',
      passed: unresolvedViolations === 0,
      details: `Found ${unresolvedViolations} orders with unresolved violations > 24h old`,
      severity: unresolvedViolations > 100 ? 'warning' : 'info',
    })

    if (unresolvedViolations > 100) {
      results.warning = true
      logger.warn('startup_validation_many_unresolved_violations', { count: unresolvedViolations })
    }

    // Check 4: Ledger consistency (total consumed <= reserved + purchased)
    const ledgerIssues = await InventoryLedger.aggregate([
      {
        $group: {
          _id: {
            restaurantId: '$restaurantId',
            itemId: '$itemId',
          },
          totalConsumed: {
            $sum: {
              $cond: [{ $eq: ['$type', 'consumption'] }, '$quantity', 0],
            },
          },
          totalReserved: {
            $sum: {
              $cond: [{ $eq: ['$type', 'reservation'] }, '$quantity', 0],
            },
          },
          totalPurchased: {
            $sum: {
              $cond: [{ $eq: ['$type', 'purchase'] }, '$quantity', 0],
            },
          },
        },
      },
      {
        $match: {
          $expr: {
            $gt: ['$totalConsumed', { $add: ['$totalReserved', '$totalPurchased'] }],
          },
        },
      },
      {
        $count: 'count',
      },
    ])

    const ledgerIssueCount = ledgerIssues.length > 0 ? ledgerIssues[0].count : 0

    results.checks.push({
      name: 'ledger_consistency',
      passed: ledgerIssueCount === 0,
      details: `Found ${ledgerIssueCount} items with consumption > purchases+reservations`,
      severity: ledgerIssueCount > 0 ? 'error' : 'info',
    })

    if (ledgerIssueCount > 0) {
      results.error = true
      logger.error('startup_validation_ledger_inconsistency_detected', { count: ledgerIssueCount })
    }

    // Log final result
    const errorCount = results.checks.filter((c) => !c.passed && c.severity === 'error').length
    const warningCount = results.checks.filter((c) => !c.passed && c.severity === 'warning').length

    logger.info('inventory_consistency_validation_completed', {
      totalChecks: results.checks.length,
      passed: results.checks.filter((c) => c.passed).length,
      warnings: warningCount,
      errors: errorCount,
    })

    if (results.error) {
      logger.error('inventory_consistency_validation_failed', {
        results: results.checks,
      })
    }
  } catch (error) {
    logger.error('inventory_consistency_validation_error', {
      error: error.message,
    })
    results.error = true
  }

  return results
}
