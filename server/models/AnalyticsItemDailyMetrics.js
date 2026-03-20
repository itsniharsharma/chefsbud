import mongoose from 'mongoose'

const analyticsItemDailyMetricsSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true, index: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    date: { type: Date, required: true },
    dateKey: { type: String, required: true, trim: true },
    views: { type: Number, default: 0, min: 0 },
    addToCart: { type: Number, default: 0, min: 0 },
    orders: { type: Number, default: 0, min: 0 },
    quantitySold: { type: Number, default: 0, min: 0 },
    revenue: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
)

analyticsItemDailyMetricsSchema.index({ restaurantId: 1, dateKey: 1, menuItemId: 1 }, { unique: true })
analyticsItemDailyMetricsSchema.index({ restaurantId: 1, date: 1, revenue: -1 })
analyticsItemDailyMetricsSchema.index({ restaurantId: 1, date: 1, views: -1 })
analyticsItemDailyMetricsSchema.index({ restaurantId: 1, date: 1, orders: -1 })

export default mongoose.model('AnalyticsItemDailyMetrics', analyticsItemDailyMetricsSchema)
