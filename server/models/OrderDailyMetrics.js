import mongoose from 'mongoose'

const orderDailyMetricsSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    dateKey: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    totalRevenue: { type: Number, default: 0, min: 0 },
    totalOrders: { type: Number, default: 0, min: 0 },
    averageOrderValue: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
)

orderDailyMetricsSchema.index({ restaurantId: 1, dateKey: 1 }, { unique: true })
orderDailyMetricsSchema.index({ restaurantId: 1, date: -1 })

export default mongoose.model('OrderDailyMetrics', orderDailyMetricsSchema)
