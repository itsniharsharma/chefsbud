import mongoose from 'mongoose'

const transferLineSchema = new mongoose.Schema(
  {
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    itemName: { type: String, default: '', trim: true, maxlength: 160 },
    quantity: { type: Number, required: true, min: 0.000001 },
    unit: { type: String, enum: ['g', 'ml', 'unit'], required: true },
    dispatchedQty: { type: Number, default: 0, min: 0 },
    receivedQty: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
)

const transferOrderSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    transferNumber: { type: String, required: true, trim: true, maxlength: 80 },
    fromLocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLocation', required: true, index: true },
    toLocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLocation', required: true, index: true },
    status: {
      type: String,
      enum: ['draft', 'requested', 'dispatched', 'received', 'cancelled'],
      default: 'draft',
      index: true,
    },
    lines: { type: [transferLineSchema], default: [] },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    dispatchedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    dispatchedAt: { type: Date, default: null },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    receivedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

transferOrderSchema.index({ restaurantId: 1, transferNumber: 1 }, { unique: true })
transferOrderSchema.index({ restaurantId: 1, status: 1, createdAt: -1 })

export default mongoose.model('TransferOrder', transferOrderSchema)
