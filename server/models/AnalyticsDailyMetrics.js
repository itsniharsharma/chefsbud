import mongoose from 'mongoose'

const analyticsDailyMetricsSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    date: { type: Date, required: true },
    dateKey: { type: String, required: true, trim: true },
    views: { type: Number, default: 0, min: 0 },
    addToCart: { type: Number, default: 0, min: 0 },
    completedOrders: { type: Number, default: 0, min: 0 },
    revenue: { type: Number, default: 0, min: 0 },
    // Rollup tracking: marks when data has been aggregated to monthly
    rolledUp: { type: Boolean, default: false, index: true },
    rolledUpAt: { type: Date, default: null },
  },
  { timestamps: true },
)

analyticsDailyMetricsSchema.index({ restaurantId: 1, dateKey: 1 }, { unique: true })
analyticsDailyMetricsSchema.index({ restaurantId: 1, date: 1 })
analyticsDailyMetricsSchema.index({ date: 1, rolledUp: 1 })

export default mongoose.model('AnalyticsDailyMetrics', analyticsDailyMetricsSchema)
