import 'dotenv/config'
import mongoose from 'mongoose'
import bcrypt from 'bcrypt'
import User from '../server/models/User.js'
import Restaurant from '../server/models/Restaurant.js'
import StaffAccount from '../server/models/StaffAccount.js'
import Order from '../server/models/Order.js'
import OrderDailyCounter from '../server/models/OrderDailyCounter.js'
import OrderDailyMetrics from '../server/models/OrderDailyMetrics.js'
import OrderHourlyMetrics from '../server/models/OrderHourlyMetrics.js'
import OrderInventoryJob from '../server/models/OrderInventoryJob.js'
import AnalyticsDailyMetrics from '../server/models/AnalyticsDailyMetrics.js'
import AnalyticsMonthlyMetrics from '../server/models/AnalyticsMonthlyMetrics.js'
import AnalyticsItemDailyMetrics from '../server/models/AnalyticsItemDailyMetrics.js'
import AnalyticsItemMonthlyMetrics from '../server/models/AnalyticsItemMonthlyMetrics.js'
import AnalyticsBasketPairDaily from '../server/models/AnalyticsBasketPairDaily.js'
import AnalyticsBasketPairMonthly from '../server/models/AnalyticsBasketPairMonthly.js'
import AnalyticsEventIngestion from '../server/models/AnalyticsEventIngestion.js'
import AnalyticsExposureSession from '../server/models/AnalyticsExposureSession.js'
import AnalyticsOrderInsightsDaily from '../server/models/AnalyticsOrderInsightsDaily.js'
import { invalidateOrderQueries } from '../server/services/queryResultCache.js'

const emailArg = process.argv.find((arg) => arg.startsWith('--email=')) || ''
const passkeyArg = process.argv.find((arg) => arg.startsWith('--passkey=')) || ''
const dryRun = process.argv.includes('--dry-run')

const ownerEmail = (emailArg.split('=')[1] || '').trim().toLowerCase()
const passkey = String(passkeyArg.split('=')[1] || '').trim()

if (!ownerEmail) {
  throw new Error('Missing --email argument')
}

if (!passkey) {
  throw new Error('Missing --passkey argument')
}

async function verifyPasskey(user, restaurant, plainPasskey) {
  const passkeyChecks = []

  if (typeof user?.password === 'string' && user.password.length > 0) {
    passkeyChecks.push(bcrypt.compare(plainPasskey, user.password).catch(() => false))
  }

  const kotHash = String(restaurant?.kotReprintConfig?.passkeyHash || '')
  if (kotHash) {
    passkeyChecks.push(bcrypt.compare(plainPasskey, kotHash).catch(() => false))
  }

  const staffAccounts = await StaffAccount.find({
    ownerId: user._id,
    restaurantId: restaurant._id,
    isActive: true,
  })
    .select('passkeyHash')
    .lean()

  for (const staff of staffAccounts) {
    if (typeof staff?.passkeyHash === 'string' && staff.passkeyHash.length > 0) {
      passkeyChecks.push(bcrypt.compare(plainPasskey, staff.passkeyHash).catch(() => false))
    }
  }

  if (!passkeyChecks.length) {
    return false
  }

  const results = await Promise.all(passkeyChecks)
  return results.some(Boolean)
}

async function deleteByRestaurantId(restaurantId) {
  const tasks = [
    ['orders', Order],
    ['orderDailyCounters', OrderDailyCounter],
    ['orderDailyMetrics', OrderDailyMetrics],
    ['orderHourlyMetrics', OrderHourlyMetrics],
    ['orderInventoryJobs', OrderInventoryJob],
    ['analyticsDailyMetrics', AnalyticsDailyMetrics],
    ['analyticsMonthlyMetrics', AnalyticsMonthlyMetrics],
    ['analyticsItemDailyMetrics', AnalyticsItemDailyMetrics],
    ['analyticsItemMonthlyMetrics', AnalyticsItemMonthlyMetrics],
    ['analyticsBasketPairDaily', AnalyticsBasketPairDaily],
    ['analyticsBasketPairMonthly', AnalyticsBasketPairMonthly],
    ['analyticsEventIngestion', AnalyticsEventIngestion],
    ['analyticsExposureSession', AnalyticsExposureSession],
    ['analyticsOrderInsightsDaily', AnalyticsOrderInsightsDaily],
  ]

  const summary = {}

  for (const [key, model] of tasks) {
    if (dryRun) {
      summary[key] = await model.countDocuments({ restaurantId })
      continue
    }

    const result = await model.deleteMany({ restaurantId })
    summary[key] = Number(result?.deletedCount || 0)
  }

  return summary
}

async function run() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing in environment')
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 })

  const user = await User.findOne({ email: ownerEmail })
    .select('_id email password')
    .lean()

  if (!user) {
    throw new Error(`User not found for email: ${ownerEmail}`)
  }

  const restaurant = await Restaurant.findOne({ ownerId: user._id })
    .select('_id name slug ownerId kotReprintConfig.passkeyHash')
    .lean()

  if (!restaurant) {
    throw new Error(`Restaurant not found for owner: ${ownerEmail}`)
  }

  const authorized = await verifyPasskey(user, restaurant, passkey)
  if (!authorized) {
    throw new Error('Passkey verification failed for this account')
  }

  const summary = await deleteByRestaurantId(restaurant._id)

  if (!dryRun) {
    await invalidateOrderQueries(restaurant._id)
  }

  console.log(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'delete',
    ownerEmail,
    restaurant: {
      id: String(restaurant._id),
      name: restaurant.name,
      slug: restaurant.slug,
    },
    summary,
  }, null, 2))
}

run()
  .catch((error) => {
    console.error('[clearOrdersAndAnalyticsSimulation] failed:', error?.message || error)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await mongoose.disconnect()
    } catch {
      // no-op
    }
  })
