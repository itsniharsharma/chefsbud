import mongoose from 'mongoose'

const restaurantPaymentEventSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['razorpay'], required: true },
    providerEventId: { type: String, required: true, trim: true },
    eventType: { type: String, required: true, trim: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    providerOrderId: { type: String, default: '', index: true },
    providerPaymentId: { type: String, default: '', index: true },
    processingStatus: {
      type: String,
      enum: ['received', 'processed', 'ignored', 'failed'],
      default: 'received',
      index: true,
    },
    receivedAt: { type: Date, default: Date.now, index: true },
    processedAt: { type: Date, default: null },
    failureReason: { type: String, default: '' },
  },
  { timestamps: true },
)

restaurantPaymentEventSchema.index({ provider: 1, providerEventId: 1 }, { unique: true })

export default mongoose.model('RestaurantPaymentEvent', restaurantPaymentEventSchema)
