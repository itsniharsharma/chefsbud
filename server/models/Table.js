import mongoose from 'mongoose'

const tableSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    floorNumber: { type: Number, required: true, min: 1, default: 1 },
    tableNumber: { type: Number, required: true, min: 1 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)

tableSchema.index({ restaurantId: 1, tableNumber: 1 }, { unique: true })
tableSchema.index({ restaurantId: 1, floorNumber: 1, tableNumber: 1 })
tableSchema.index({ restaurantId: 1, active: 1 })
tableSchema.index({ restaurantId: 1, active: 1, tableNumber: 1 })

export default mongoose.model('Table', tableSchema)
