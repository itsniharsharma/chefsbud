import mongoose from 'mongoose'

function normalizeName(value = '') {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

const inventoryItemSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    normalizedName: { type: String, required: true, trim: true, maxlength: 160 },
    defaultUnit: {
      type: String,
      enum: ['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet'],
      default: 'Unit',
    },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
)

inventoryItemSchema.pre('validate', function inventoryItemPreValidate(next) {
  this.normalizedName = normalizeName(this.name)
  next()
})

inventoryItemSchema.index({ restaurantId: 1, normalizedName: 1 }, { unique: true })
inventoryItemSchema.index({ restaurantId: 1, isActive: 1, name: 1 })

export default mongoose.model('InventoryItem', inventoryItemSchema)
