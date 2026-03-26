import mongoose from 'mongoose'

const paymentConfigSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['razorpay_me'], default: 'razorpay_me' },
    enabled: { type: Boolean, default: false },
    razorpayMeLink: { type: String, default: '', trim: true },
    configuredAt: { type: Date, default: null },
  },
  { _id: false },
)

const kotReprintConfigSchema = new mongoose.Schema(
  {
    passkeyHash: { type: String, default: '' },
    updatedAt: { type: Date, default: null },
  },
  { _id: false },
)

const restaurantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    gstin: { type: String, trim: true, uppercase: true, unique: true, sparse: true, index: true },
    address: { type: String, default: '' },
    phone: { type: String, default: '' },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    paymentConfig: { type: paymentConfigSchema, default: () => ({ provider: 'razorpay_me', enabled: false }) },
    kotReprintConfig: { type: kotReprintConfigSchema, default: () => ({ passkeyHash: '', updatedAt: null }) },
  },
  { timestamps: true },
)

restaurantSchema.index({ ownerId: 1 }, { unique: true })

export default mongoose.model('Restaurant', restaurantSchema)
