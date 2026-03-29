import mongoose from 'mongoose'

const inventoryViolationSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    type: {
      type: String,
      enum: ['NO_RESERVATION', 'NEGATIVE_STOCK', 'POLICY_BREACH', 'LOCATION_MISMATCH', 'EXPIRED_UNCLEANED', 'DUAL_CONSUMPTION'],
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ['warning', 'critical'],
      default: 'warning',
      index: true,
    },
    referenceType: { type: String, trim: true, maxlength: 80 },
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', default: null, index: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLocation', default: null, index: true },
    quantity: { type: Number, default: 0 },
    unit: { type: String, default: 'unit', enum: ['g', 'ml', 'unit'] },
    message: { type: String, trim: true, maxlength: 500 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    resolvedAt: { type: Date, default: null, index: true },
    resolutionNote: { type: String, default: '', trim: true, maxlength: 300 },
  },
  { timestamps: true },
)

inventoryViolationSchema.index({ restaurantId: 1, type: 1, severity: 1, createdAt: -1 })
inventoryViolationSchema.index({ restaurantId: 1, orderId: 1, createdAt: -1 })
inventoryViolationSchema.index({ restaurantId: 1, inventoryItemId: 1, locationId: 1, createdAt: -1 })
inventoryViolationSchema.index({ restaurantId: 1, severity: 1, resolvedAt: 1, createdAt: -1 })

export default mongoose.model('InventoryViolation', inventoryViolationSchema)
