import mongoose from 'mongoose'
import GoodsReceiptNote from '../models/GoodsReceiptNote.js'
import InventoryBatch from '../models/InventoryBatch.js'
import InventoryItem from '../models/InventoryItem.js'
import InventoryLocation from '../models/InventoryLocation.js'
import PurchaseOrder from '../models/PurchaseOrder.js'
import RecipeVersion from '../models/RecipeVersion.js'
import TransferOrder from '../models/TransferOrder.js'
import { addLedgerEntries } from '../services/inventoryService.js'
import {
  consumeReservationsForOrder,
  ensureDefaultInventoryLocation,
  getAvailableStockByLocation,
  releaseReservationsForOrder,
  reserveStockForOrder,
} from '../services/inventoryV2Service.js'
import { resolveInventoryPolicy } from '../config/inventoryRuntime.js'
import { resolveRequestRestaurant } from '../utils/requestRestaurant.js'

function toObjectIdString(value) {
  return String(value || '').trim()
}

function round6(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1_000_000) / 1_000_000
}

function unitToBase(unit = '') {
  const normalized = String(unit || '').trim().toLowerCase()
  if (normalized === 'kg') return { unit: 'g', factor: 1000 }
  if (normalized === 'gram' || normalized === 'g') return { unit: 'g', factor: 1 }
  if (normalized === 'litre' || normalized === 'liter' || normalized === 'l') return { unit: 'ml', factor: 1000 }
  if (normalized === 'ml') return { unit: 'ml', factor: 1 }
  if (normalized === 'unit' || normalized === 'packet') return { unit: 'unit', factor: 1 }
  if (normalized === 'units' || normalized === 'packets') return { unit: 'unit', factor: 1 }
  throw new Error(`Unsupported unit: ${unit}`)
}

function nextCode(prefix, existingCount) {
  return `${prefix}${String(existingCount + 1).padStart(3, '0')}`
}

export async function listInventoryLocations(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const locations = await InventoryLocation.find({ restaurantId: restaurant._id })
      .sort({ isDefault: -1, createdAt: 1 })
      .lean()

    return res.json({ locations })
  } catch (error) {
    next(error)
  }
}

export async function createInventoryLocation(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const name = String(req.body?.name || '').trim()
    const type = String(req.body?.type || 'Store').trim()
    const codeInput = String(req.body?.code || '').trim().toUpperCase()
    const isDefault = Boolean(req.body?.isDefault)

    const existingCount = await InventoryLocation.countDocuments({ restaurantId: restaurant._id })
    const code = codeInput || nextCode('LOC', existingCount)

    if (isDefault) {
      await InventoryLocation.updateMany(
        { restaurantId: restaurant._id, isDefault: true },
        { $set: { isDefault: false } },
      )
    }

    const location = await InventoryLocation.create({
      restaurantId: restaurant._id,
      name,
      type,
      code,
      isDefault,
      isActive: true,
    })

    return res.status(201).json(location)
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Location code already exists' })
    }
    next(error)
  }
}

export async function getAvailableInventoryStock(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const defaultLocation = await ensureDefaultInventoryLocation(restaurant._id)
    const locationId = String(req.query?.locationId || defaultLocation._id)
    const itemIds = String(req.query?.itemIds || '')
      .split(',')
      .map((row) => row.trim())
      .filter(Boolean)

    const rows = await getAvailableStockByLocation({
      restaurantId: restaurant._id,
      locationId,
      inventoryItemIds: itemIds,
    })

    return res.json({ locationId, rows })
  } catch (error) {
    next(error)
  }
}

export async function reserveInventoryStock(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const orderLike = {
      _id: String(req.body?.orderId || '').trim(),
      restaurantId: restaurant._id,
      items: Array.isArray(req.body?.items) ? req.body.items : [],
    }

    if (!orderLike._id) {
      return res.status(400).json({ message: 'orderId is required' })
    }

    const session = await mongoose.startSession()
    let result = null

    try {
      await session.withTransaction(async () => {
        result = await reserveStockForOrder({
          restaurantId: restaurant._id,
          order: orderLike,
          createdBy: req.user?._id || null,
          locationId: req.body?.locationId || null,
          policy: resolveInventoryPolicy(req.body?.policy),
          idempotencyPrefix: 'manual_reserve',
          session,
        })
      })
    } finally {
      session.endSession()
    }

    return res.status(201).json({ success: true, ...result })
  } catch (error) {
    next(error)
  }
}

export async function releaseReservedInventoryStock(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const orderId = String(req.body?.orderId || '').trim()
    if (!orderId) {
      return res.status(400).json({ message: 'orderId is required' })
    }

    const session = await mongoose.startSession()
    let result = null

    try {
      await session.withTransaction(async () => {
        result = await releaseReservationsForOrder({
          restaurantId: restaurant._id,
          orderId,
          createdBy: req.user?._id || null,
          reason: String(req.body?.reason || 'manual_release').trim(),
          session,
        })
      })
    } finally {
      session.endSession()
    }

    return res.json({ success: true, ...result })
  } catch (error) {
    next(error)
  }
}

export async function consumeReservedInventoryStock(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const orderId = String(req.body?.orderId || '').trim()
    if (!orderId) {
      return res.status(400).json({ message: 'orderId is required' })
    }

    const session = await mongoose.startSession()
    let result = null

    try {
      await session.withTransaction(async () => {
        result = await consumeReservationsForOrder({
          restaurantId: restaurant._id,
          orderId,
          createdBy: req.user?._id || null,
          cycle: Number(req.body?.cycle || 1),
          policy: resolveInventoryPolicy(req.body?.policy),
          session,
        })
      })
    } finally {
      session.endSession()
    }

    return res.json({ success: true, ...result })
  } catch (error) {
    next(error)
  }
}

export async function createPurchaseOrder(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' })

    const items = Array.isArray(req.body?.items) ? req.body.items : []
    if (!items.length) return res.status(400).json({ message: 'At least one PO line item is required' })

    const existingCount = await PurchaseOrder.countDocuments({ restaurantId: restaurant._id })
    const poNumber = String(req.body?.poNumber || nextCode('PO-', existingCount)).trim()

    const itemIds = [...new Set(items.map((row) => toObjectIdString(row?.inventoryItemId)).filter(Boolean))]
    const dbItems = await InventoryItem.find({ _id: { $in: itemIds }, restaurantId: restaurant._id })
      .select('_id name')
      .lean()
    const itemById = new Map(dbItems.map((row) => [String(row._id), row]))

    const normalizedItems = items.map((row) => ({
      inventoryItemId: String(row.inventoryItemId),
      itemName: String(itemById.get(String(row.inventoryItemId))?.name || row.itemName || '').trim(),
      orderedQty: Number(row.orderedQty || 0),
      receivedQty: 0,
      unit: String(row.unit || 'Unit').trim(),
      expectedRate: Number(row.expectedRate || 0),
    }))

    const po = await PurchaseOrder.create({
      restaurantId: restaurant._id,
      poNumber,
      supplierId: req.body?.supplierId || null,
      supplierNameSnapshot: String(req.body?.supplierNameSnapshot || '').trim(),
      locationId: req.body?.locationId || null,
      expectedDate: req.body?.expectedDate || null,
      notes: String(req.body?.notes || '').trim(),
      status: 'draft',
      items: normalizedItems,
      createdBy: req.user?._id || null,
    })

    return res.status(201).json(po)
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'PO number already exists' })
    next(error)
  }
}

export async function approvePurchaseOrder(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' })

    const po = await PurchaseOrder.findOneAndUpdate(
      { _id: req.params.poId, restaurantId: restaurant._id, status: { $in: ['draft', 'approved'] } },
      {
        $set: {
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: req.user?._id || null,
        },
      },
      { returnDocument: 'after' },
    )

    if (!po) return res.status(404).json({ message: 'Purchase order not found' })
    return res.json(po)
  } catch (error) {
    next(error)
  }
}

export async function receiveGoodsReceipt(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' })

    const po = await PurchaseOrder.findOne({
      _id: req.params.poId,
      restaurantId: restaurant._id,
      status: { $in: ['approved', 'partially_received'] },
    })

    if (!po) return res.status(404).json({ message: 'Approved purchase order not found' })

    const lines = Array.isArray(req.body?.lines) ? req.body.lines : []
    if (!lines.length) return res.status(400).json({ message: 'At least one GRN line is required' })

    const defaultLocation = await ensureDefaultInventoryLocation(restaurant._id)
    const locationId = req.body?.locationId || po.locationId || defaultLocation._id

    const session = await mongoose.startSession()
    let grn = null

    try {
      await session.withTransaction(async () => {
        const existingCount = await GoodsReceiptNote.countDocuments({ restaurantId: restaurant._id }).session(session)
        const grnNumber = String(req.body?.grnNumber || nextCode('GRN-', existingCount)).trim()

        const normalizedLines = lines.map((row) => {
          const receivedQty = Number(row.receivedQty || 0)
          const acceptedQty = Number(row.acceptedQty == null ? receivedQty : row.acceptedQty)
          const rejectedQty = Math.max(0, receivedQty - acceptedQty)

          return {
            purchaseOrderItemIndex: Number(row.purchaseOrderItemIndex || 0),
            inventoryItemId: String(row.inventoryItemId),
            itemName: String(row.itemName || '').trim(),
            orderedQty: Number(row.orderedQty || 0),
            receivedQty,
            acceptedQty,
            rejectedQty,
            unit: String(row.unit || 'Unit'),
            unitRate: Number(row.unitRate || 0),
            note: String(row.note || '').trim(),
          }
        })

        grn = await GoodsReceiptNote.create(
          [{
            restaurantId: restaurant._id,
            purchaseOrderId: po._id,
            grnNumber,
            locationId,
            status: 'partial',
            lines: normalizedLines,
            invoiceNumber: String(req.body?.invoiceNumber || '').trim(),
            invoiceDate: req.body?.invoiceDate || null,
            receivedBy: req.user?._id || null,
          }],
          { session },
        )

        const acceptedByItem = new Map()
        const ledgerEntries = []
        const batchDocs = []

        normalizedLines.forEach((line, idx) => {
          const converted = unitToBase(line.unit)
          const qtyAcceptedBase = round6(Number(line.acceptedQty || 0) * converted.factor)
          if (qtyAcceptedBase <= 0) return

          const key = String(line.inventoryItemId)
          acceptedByItem.set(key, round6(Number(acceptedByItem.get(key) || 0) + qtyAcceptedBase))

          ledgerEntries.push({
            restaurantId: restaurant._id,
            locationId,
            inventoryItemId: line.inventoryItemId,
            type: 'PURCHASE',
            quantity: qtyAcceptedBase,
            direction: 1,
            unit: converted.unit,
            referenceType: 'grn',
            referenceId: grn[0]._id,
            metadata: {
              poId: String(po._id),
              grnNumber,
              lineIndex: idx,
              acceptedQty: Number(line.acceptedQty || 0),
              rejectedQty: Number(line.rejectedQty || 0),
              unitRate: Number(line.unitRate || 0),
            },
            createdBy: req.user?._id || null,
            idempotencyKey: `grn:${String(grn[0]._id)}:item:${String(line.inventoryItemId)}:${idx}`,
          })

          const batchCode = `${grnNumber}-${String(idx + 1).padStart(2, '0')}`
          batchDocs.push({
            restaurantId: restaurant._id,
            locationId,
            inventoryItemId: line.inventoryItemId,
            grnId: grn[0]._id,
            batchCode,
            supplierBatchCode: '',
            expiryDate: line.expiryDate || null,
            unit: converted.unit,
            unitCost: Number(line.unitRate || 0) / Math.max(converted.factor, 1),
            quantityReceived: qtyAcceptedBase,
            quantityRemaining: qtyAcceptedBase,
            fifoRank: Date.now() + idx,
          })
        })

        if (batchDocs.length) {
          await InventoryBatch.insertMany(batchDocs, {
            ordered: false,
            session,
          })
        }

        if (ledgerEntries.length) {
          await addLedgerEntries(ledgerEntries, { session })
        }

        let fullyReceived = true
        po.items = (Array.isArray(po.items) ? po.items : []).map((item) => {
          const itemId = String(item.inventoryItemId || '')
          const converted = unitToBase(item.unit)
          const prevReceivedBase = round6(Number(item.receivedQty || 0) * converted.factor)
          const incomingBase = round6(Number(acceptedByItem.get(itemId) || 0))
          const nextReceivedBase = round6(prevReceivedBase + incomingBase)
          const orderedBase = round6(Number(item.orderedQty || 0) * converted.factor)
          if (nextReceivedBase + 0.000001 < orderedBase) {
            fullyReceived = false
          }
          const receivedInOriginalUnit = round6(nextReceivedBase / Math.max(converted.factor, 1))
          const baseItem = item?.toObject ? item.toObject() : item
          return {
            ...baseItem,
            receivedQty: receivedInOriginalUnit,
          }
        })

        po.status = fullyReceived ? 'fully_received' : 'partially_received'
        await po.save({ session })

        grn[0].status = fullyReceived ? 'full' : 'partial'
        await grn[0].save({ session })
      })
    } finally {
      session.endSession()
    }

    return res.status(201).json(grn[0])
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'GRN number already exists' })
    next(error)
  }
}

export async function createTransferOrder(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' })

    const fromLocationId = String(req.body?.fromLocationId || '').trim()
    const toLocationId = String(req.body?.toLocationId || '').trim()
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : []

    if (!fromLocationId || !toLocationId || fromLocationId === toLocationId) {
      return res.status(400).json({ message: 'Valid source and destination locations are required' })
    }

    if (!lines.length) {
      return res.status(400).json({ message: 'At least one transfer line is required' })
    }

    const existingCount = await TransferOrder.countDocuments({ restaurantId: restaurant._id })
    const transferNumber = String(req.body?.transferNumber || nextCode('TRF-', existingCount)).trim()

    const transfer = await TransferOrder.create({
      restaurantId: restaurant._id,
      transferNumber,
      fromLocationId,
      toLocationId,
      status: 'requested',
      lines: lines.map((row) => ({
        inventoryItemId: String(row.inventoryItemId),
        itemName: String(row.itemName || '').trim(),
        quantity: Number(row.quantity || 0),
        unit: String(row.unit || 'unit').trim(),
        dispatchedQty: 0,
        receivedQty: 0,
      })),
      requestedBy: req.user?._id || null,
    })

    return res.status(201).json(transfer)
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'Transfer number already exists' })
    next(error)
  }
}

export async function dispatchTransferOrder(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' })

    const transfer = await TransferOrder.findOne({
      _id: req.params.transferId,
      restaurantId: restaurant._id,
      status: { $in: ['requested', 'dispatched'] },
    })

    if (!transfer) return res.status(404).json({ message: 'Transfer order not found' })

    const session = await mongoose.startSession()

    try {
      await session.withTransaction(async () => {
        const ledgerEntries = []

        transfer.lines = transfer.lines.map((line) => {
          const qty = Number(line.quantity || 0)
          const converted = unitToBase(line.unit)
          const baseQty = round6(qty * converted.factor)
          if (baseQty > 0) {
            ledgerEntries.push({
              restaurantId: restaurant._id,
              locationId: transfer.fromLocationId,
              inventoryItemId: line.inventoryItemId,
              type: 'TRANSFER_OUT',
              quantity: baseQty,
              direction: -1,
              unit: converted.unit,
              referenceType: 'transfer_dispatch',
              referenceId: transfer._id,
              metadata: { transferNumber: transfer.transferNumber },
              createdBy: req.user?._id || null,
              idempotencyKey: `transfer:${String(transfer._id)}:dispatch:${String(line.inventoryItemId)}`,
            })
          }
          const baseLine = line?.toObject ? line.toObject() : line
          return {
            ...baseLine,
            dispatchedQty: qty,
          }
        })

        if (ledgerEntries.length) {
          await addLedgerEntries(ledgerEntries, { session })
        }

        transfer.status = 'dispatched'
        transfer.dispatchedBy = req.user?._id || null
        transfer.dispatchedAt = new Date()
        await transfer.save({ session })
      })
    } finally {
      session.endSession()
    }

    return res.json(transfer)
  } catch (error) {
    next(error)
  }
}

export async function receiveTransferOrder(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' })

    const transfer = await TransferOrder.findOne({
      _id: req.params.transferId,
      restaurantId: restaurant._id,
      status: 'dispatched',
    })

    if (!transfer) return res.status(404).json({ message: 'Dispatched transfer order not found' })

    const session = await mongoose.startSession()

    try {
      await session.withTransaction(async () => {
        const ledgerEntries = []

        transfer.lines = transfer.lines.map((line) => {
          const qty = Number(line.dispatchedQty || line.quantity || 0)
          const converted = unitToBase(line.unit)
          const baseQty = round6(qty * converted.factor)
          if (baseQty > 0) {
            ledgerEntries.push({
              restaurantId: restaurant._id,
              locationId: transfer.toLocationId,
              inventoryItemId: line.inventoryItemId,
              type: 'TRANSFER_IN',
              quantity: baseQty,
              direction: 1,
              unit: converted.unit,
              referenceType: 'transfer_receive',
              referenceId: transfer._id,
              metadata: { transferNumber: transfer.transferNumber },
              createdBy: req.user?._id || null,
              idempotencyKey: `transfer:${String(transfer._id)}:receive:${String(line.inventoryItemId)}`,
            })
          }
          const baseLine = line?.toObject ? line.toObject() : line
          return {
            ...baseLine,
            receivedQty: qty,
          }
        })

        if (ledgerEntries.length) {
          await addLedgerEntries(ledgerEntries, { session })
        }

        transfer.status = 'received'
        transfer.receivedBy = req.user?._id || null
        transfer.receivedAt = new Date()
        await transfer.save({ session })
      })
    } finally {
      session.endSession()
    }

    return res.json(transfer)
  } catch (error) {
    next(error)
  }
}

export async function createRecipeVersion(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' })

    const menuItemId = String(req.params.menuItemId || '').trim()
    const ingredients = Array.isArray(req.body?.ingredients) ? req.body.ingredients : []
    if (!menuItemId || !ingredients.length) {
      return res.status(400).json({ message: 'menuItemId and ingredients are required' })
    }

    const latest = await RecipeVersion.findOne({ restaurantId: restaurant._id, menuItemId })
      .sort({ version: -1 })
      .lean()

    const version = Number(latest?.version || 0) + 1
    const normalized = ingredients.map((row) => {
      const converted = unitToBase(row.unit)
      return {
        inventoryItemId: String(row.inventoryItemId),
        quantity: round6(Number(row.quantity || 0) * converted.factor),
        unit: converted.unit,
      }
    }).filter((row) => row.inventoryItemId && row.quantity > 0)

    const created = await RecipeVersion.create({
      restaurantId: restaurant._id,
      menuItemId,
      version,
      ingredients: normalized,
      createdBy: req.user?._id || null,
    })

    return res.status(201).json(created)
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'Recipe version already exists' })
    next(error)
  }
}

export async function listRecipeVersions(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' })

    const menuItemId = String(req.params.menuItemId || '').trim()
    if (!menuItemId) return res.status(400).json({ message: 'menuItemId is required' })

    const versions = await RecipeVersion.find({ restaurantId: restaurant._id, menuItemId })
      .sort({ version: -1 })
      .lean()

    return res.json({ versions })
  } catch (error) {
    next(error)
  }
}
