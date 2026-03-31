import mongoose from 'mongoose'

const inventoryDailySummarySchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true },
    date: { type: Date, required: true, index: true },
    dateKey: { type: String, required: true, trim: true, index: true },
    unit: { type: String, enum: ['g', 'ml', 'unit'], required: true },
    purchaseQty: { type: Number, default: 0, min: 0 },
    consumptionQty: { type: Number, default: 0, min: 0 },
    wastageQty: { type: Number, default: 0, min: 0 },
    adjustmentInQty: { type: Number, default: 0, min: 0 },
    adjustmentOutQty: { type: Number, default: 0, min: 0 },
    conversionInQty: { type: Number, default: 0, min: 0 },
    conversionOutQty: { type: Number, default: 0, min: 0 },
    reservationQty: { type: Number, default: 0, min: 0 },
    releaseQty: { type: Number, default: 0, min: 0 },
    transferInQty: { type: Number, default: 0, min: 0 },
    transferOutQty: { type: Number, default: 0, min: 0 },
    netChangeQty: { type: Number, default: 0 },
    ledgerEntryCount: { type: Number, default: 0, min: 0 },
    expiresAt: { type: Date, required: true },
    sourceWindowStart: { type: Date, required: true },
    sourceWindowEnd: { type: Date, required: true },
    rolledUpAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
)

inventoryDailySummarySchema.index({ restaurantId: 1, inventoryItemId: 1, dateKey: 1 }, { unique: true })
inventoryDailySummarySchema.index({ restaurantId: 1, date: 1, inventoryItemId: 1 })
inventoryDailySummarySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model('InventoryDailySummary', inventoryDailySummarySchema)
