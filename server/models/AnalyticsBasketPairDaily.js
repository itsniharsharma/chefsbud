import mongoose from 'mongoose'

const analyticsBasketPairDailySchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    date: { type: Date, required: true },
    dateKey: { type: String, required: true, trim: true },
    pairKey: { type: String, required: true, trim: true },
    itemA: { type: String, required: true, trim: true },
    itemB: { type: String, required: true, trim: true },
    count: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
)

analyticsBasketPairDailySchema.index({ restaurantId: 1, dateKey: 1, pairKey: 1 }, { unique: true })
analyticsBasketPairDailySchema.index({ restaurantId: 1, date: 1, count: -1 })

export default mongoose.model('AnalyticsBasketPairDaily', analyticsBasketPairDailySchema)
