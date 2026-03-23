import Table from '../models/Table.js'
import { invalidateCacheByTags } from '../services/responseCache.js'
import { resolveRequestRestaurant } from '../utils/requestRestaurant.js'

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
      invalidateCacheByTags([`analytics:${String(restaurant._id)}`])
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

    invalidateCacheByTags([`analytics:${String(restaurant._id)}`])

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
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    if (String(restaurant._id) !== req.params.restaurantId) {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const tables = await Table.find({ restaurantId: req.params.restaurantId }).sort({ floorNumber: 1, tableNumber: 1 }).lean()
    return res.json(tables)
  } catch (error) {
    next(error)
  }
}
