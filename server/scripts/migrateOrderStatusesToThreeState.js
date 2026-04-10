import 'dotenv/config'
import mongoose from 'mongoose'
import Order from '../models/Order.js'
import { connectDB, closeDB } from '../config/db.js'
import { logger } from '../utils/logger.js'

/**
 * One-time production migration:
 * Pending/Confirmed/Ready -> Preparing
 */
async function runMigration() {
  const legacyStatuses = ['Pending', 'Confirmed', 'Ready']

  const beforeCount = await Order.countDocuments({
    isArchived: false,
    orderStatus: { $in: legacyStatuses },
  })

  if (!beforeCount) {
    logger.info('order_status_migration_noop', {
      migrated: 0,
      message: 'No legacy statuses found',
    })
    return
  }

  const result = await Order.updateMany(
    { orderStatus: { $in: legacyStatuses } },
    { $set: { orderStatus: 'Preparing' } },
  )

  const afterCount = await Order.countDocuments({
    orderStatus: { $in: legacyStatuses },
  })

  logger.info('order_status_migration_completed', {
    matched: Number(result?.matchedCount || 0),
    modified: Number(result?.modifiedCount || 0),
    remainingLegacyStatuses: afterCount,
  })
}

async function main() {
  try {
    await connectDB()
    await runMigration()
  } catch (error) {
    logger.error('order_status_migration_failed', {
      message: error?.message || 'unknown_error',
      stack: error?.stack,
    })
    process.exitCode = 1
  } finally {
    try {
      await closeDB()
    } catch {
      // ignore close failures on shutdown path
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect()
    }
  }
}

void main()
