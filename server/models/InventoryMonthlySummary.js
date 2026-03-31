import mongoose from 'mongoose'

const inventoryMonthlySummarySchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true },
    month: { type: String, required: true, trim: true, index: true },
    monthStartDate: { type: Date, required: true, index: true },
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
    sourceWindowStart: { type: Date, required: true },
    sourceWindowEnd: { type: Date, required: true },
    rolledUpAt: { type: Date, default: () => new Date() },
    archivedAt: { type: Date, default: null, index: true },
    archiveBlobPath: { type: String, default: '', trim: true, maxlength: 260 },
  },
  { timestamps: true },
)

inventoryMonthlySummarySchema.index({ restaurantId: 1, inventoryItemId: 1, month: 1 }, { unique: true })
inventoryMonthlySummarySchema.index({ restaurantId: 1, monthStartDate: 1, inventoryItemId: 1 })
inventoryMonthlySummarySchema.index({ monthStartDate: 1, archivedAt: 1 })

export default mongoose.model('InventoryMonthlySummary', inventoryMonthlySummarySchema)
