import mongoose from 'mongoose'

const offerSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['Percentage Discount', 'Flat Discount', 'Combo Offer', 'Buy X Get Y', 'Coupon Code', 'AI Rule'],
      required: true,
    },
    ruleType: {
      type: String,
      enum: ['item_percent_qty', 'cart_flat_threshold', 'bxgy', 'coupon'],
      default: null,
    },
    discountValue: { type: String, default: '' },
    conditions: { type: mongoose.Schema.Types.Mixed, default: null },
    actions: { type: mongoose.Schema.Types.Mixed, default: null },
    couponCode: { type: String, default: '' },
    stackingPolicy: { type: String, enum: ['stackable', 'exclusive'], default: 'stackable' },
    priority: { type: Number, default: 100 },
    sourcePrompt: { type: String, default: '' },
    active: { type: Boolean, default: true },
    startTime: { type: Date, default: null },
    endTime: { type: Date, default: null },
  },
  { timestamps: true },
)

offerSchema.index({ restaurantId: 1, active: 1 })
offerSchema.index({ restaurantId: 1, active: 1, priority: 1, createdAt: 1 })
offerSchema.index({ restaurantId: 1, couponCode: 1 })

export default mongoose.model('Offer', offerSchema)
