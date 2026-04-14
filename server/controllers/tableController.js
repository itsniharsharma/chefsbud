import Table from '../models/Table.js'
import { invalidateCacheByTags } from '../services/responseCache.js'
import { recordEndpointMetric } from '../middleware/performanceTracing.js'
import { logger } from '../utils/logger.js'
import { resolveRequestRestaurant } from '../utils/requestRestaurant.js'

const TABLE_READ_TRACE_TIMING = String(process.env.TABLE_READ_TRACE_TIMING || 'false') === 'true'
const TABLE_READ_SLOW_MS = Math.max(200, Number(process.env.TABLE_READ_SLOW_MS || 250))

function elapsedMs(startNs) {
  return Number(process.hrtime.bigint() - startNs) / 1_000_000
}

function shouldLogReadTiming(totalMs) {
  return TABLE_READ_TRACE_TIMING || totalMs >= TABLE_READ_SLOW_MS
}

function logTablesReadTiming({ req, restaurantId, totalMs, resolveRestaurantMs, queryMs, cacheHit }) {
  recordEndpointMetric(req, 'tables_read_ms', totalMs, {
    cacheHit: cacheHit ? 'yes' : 'no',
  })

  if (!shouldLogReadTiming(totalMs)) {
    return
  }

  logger.info('tables_read_timing', {
    restaurantId,
    cacheHit: cacheHit ? 'yes' : 'no',
    resolveRestaurantMs: Math.round(Number(resolveRestaurantMs || 0)),
    queryMs: Math.round(Number(queryMs || 0)),
    totalMs: Math.round(Number(totalMs || 0)),
  })
}

export async function createTables(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const { count, tableNumber, floorNumber = 1, active = true } = req.body
    const parsedFloorNumber = Number(floorNumber)
    if (!Number.isFinite(parsedFloorNumber) || parsedFloorNumber < 1) {
      return res.status(400).json({ message: 'floorNumber must be at least 1' })
    }
    const normalizedFloorNumber = Math.floor(parsedFloorNumber)

    if (count) {
      const total = Number(count)
      if (!total || total < 1) {
        return res.status(400).json({ message: 'count must be at least 1' })
      }

      const lastTable = await Table.findOne({ restaurantId: restaurant._id })
        .sort({ tableNumber: -1 })
        .select('tableNumber')
        .lean()
      const maxTable = lastTable?.tableNumber || 0

      const docs = Array.from({ length: total }, (_, index) => ({
        restaurantId: restaurant._id,
        floorNumber: normalizedFloorNumber,
        tableNumber: maxTable + index + 1,
        active: true,
      }))

      await Table.insertMany(docs, { ordered: false })
      invalidateCacheByTags([
        `analytics:${String(restaurant._id)}`,
        `tables:${String(restaurant._id)}`,
      ], { skipRedis: true })
      const tables = await Table.find({ restaurantId: restaurant._id }).sort({ floorNumber: 1, tableNumber: 1 }).lean()
      return res.status(201).json(tables)
    }

    if (!tableNumber) {
      return res.status(400).json({ message: 'tableNumber or count is required' })
    }

    const table = await Table.create({
      restaurantId: restaurant._id,
      floorNumber: normalizedFloorNumber,
      tableNumber: Number(tableNumber),
      active: Boolean(active),
    })

    invalidateCacheByTags([
      `analytics:${String(restaurant._id)}`,
      `tables:${String(restaurant._id)}`,
    ], { skipRedis: true })

    return res.status(201).json(table)
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Table number already exists' })
    }
    next(error)
  }
}

export async function getTables(req, res, next) {
  try {
    const requestStartedAt = process.hrtime.bigint()
    const resolveStartedAt = process.hrtime.bigint()
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }
    const resolveRestaurantMs = elapsedMs(resolveStartedAt)

    if (String(restaurant._id) !== req.params.restaurantId) {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const queryStartedAt = process.hrtime.bigint()
    const tables = await Table.find({ restaurantId: req.params.restaurantId }).sort({ floorNumber: 1, tableNumber: 1 }).lean()
    const queryMs = elapsedMs(queryStartedAt)

    logTablesReadTiming({
      req,
      restaurantId: req.params.restaurantId,
      totalMs: elapsedMs(requestStartedAt),
      resolveRestaurantMs,
      queryMs,
      cacheHit: false,
    })

    return res.json(tables)
  } catch (error) {
    next(error)
  }
}
