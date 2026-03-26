import mongoose from 'mongoose'

function normalizeName(value = '') {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function resolveBaseUnit(defaultUnit = 'Unit') {
  const unit = String(defaultUnit || 'Unit').trim()
  if (unit === 'Kg' || unit === 'Gram' || unit === 'g') return 'g'
  if (unit === 'Litre' || unit === 'Ml' || unit === 'ml') return 'ml'
  return 'unit'
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
    currentStock: { type: Number, default: 0 },
    currentStockUnit: { type: String, enum: ['g', 'ml', 'unit'], default: 'unit' },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
)

inventoryItemSchema.pre('validate', async function inventoryItemPreValidate() {
  this.normalizedName = normalizeName(this.name)
  if (this.isNew || !this.currentStockUnit) {
    this.currentStockUnit = resolveBaseUnit(this.defaultUnit)
  }
})

inventoryItemSchema.index({ restaurantId: 1, normalizedName: 1 }, { unique: true })
inventoryItemSchema.index({ restaurantId: 1, isActive: 1, name: 1 })

export default mongoose.model('InventoryItem', inventoryItemSchema)
