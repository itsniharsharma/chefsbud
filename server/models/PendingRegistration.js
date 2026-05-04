import mongoose from 'mongoose'

const pendingRegistrationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, lowercase: true, trim: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    restaurantName: { type: String, required: true, trim: true },
    gstin: { type: String, required: true, uppercase: true, trim: true, unique: true, index: true },
    address: { type: String, default: '' },
    phone: { type: String, default: '' },
    otpHash: { type: String, required: true },
    otpExpiresAt: { type: Date, required: true },
    otpAttempts: { type: Number, default: 0 },
    resendCount: { type: Number, default: 0 },
    lastCodeSentAt: { type: Date, required: true },
    expiresAt: {
      type: Date,
      required: true,
      index: {
        expireAfterSeconds: 0,
      },
    },
  },
  { timestamps: true },
)

export default mongoose.model('PendingRegistration', pendingRegistrationSchema)
