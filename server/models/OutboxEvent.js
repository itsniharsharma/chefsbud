import mongoose from 'mongoose'

const outboxEventSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, trim: true, maxlength: 80, index: true },
    eventKey: { type: String, required: true, trim: true, maxlength: 220 },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['pending', 'retry', 'processing', 'processed', 'failed'],
      default: 'pending',
      index: true,
    },
    retries: { type: Number, default: 0, min: 0 },
    maxRetries: { type: Number, default: 8, min: 1, max: 50 },
    nextRunAt: { type: Date, default: () => new Date(), index: true },
    lockedAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
    workerId: { type: String, default: '', trim: true, maxlength: 120 },
    lastError: { type: String, default: '', trim: true, maxlength: 2000 },
  },
  { timestamps: true },
)

outboxEventSchema.index({ status: 1, createdAt: 1 })
outboxEventSchema.index({ status: 1, nextRunAt: 1, createdAt: 1 })
outboxEventSchema.index({ type: 1, eventKey: 1 }, { unique: true })

export default mongoose.model('OutboxEvent', outboxEventSchema)
