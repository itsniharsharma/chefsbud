import mongoose from 'mongoose'

const menuItemSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    price: { type: Number, required: true, min: 0 },
    available: { type: Boolean, default: true },
    isVeg: { type: Boolean, default: true },
    bestseller: { type: Boolean, default: false },
  },
  { timestamps: true },
)

menuItemSchema.index({ restaurantId: 1, name: 1 })
menuItemSchema.index({ restaurantId: 1, available: 1, createdAt: -1 })
menuItemSchema.index({ restaurantId: 1, available: 1, updatedAt: -1 })
menuItemSchema.index({ restaurantId: 1, categoryId: 1, available: 1, createdAt: -1 })
menuItemSchema.index({ restaurantId: 1, categoryId: 1, isVeg: 1, available: 1, createdAt: -1 })
menuItemSchema.index({ restaurantId: 1, createdAt: -1 })

export default mongoose.model('MenuItem', menuItemSchema)
