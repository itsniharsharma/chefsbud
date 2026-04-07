import mongoose from 'mongoose'

const orderInventoryJobSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    jobType: { type: String, enum: ['reserve_order_inventory'], required: true, index: true },
    jobKey: { type: String, required: true, trim: true, maxlength: 220 },
    status: {
      type: String,
      enum: ['queued', 'retry', 'processing', 'completed', 'dead'],
      default: 'queued',
      index: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 5, min: 1, max: 20 },
    nextRunAt: { type: Date, default: () => new Date(), index: true },
    lockedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    workerId: { type: String, default: '', trim: true, maxlength: 120 },
    lastError: { type: String, default: '', trim: true, maxlength: 2000 },
    payload: {
      type: new mongoose.Schema(
        {
          policy: { type: String, enum: ['soft', 'hard'], default: 'soft' },
          idempotencyPrefix: { type: String, default: 'order' },
        },
        { _id: false },
      ),
      default: () => ({ policy: 'soft', idempotencyPrefix: 'order' }),
    },
  },
  { timestamps: true },
)

orderInventoryJobSchema.index({ jobType: 1, status: 1, nextRunAt: 1, createdAt: 1 })
orderInventoryJobSchema.index({ jobKey: 1 }, { unique: true })
orderInventoryJobSchema.index({ restaurantId: 1, orderId: 1, jobType: 1 }, { unique: true })

export default mongoose.model('OrderInventoryJob', orderInventoryJobSchema)
