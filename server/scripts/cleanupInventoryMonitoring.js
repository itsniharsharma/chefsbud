import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDB, closeDB } from '../config/db.js'

function parseBoolArg(name, defaultValue = false) {
  const index = process.argv.indexOf(name)
  if (index === -1) return defaultValue
  const raw = String(process.argv[index + 1] || '').trim().toLowerCase()
  if (!raw) return true
  return ['1', 'true', 'yes', 'y', 'on'].includes(raw)
}

async function collectionExists(db, name) {
  const rows = await db.listCollections({ name }, { nameOnly: true }).toArray()
  return rows.length > 0
}

async function run() {
  const dryRun = parseBoolArg('--dry-run', true)

  await connectDB()
  const db = mongoose.connection.db

  if (!db) {
    throw new Error('Database connection is not available')
  }

  const summary = {
    dryRun,
    inventoryViolationsCollection: {
      existed: false,
      documentCount: 0,
      dropped: false,
    },
    ordersInconsistenciesField: {
      matched: 0,
      modified: 0,
    },
    completedAt: new Date().toISOString(),
  }

  const hasInventoryViolations = await collectionExists(db, 'inventoryviolations')
  summary.inventoryViolationsCollection.existed = hasInventoryViolations

  if (hasInventoryViolations) {
    const violationsCollection = db.collection('inventoryviolations')
    summary.inventoryViolationsCollection.documentCount = await violationsCollection.countDocuments({})

    if (!dryRun) {
      await violationsCollection.drop()
      summary.inventoryViolationsCollection.dropped = true
    }
  }

  const ordersCollection = db.collection('orders')
  const ordersWithInconsistencies = await ordersCollection.countDocuments({
    inventoryInconsistencies: { $exists: true },
  })

  summary.ordersInconsistenciesField.matched = ordersWithInconsistencies

  if (!dryRun && ordersWithInconsistencies > 0) {
    const result = await ordersCollection.updateMany(
      { inventoryInconsistencies: { $exists: true } },
      { $unset: { inventoryInconsistencies: '' } },
    )
    summary.ordersInconsistenciesField.modified = Number(result.modifiedCount || 0)
  }

  console.log(JSON.stringify(summary, null, 2))
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await closeDB()
    } catch {
      // ignore close errors in cleanup script teardown
    }
  })
