import mongoose from 'mongoose'

const analyticsOrderInsightsDailySchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    date: { type: Date, required: true },
    dateKey: { type: String, required: true, trim: true },
    completedOrders: { type: Number, default: 0, min: 0 },
    totalItemsSold: { type: Number, default: 0, min: 0 },
    singleItemOrders: { type: Number, default: 0, min: 0 },
    multiItemOrders: { type: Number, default: 0, min: 0 },
    ratedOrders: { type: Number, default: 0, min: 0 },
    totalRating: { type: Number, default: 0, min: 0 },
    rating1Count: { type: Number, default: 0, min: 0 },
    rating2Count: { type: Number, default: 0, min: 0 },
    rating3Count: { type: Number, default: 0, min: 0 },
    rating4Count: { type: Number, default: 0, min: 0 },
    rating5Count: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
)

analyticsOrderInsightsDailySchema.index({ restaurantId: 1, dateKey: 1 }, { unique: true })
analyticsOrderInsightsDailySchema.index({ restaurantId: 1, date: 1 })

export default mongoose.model('AnalyticsOrderInsightsDaily', analyticsOrderInsightsDailySchema)
