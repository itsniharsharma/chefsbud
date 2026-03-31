import mongoose from 'mongoose'

const dashboardNotificationSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    type: { type: String, enum: ['LOW_STOCK_THRESHOLD'], required: true, index: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true },
    itemName: { type: String, required: true, trim: true, maxlength: 160 },
    thresholdPercent: { type: Number, required: true, min: 0, max: 100 },
    currentPercent: { type: Number, required: true, min: 0 },
    currentStock: { type: Number, required: true, min: 0 },
    purchasedQuantity: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: ['g', 'ml', 'unit'], required: true },
    message: { type: String, required: true, trim: true, maxlength: 320 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
)

dashboardNotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
dashboardNotificationSchema.index({ restaurantId: 1, type: 1, itemId: 1 }, { unique: true })
dashboardNotificationSchema.index({ restaurantId: 1, type: 1, createdAt: -1 })

export default mongoose.model('DashboardNotification', dashboardNotificationSchema)
