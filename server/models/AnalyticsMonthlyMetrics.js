import mongoose from 'mongoose'

/**
 * AnalyticsMonthlyMetrics
 * Represents aggregated restaurant-level analytics rolled up from daily metrics.
 * Created by analytics rollup job when daily data is >= 90 days old.
 * Used to reduce storage footprint and improve query performance for historical analytics.
 */
const analyticsMonthlyMetricsSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    year: { type: Number, required: true, min: 2020, max: 2100 },
    month: { type: Number, required: true, min: 1, max: 12 },
    monthKey: { type: String, required: true, trim: true }, // e.g., "2026-03"
    views: { type: Number, default: 0, min: 0 },
    addToCart: { type: Number, default: 0, min: 0 },
    completedOrders: { type: Number, default: 0, min: 0 },
    revenue: { type: Number, default: 0, min: 0 },
    daysOfData: { type: Number, default: 0, min: 0, max: 31 }, // Track data completeness
    rolledUpAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
)

analyticsMonthlyMetricsSchema.index({ restaurantId: 1, monthKey: 1 }, { unique: true })
analyticsMonthlyMetricsSchema.index({ restaurantId: 1, year: 1, month: 1 })

export default mongoose.model('AnalyticsMonthlyMetrics', analyticsMonthlyMetricsSchema)
