import mongoose from 'mongoose'

const paymentConfigSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['razorpay'], default: 'razorpay' },
    enabled: { type: Boolean, default: false },
    keyId: { type: String, default: '', trim: true },
    keySecretEncrypted: { type: String, default: '', select: false },
    webhookSecretEncrypted: { type: String, default: '', select: false },
    configuredAt: { type: Date, default: null },
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
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    paymentConfig: { type: paymentConfigSchema, default: () => ({ provider: 'razorpay', enabled: false }) },
  },
  { timestamps: true },
)

export default mongoose.model('Restaurant', restaurantSchema)
