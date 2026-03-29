import mongoose from 'mongoose'

/**
 * AnalyticsBasketPairMonthly
 * Represents aggregated item co-purchase patterns rolled up from daily pair metrics.
 * Created by analytics rollup job when daily pair data is >= 90 days old.
 * Keeps only high-frequency pairs (top 100 per restaurant per month) to limit growth.
 * Used for recommendation engine and cross-sell analysis with historical context.
 */
const analyticsBasketPairMonthlySchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    itemA: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true, index: true },
    itemB: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true, index: true },
    itemAName: { type: String, default: '', trim: true },
    itemBName: { type: String, default: '', trim: true },
    pairKey: { type: String, required: true, trim: true }, // Normalized pair identifier (smaller ID first)
    year: { type: Number, required: true, min: 2020, max: 2100 },
    month: { type: Number, required: true, min: 1, max: 12 },
    monthKey: { type: String, required: true, trim: true }, // e.g., "2026-03"
    count: { type: Number, default: 0, min: 0 },
    daysOfData: { type: Number, default: 0, min: 0, max: 31 }, // Track data completeness
    rolledUpAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
)

analyticsBasketPairMonthlySchema.index({ restaurantId: 1, month: 1, pairKey: 1 }, { unique: true })
analyticsBasketPairMonthlySchema.index({ restaurantId: 1, year: 1, month: 1, count: -1 })
analyticsBasketPairMonthlySchema.index({ restaurantId: 1, itemA: 1, year: 1, month: 1 })
analyticsBasketPairMonthlySchema.index({ restaurantId: 1, itemB: 1, year: 1, month: 1 })

export default mongoose.model('AnalyticsBasketPairMonthly', analyticsBasketPairMonthlySchema)
