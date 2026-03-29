import mongoose from 'mongoose'

/**
 * AnalyticsItemMonthlyMetrics
 * Represents aggregated menu item-level analytics rolled up from daily metrics.
 * Created by analytics rollup job when daily item data is >= 90 days old.
 * Used to reduce storage footprint while preserving per-item analytics trend analysis.
 */
const analyticsItemMonthlyMetricsSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true, index: true },
    menuItemName: { type: String, default: '', trim: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    year: { type: Number, required: true, min: 2020, max: 2100 },
    month: { type: Number, required: true, min: 1, max: 12 },
    monthKey: { type: String, required: true, trim: true }, // e.g., "2026-03-menuitemid"
    views: { type: Number, default: 0, min: 0 },
    addToCart: { type: Number, default: 0, min: 0 },
    orders: { type: Number, default: 0, min: 0 },
    quantitySold: { type: Number, default: 0, min: 0 },
    revenue: { type: Number, default: 0, min: 0 },
    daysOfData: { type: Number, default: 0, min: 0, max: 31 }, // Track data completeness
    rolledUpAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
)

analyticsItemMonthlyMetricsSchema.index({ restaurantId: 1, monthKey: 1, menuItemId: 1 }, { unique: true })
analyticsItemMonthlyMetricsSchema.index({ restaurantId: 1, year: 1, month: 1, menuItemId: 1 })
analyticsItemMonthlyMetricsSchema.index({ restaurantId: 1, year: 1, month: 1, revenue: -1 })
analyticsItemMonthlyMetricsSchema.index({ restaurantId: 1, year: 1, month: 1, views: -1 })
analyticsItemMonthlyMetricsSchema.index({ restaurantId: 1, year: 1, month: 1, orders: -1 })

export default mongoose.model('AnalyticsItemMonthlyMetrics', analyticsItemMonthlyMetricsSchema)
