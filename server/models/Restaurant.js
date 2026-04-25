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

const inventoryAlertConfigSchema = new mongoose.Schema(
  {
    lowStockThresholdPercent: { type: Number, default: 10, min: 1, max: 100 },
  },
  { _id: false },
)

const featureConfigSchema = new mongoose.Schema(
  {
    inventoryEnabled: { type: Boolean, default: true },
    analyticsEnabled: { type: Boolean, default: true },
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
    inventoryAlertConfig: { type: inventoryAlertConfigSchema, default: () => ({ lowStockThresholdPercent: 10 }) },
    featureConfig: { type: featureConfigSchema, default: () => ({ inventoryEnabled: true, analyticsEnabled: true }) },
  },
  { timestamps: true },
)

restaurantSchema.index({ ownerId: 1 }, { unique: true })

export default mongoose.model('Restaurant', restaurantSchema)
