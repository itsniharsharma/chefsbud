import mongoose from 'mongoose'

const staffAccountSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      index: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
      minlength: 3,
      maxlength: 40,
    },
    displayName: {
      type: String,
      trim: true,
      default: '',
      maxlength: 80,
    },
    passkeyHash: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true },
)

staffAccountSchema.index({ restaurantId: 1, isActive: 1, username: 1 })

export default mongoose.model('StaffAccount', staffAccountSchema)