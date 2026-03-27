import mongoose from 'mongoose'

const analyticsEventIngestionSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    eventType: { type: String, required: true, trim: true, maxlength: 64 },
    eventId: { type: String, required: true, trim: true, maxlength: 220 },
    firstSeenAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
)

analyticsEventIngestionSchema.index(
  { restaurantId: 1, eventType: 1, eventId: 1 },
  { unique: true },
)
analyticsEventIngestionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model('AnalyticsEventIngestion', analyticsEventIngestionSchema)
