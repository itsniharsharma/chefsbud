import 'dotenv/config'
import mongoose from 'mongoose'
import User from '../server/models/User.js'
import Restaurant from '../server/models/Restaurant.js'
import InventoryItem from '../server/models/InventoryItem.js'
import InventorySupplier from '../server/models/InventorySupplier.js'
import InventoryPurchase from '../server/models/InventoryPurchase.js'
import { composePurchasePayload } from '../server/services/inventoryPurchaseService.js'
import { addLedgerEntries } from '../server/services/inventoryService.js'

const emailArg = process.argv.find((arg) => arg.startsWith('--email=')) || ''
const ownerEmail = (emailArg.split('=')[1] || 'itsniharsharmas@gmail.com').trim().toLowerCase()

const invoiceDefinition = {
  sourceType: 'Supplier',
  supplierName: 'FreshMart Distributors Pvt Ltd',
  invoiceDate: '2026-04-12',
  gstNo: '29ABCDE1234F2Z5',
  cgstPercent: 9,
  sgstPercent: 9,
  igstPercent: 0,
  discountType: 'Percentage',
  discountValue: 0,
  invoiceNumber: 'INV-PS-001',
  deliveryCharge: 150,
  paymentType: 'Unpaid',
  items: [
    { name: 'Refined Flour (Maida)', quantity: 100, unit: 'Kg', rate: 35 },
    { name: 'Dry Yeast', quantity: 2, unit: 'Kg', rate: 400 },
    { name: 'Sugar', quantity: 20, unit: 'Kg', rate: 45 },
    { name: 'Salt', quantity: 10, unit: 'Kg', rate: 20 },
    { name: 'Olive Oil', quantity: 15, unit: 'L', rate: 600 },
    { name: 'Pizza Base (Ready)', quantity: 200, unit: 'Nos', rate: 25 },
    { name: 'Mozzarella Cheese', quantity: 50, unit: 'Kg', rate: 400 },
    { name: 'Processed Cheese', quantity: 30, unit: 'Kg', rate: 300 },
    { name: 'Butter', quantity: 20, unit: 'Kg', rate: 500 },
    { name: 'Milk', quantity: 100, unit: 'L', rate: 55 },
    { name: 'Cream', quantity: 20, unit: 'L', rate: 250 },
    { name: 'Onion', quantity: 50, unit: 'Kg', rate: 25 },
    { name: 'Tomato', quantity: 60, unit: 'Kg', rate: 30 },
    { name: 'Capsicum', quantity: 40, unit: 'Kg', rate: 50 },
    { name: 'Sweet Corn', quantity: 25, unit: 'Kg', rate: 80 },
    { name: 'Mushroom', quantity: 20, unit: 'Kg', rate: 120 },
    { name: 'Paneer', quantity: 40, unit: 'Kg', rate: 350 },
    { name: 'Black Olives', quantity: 10, unit: 'Kg', rate: 300 },
    { name: 'Jalapeno', quantity: 8, unit: 'Kg', rate: 350 },
    { name: 'Potato', quantity: 60, unit: 'Kg', rate: 20 },
    { name: 'Green Chilli', quantity: 5, unit: 'Kg', rate: 60 },
    { name: 'Lettuce', quantity: 10, unit: 'Kg', rate: 80 },
    { name: 'Pizza Sauce', quantity: 30, unit: 'Kg', rate: 120 },
    { name: 'Tomato Ketchup', quantity: 25, unit: 'Kg', rate: 90 },
    { name: 'Mayonnaise', quantity: 20, unit: 'Kg', rate: 110 },
    { name: 'Peri Peri Sauce', quantity: 10, unit: 'Kg', rate: 200 },
    { name: 'Red Chilli Flakes', quantity: 5, unit: 'Kg', rate: 400 },
    { name: 'Oregano', quantity: 3, unit: 'Kg', rate: 600 },
    { name: 'Black Pepper', quantity: 2, unit: 'Kg', rate: 700 },
    { name: 'Salt Seasoning Mix', quantity: 5, unit: 'Kg', rate: 200 },
    { name: 'Burger Buns', quantity: 300, unit: 'Nos', rate: 12 },
    { name: 'Multigrain Buns', quantity: 150, unit: 'Nos', rate: 15 },
    { name: 'Bread Loaf', quantity: 200, unit: 'Nos', rate: 30 },
    { name: 'Paneer Patty', quantity: 100, unit: 'Nos', rate: 25 },
    { name: 'Aloo Patty', quantity: 150, unit: 'Nos', rate: 15 },
    { name: 'Tortilla Wraps', quantity: 200, unit: 'Nos', rate: 12 },
    { name: 'Sub Bread (6 inch)', quantity: 100, unit: 'Nos', rate: 20 },
    { name: 'Sub Bread (12 inch)', quantity: 80, unit: 'Nos', rate: 35 },
    { name: 'Pasta Raw', quantity: 40, unit: 'Kg', rate: 120 },
    { name: 'Maggi Noodles', quantity: 200, unit: 'Pack', rate: 14 },
    { name: 'White Sauce Base', quantity: 20, unit: 'Kg', rate: 150 },
    { name: 'Red Sauce Base', quantity: 20, unit: 'Kg', rate: 130 },
    { name: 'Spring Roll Sheets', quantity: 20, unit: 'Kg', rate: 150 },
    { name: 'Momos Dough', quantity: 30, unit: 'Kg', rate: 60 },
    { name: 'Schezwan Sauce', quantity: 10, unit: 'Kg', rate: 180 },
    { name: 'Frozen Fries', quantity: 100, unit: 'Kg', rate: 120 },
    { name: 'Cheese Sauce', quantity: 20, unit: 'Kg', rate: 200 },
    { name: 'Soft Drink Syrup', quantity: 50, unit: 'L', rate: 70 },
    { name: 'Packaged Cold Drinks', quantity: 200, unit: 'Nos', rate: 40 },
    { name: 'Coffee Powder', quantity: 10, unit: 'Kg', rate: 600 },
    { name: 'Tea Leaves', quantity: 10, unit: 'Kg', rate: 400 },
    { name: 'Chocolate Syrup', quantity: 10, unit: 'L', rate: 250 },
    { name: 'Ice Cream Base', quantity: 50, unit: 'L', rate: 150 },
    { name: 'Flavour Syrups (Strawberry, Mango, Vanilla)', quantity: 20, unit: 'L', rate: 200 },
    { name: 'Oreo Biscuits', quantity: 50, unit: 'Pack', rate: 20 },
    { name: 'Garlic Butter', quantity: 15, unit: 'Kg', rate: 300 },
    { name: 'Bread Base', quantity: 100, unit: 'Nos', rate: 25 },
    { name: 'Pizza Boxes', quantity: 500, unit: 'Nos', rate: 10 },
    { name: 'Burger Wrappers', quantity: 500, unit: 'Nos', rate: 2 },
    { name: 'Paper Cups', quantity: 500, unit: 'Nos', rate: 3 },
    { name: 'Plastic Glass', quantity: 500, unit: 'Nos', rate: 2 },
    { name: 'Straws', quantity: 1000, unit: 'Nos', rate: 0.5 },
    { name: 'Tissue Paper', quantity: 100, unit: 'Pack', rate: 30 },
  ],
}

function mapUnit(unit) {
  const normalized = String(unit || '').trim().toLowerCase()
  if (normalized === 'kg' || normalized === 'kilogram' || normalized === 'kilograms') return 'Kg'
  if (normalized === 'gram' || normalized === 'grams' || normalized === 'g') return 'Gram'
  if (normalized === 'l' || normalized === 'litre' || normalized === 'liter' || normalized === 'litres' || normalized === 'liters') return 'Litre'
  if (normalized === 'ml' || normalized === 'millilitre' || normalized === 'milliliter') return 'Ml'
  if (normalized === 'pack' || normalized === 'packet' || normalized === 'packs' || normalized === 'packets') return 'Packet'
  if (normalized === 'nos' || normalized === 'no' || normalized === 'unit' || normalized === 'units') return 'Unit'
  throw new Error(`Unsupported unit: ${unit}`)
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function buildPurchaseLedgerEntries({ restaurantId, purchase, createdBy, referenceType = 'purchase' }) {
  const rows = Array.isArray(purchase?.items) ? purchase.items : []
  return rows
    .map((row, index) => {
      const itemId = String(row?.itemId || '').trim()
      const quantity = Number(row?.quantity || 0)
      const unit = String(row?.unit || '').trim()
      if (!itemId || quantity <= 0 || !unit) return null

      return {
        restaurantId,
        inventoryItemId: itemId,
        type: 'PURCHASE',
        quantity,
        direction: 1,
        unit,
        referenceType,
        referenceId: purchase?._id || null,
        metadata: {
          purchaseId: String(purchase?._id || ''),
          invoiceNumber: String(purchase?.invoiceNumber || ''),
          sourceType: String(purchase?.sourceType || ''),
          itemIndex: index,
          simulationImport: true,
        },
        createdBy,
        idempotencyKey: purchase?._id ? `purchase:${String(purchase._id)}:item:${itemId}:${index}` : '',
      }
    })
    .filter(Boolean)
}

async function run() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing in .env')
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 })

  const user = await User.findOne({ email: ownerEmail }).select('_id email role').lean()
  if (!user) throw new Error(`User not found for email: ${ownerEmail}`)

  const restaurant = await Restaurant.findOne({ ownerId: user._id }).select('_id name slug').lean()
  if (!restaurant) throw new Error(`Restaurant not found for owner: ${ownerEmail}`)

  const existingPurchase = await InventoryPurchase.findOne({
    restaurantId: restaurant._id,
    invoiceNumber: invoiceDefinition.invoiceNumber,
  })
    .select('_id invoiceNumber createdAt')
    .lean()

  if (existingPurchase) {
    console.log(
      JSON.stringify(
        {
          ownerEmail,
          restaurant: {
            id: String(restaurant._id),
            name: restaurant.name,
            slug: restaurant.slug,
          },
          status: 'skipped_existing_invoice',
          invoiceNumber: existingPurchase.invoiceNumber,
          purchaseId: String(existingPurchase._id),
          createdAt: existingPurchase.createdAt,
        },
        null,
        2,
      ),
    )

    await mongoose.disconnect()
    return
  }

  const supplierName = invoiceDefinition.supplierName.trim()
  const supplierNormalizedName = supplierName.toLowerCase().replace(/\s+/g, ' ').trim()

  const supplier = await InventorySupplier.findOneAndUpdate(
    { restaurantId: restaurant._id, normalizedName: supplierNormalizedName },
    {
      $set: {
        restaurantId: restaurant._id,
        name: supplierName,
        normalizedName: supplierNormalizedName,
        isActive: true,
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  )

  const itemDocs = []
  let createdItems = 0

  for (const row of invoiceDefinition.items) {
    const name = String(row.name || '').trim()
    const defaultUnit = mapUnit(row.unit)
    const normalizedName = name.toLowerCase().replace(/\s+/g, ' ').trim()

    const existingItem = await InventoryItem.findOne({
      restaurantId: restaurant._id,
      normalizedName,
    })
      .select('_id name defaultUnit')
      .lean()

    if (existingItem) {
      itemDocs.push(existingItem)
      continue
    }

    const created = await InventoryItem.create({
      restaurantId: restaurant._id,
      name,
      normalizedName,
      defaultUnit,
      isActive: true,
    })

    createdItems += 1
    itemDocs.push({ _id: created._id, name: created.name, defaultUnit: created.defaultUnit })
  }

  const itemByName = new Map(itemDocs.map((item) => [String(item.name || '').trim().toLowerCase(), item]))
  const payloadItems = invoiceDefinition.items.map((row) => {
    const key = String(row.name || '').trim().toLowerCase()
    const mapped = itemByName.get(key)
    if (!mapped) throw new Error(`Inventory item not found after upsert: ${row.name}`)

    return {
      itemId: String(mapped._id),
      itemName: String(mapped.name || row.name).trim(),
      quantity: Number(row.quantity || 0),
      unit: mapUnit(row.unit),
      rate: Number(row.rate || 0),
    }
  })

  const itemById = new Map(itemDocs.map((item) => [String(item._id), item]))

  const composed = composePurchasePayload({
    payload: {
      sourceType: invoiceDefinition.sourceType,
      supplierId: String(supplier._id),
      invoiceDate: invoiceDefinition.invoiceDate,
      invoiceNumber: invoiceDefinition.invoiceNumber,
      gstNo: invoiceDefinition.gstNo,
      cgstPercent: invoiceDefinition.cgstPercent,
      sgstPercent: invoiceDefinition.sgstPercent,
      igstPercent: invoiceDefinition.igstPercent,
      deliveryCharge: invoiceDefinition.deliveryCharge,
      discountType: invoiceDefinition.discountType,
      discountValue: invoiceDefinition.discountValue,
      paymentType: invoiceDefinition.paymentType,
      items: payloadItems,
    },
    itemById,
    supplierName: supplier.name,
  })

  const session = await mongoose.startSession()
  let purchase = null

  try {
    await session.withTransaction(async () => {
      purchase = await InventoryPurchase.create(
        [
          {
            restaurantId: restaurant._id,
            sourceType: composed.sourceType,
            supplierId: supplier._id,
            supplierNameSnapshot: composed.supplierNameSnapshot,
            invoiceDate: composed.invoiceDate,
            invoiceNumber: composed.invoiceNumber,
            gstNo: composed.gstNo,
            cgstPercent: composed.cgstPercent,
            sgstPercent: composed.sgstPercent,
            igstPercent: composed.igstPercent,
            deliveryCharge: composed.deliveryCharge,
            discountType: composed.discountType,
            discountValue: composed.discountValue,
            totalDiscountAmount: composed.totalDiscountAmount,
            paymentType: composed.paymentType,
            items: composed.items,
            subtotalAmount: composed.subtotalAmount,
            taxableAmount: composed.taxableAmount,
            cgstAmount: composed.cgstAmount,
            sgstAmount: composed.sgstAmount,
            igstAmount: composed.igstAmount,
            grandTotalAmount: composed.grandTotalAmount,
            createdByUserId: user._id,
            createdByRole: user.role === 'staff' ? 'staff' : 'owner',
          },
        ],
        { session },
      )

      purchase = purchase[0]

      const ledgerEntries = buildPurchaseLedgerEntries({
        restaurantId: restaurant._id,
        purchase,
        createdBy: user._id,
      })

      if (ledgerEntries.length) {
        await addLedgerEntries(ledgerEntries, { session })
      }
    })
  } finally {
    session.endSession()
  }

  const subtotalCheck = round2(
    invoiceDefinition.items.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.rate || 0), 0),
  )

  console.log(
    JSON.stringify(
      {
        ownerEmail,
        restaurant: {
          id: String(restaurant._id),
          name: restaurant.name,
          slug: restaurant.slug,
        },
        supplier: {
          id: String(supplier._id),
          name: supplier.name,
        },
        purchase: {
          id: String(purchase._id),
          invoiceNumber: purchase.invoiceNumber,
          itemCount: purchase.items.length,
          paymentType: purchase.paymentType,
          subtotalAmount: purchase.subtotalAmount,
          taxableAmount: purchase.taxableAmount,
          cgstAmount: purchase.cgstAmount,
          sgstAmount: purchase.sgstAmount,
          igstAmount: purchase.igstAmount,
          grandTotalAmount: purchase.grandTotalAmount,
        },
        sanity: {
          subtotalFromRows: subtotalCheck,
        },
        upserts: {
          createdItems,
          reusedItems: invoiceDefinition.items.length - createdItems,
        },
      },
      null,
      2,
    ),
  )

  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error?.message || error)
  try {
    await mongoose.disconnect()
  } catch {
    // no-op
  }
  process.exit(1)
})
