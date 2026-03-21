import mongoose from 'mongoose'

const orderHourlyMetricsSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    date: { type: Date, required: true },
    dateKey: { type: String, required: true, trim: true },
    hour: { type: Number, required: true, min: 0, max: 23 },
    orders: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
)

orderHourlyMetricsSchema.index({ restaurantId: 1, dateKey: 1, hour: 1 }, { unique: true })
orderHourlyMetricsSchema.index({ restaurantId: 1, date: 1, hour: 1 })

export default mongoose.model('OrderHourlyMetrics', orderHourlyMetricsSchema)
