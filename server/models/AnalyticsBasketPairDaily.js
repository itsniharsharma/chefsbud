import mongoose from 'mongoose'

const analyticsBasketPairDailySchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    itemA: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true, index: true },
    itemB: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true, index: true },
    itemAName: { type: String, default: '', trim: true },
    itemBName: { type: String, default: '', trim: true },
    date: { type: Date, required: true },
    dateKey: { type: String, required: true, trim: true },
    pairKey: { type: String, required: true, trim: true }, // Normalized pair key (smaller ID first)
    count: { type: Number, default: 0, min: 0 },
    // Rollup tracking: marks when data has been aggregated to monthly
    rolledUp: { type: Boolean, default: false, index: true },
    rolledUpAt: { type: Date, default: null },
  },
  { timestamps: true },
)

analyticsBasketPairDailySchema.index({ restaurantId: 1, dateKey: 1, pairKey: 1 }, { unique: true })
analyticsBasketPairDailySchema.index({ restaurantId: 1, date: 1, count: -1 })
analyticsBasketPairDailySchema.index({ date: 1, rolledUp: 1 })
analyticsBasketPairDailySchema.index({ restaurantId: 1, itemA: 1, date: 1 })
analyticsBasketPairDailySchema.index({ restaurantId: 1, itemB: 1, date: 1 })

export default mongoose.model('AnalyticsBasketPairDaily', analyticsBasketPairDailySchema)
