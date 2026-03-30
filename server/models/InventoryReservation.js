import mongoose from 'mongoose'

const DEFAULT_RESERVATION_TTL_MINUTES = Math.max(5, Number(process.env.INVENTORY_RESERVATION_TTL_MINUTES || 240))

function buildDefaultReservationExpiry() {
  return new Date(Date.now() + DEFAULT_RESERVATION_TTL_MINUTES * 60 * 1000)
}

const inventoryReservationSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLocation', required: true, index: true },
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true },
    unit: { type: String, enum: ['g', 'ml', 'unit'], required: true },
    reservedQty: { type: Number, required: true, min: 0.000001 },
    consumedQty: { type: Number, default: 0, min: 0 },
    releasedQty: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['active', 'released', 'consumed', 'expired'],
      default: 'active',
      index: true,
    },
    recipeVersion: { type: Number, default: 1, min: 1 },
    recipeVersionId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecipeVersion', default: null },
    idempotencyKey: { type: String, default: '', trim: true, maxlength: 220 },
    expiresAt: { type: Date, default: () => buildDefaultReservationExpiry() },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
)

inventoryReservationSchema.index({ restaurantId: 1, orderId: 1, status: 1 })
inventoryReservationSchema.index({ restaurantId: 1, locationId: 1, inventoryItemId: 1, status: 1 })
inventoryReservationSchema.index(
  { restaurantId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true, $ne: '' } } },
)

// TTL index: automatically delete reservations when expiresAt is reached.
inventoryReservationSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 },
)

export default mongoose.model('InventoryReservation', inventoryReservationSchema)
