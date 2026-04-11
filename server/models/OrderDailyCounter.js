import mongoose from 'mongoose'

const orderDailyCounterSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    orderDateKey: { type: String, required: true, trim: true },
    seq: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true },
)

orderDailyCounterSchema.index({ restaurantId: 1, orderDateKey: 1 }, { unique: true })

export default mongoose.model('OrderDailyCounter', orderDailyCounterSchema)