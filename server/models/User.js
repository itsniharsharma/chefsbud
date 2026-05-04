import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    tokenVersion: { type: Number, default: 0 },
    emailVerified: { type: Boolean, default: false },
    role: { type: String, enum: ['owner'], default: 'owner' },
    billing: {
      planType: { type: String, enum: ['none', 'lifetime', 'hybrid'], default: 'none' },
      planCode: { type: String, enum: ['none', 'core', 'pro'], default: 'none' },
      billingCycle: { type: String, enum: ['monthly', 'yearly'], default: 'monthly' },
      status: {
        type: String,
        enum: ['pending', 'setup_paid', 'active', 'grace_period', 'past_due', 'cancelled', 'failed'],
        default: 'pending',
      },
      razorpayCustomerId: { type: String, default: '' },
      razorpaySubscriptionId: { type: String, default: '' },
      lifetimePaymentId: { type: String, default: '' },
      setupPaymentId: { type: String, default: '' },
      activatedAt: { type: Date, default: null },
      currentPeriodEnd: { type: Date, default: null },
      graceEndsAt: { type: Date, default: null },
      cancelledAt: { type: Date, default: null },
      lastBillingEventAt: { type: Date, default: null },
    },
  },
  { timestamps: true },
)

userSchema.index({ 'billing.razorpaySubscriptionId': 1 }, { sparse: true })
userSchema.index({ username: 1 }, { unique: true, sparse: true })

export default mongoose.model('User', userSchema)
