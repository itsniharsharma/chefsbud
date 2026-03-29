import mongoose from 'mongoose'

const inventoryLocationSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    code: { type: String, required: true, trim: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: {
      type: String,
      enum: ['Kitchen', 'Store', 'Bar', 'Warehouse', 'Other'],
      default: 'Store',
      index: true,
    },
    isDefault: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
)

inventoryLocationSchema.index({ restaurantId: 1, code: 1 }, { unique: true })
inventoryLocationSchema.index({ restaurantId: 1, isDefault: 1, isActive: 1 })

export default mongoose.model('InventoryLocation', inventoryLocationSchema)
