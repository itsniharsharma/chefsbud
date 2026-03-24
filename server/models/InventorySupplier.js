import mongoose from 'mongoose'

function normalizeName(value = '') {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

const inventorySupplierSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    normalizedName: { type: String, required: true, trim: true, maxlength: 160 },
    gstNo: { type: String, default: '', trim: true, maxlength: 32 },
    phone: { type: String, default: '', trim: true, maxlength: 20 },
    email: { type: String, default: '', trim: true, maxlength: 160 },
    address: { type: String, default: '', trim: true, maxlength: 400 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
)

inventorySupplierSchema.pre('validate', function inventorySupplierPreValidate(next) {
  this.normalizedName = normalizeName(this.name)
  next()
})

inventorySupplierSchema.index({ restaurantId: 1, normalizedName: 1 }, { unique: true })
inventorySupplierSchema.index({ restaurantId: 1, isActive: 1, name: 1 })

export default mongoose.model('InventorySupplier', inventorySupplierSchema)
