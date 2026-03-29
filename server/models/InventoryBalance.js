import mongoose from 'mongoose'

const inventoryBalanceSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLocation', required: true, index: true },
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true },
    baseUnit: { type: String, enum: ['g', 'ml', 'unit'], required: true },
    onHandQty: { type: Number, default: 0 },
    reservedQty: { type: Number, default: 0 },
    availableQty: { type: Number, default: 0, index: true },
    rowVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
)

inventoryBalanceSchema.pre('validate', function inventoryBalancePreValidate() {
  const onHand = Number(this.onHandQty || 0)
  const reserved = Number(this.reservedQty || 0)
  this.availableQty = onHand - reserved
})

inventoryBalanceSchema.index({ restaurantId: 1, locationId: 1, inventoryItemId: 1 }, { unique: true })
inventoryBalanceSchema.index({ restaurantId: 1, inventoryItemId: 1, locationId: 1 })
inventoryBalanceSchema.index({ restaurantId: 1, locationId: 1, availableQty: 1 })

export default mongoose.model('InventoryBalance', inventoryBalanceSchema)
