import mongoose from 'mongoose'

const inventoryBatchSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLocation', required: true, index: true },
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true },
    grnId: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceiptNote', default: null, index: true },
    batchCode: { type: String, required: true, trim: true, maxlength: 80 },
    supplierBatchCode: { type: String, default: '', trim: true, maxlength: 80 },
    expiryDate: { type: Date, default: null, index: true },
    unit: { type: String, enum: ['g', 'ml', 'unit'], required: true },
    unitCost: { type: Number, default: 0, min: 0 },
    quantityReceived: { type: Number, required: true, min: 0 },
    quantityRemaining: { type: Number, required: true, min: 0 },
    fifoRank: { type: Number, default: 0, index: true },
  },
  { timestamps: true },
)

inventoryBatchSchema.index({ restaurantId: 1, batchCode: 1 }, { unique: true })
inventoryBatchSchema.index({ restaurantId: 1, locationId: 1, inventoryItemId: 1, fifoRank: 1 })

export default mongoose.model('InventoryBatch', inventoryBatchSchema)
