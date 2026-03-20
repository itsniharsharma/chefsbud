import mongoose from 'mongoose'

const analyticsExposureSessionSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true, index: true },
    sessionId: { type: String, required: true, trim: true },
    dateKey: { type: String, required: true, trim: true },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
)

analyticsExposureSessionSchema.index(
  { restaurantId: 1, menuItemId: 1, sessionId: 1, dateKey: 1 },
  { unique: true },
)
analyticsExposureSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model('AnalyticsExposureSession', analyticsExposureSessionSchema)
