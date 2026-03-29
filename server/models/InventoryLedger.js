import mongoose from 'mongoose'

const inventoryLedgerSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true },
    type: {
      type: String,
      enum: ['PURCHASE', 'CONSUMPTION', 'WASTAGE', 'ADJUSTMENT', 'CONVERSION_IN', 'CONVERSION_OUT'],
      required: true,
    },
    quantity: { type: Number, required: true, min: 0.000001 },
    direction: { type: Number, enum: [-1, 1], required: true },
    unit: { type: String, enum: ['g', 'ml', 'unit'], required: true },
    referenceType: { type: String, required: true, trim: true, maxlength: 80 },
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    idempotencyKey: { type: String, default: '', trim: true, maxlength: 220 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

inventoryLedgerSchema.index({ restaurantId: 1, inventoryItemId: 1, createdAt: -1 })
inventoryLedgerSchema.index({ restaurantId: 1, createdAt: -1, type: 1 })
inventoryLedgerSchema.index({ referenceType: 1, referenceId: 1, createdAt: -1 })
inventoryLedgerSchema.index({ restaurantId: 1, referenceType: 1, referenceId: 1, direction: 1, type: 1, 'metadata.cycle': 1 })
inventoryLedgerSchema.index(
  { restaurantId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $exists: true, $ne: '' } },
  },
)

export default mongoose.model('InventoryLedger', inventoryLedgerSchema)
