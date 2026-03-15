import mongoose from 'mongoose'

const orderItemSchema = new mongoose.Schema(
  {
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false },
)

const orderSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    restaurantSlug: { type: String, required: true, trim: true, index: true },
    floorNumber: { type: Number, required: true, min: 1, default: 1 },
    tableNumber: { type: Number, required: true },
    items: { type: [orderItemSchema], required: true },
    subtotalAmount: { type: Number, default: 0, min: 0 },
    discountTotal: { type: Number, default: 0, min: 0 },
    appliedOffers: {
      type: [
        new mongoose.Schema(
          {
            offerId: { type: String, default: '' },
            name: { type: String, default: '' },
            ruleType: { type: String, default: '' },
            stackingPolicy: { type: String, default: '' },
            discountAmount: { type: Number, default: 0, min: 0 },
            description: { type: String, default: '' },
            couponCode: { type: String, default: '' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    couponCode: { type: String, default: '' },
    customerNote: { type: String, default: '', trim: true, maxlength: 500 },
    totalAmount: { type: Number, required: true, min: 0 },
    paymentProvider: { type: String, enum: ['', 'razorpay', 'razorpay_me'], default: '' },
    paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Failed', 'Unpaid'], default: 'Unpaid' },
    providerOrderId: { type: String, default: '', index: true },
    providerPaymentId: { type: String, default: '', index: true },
    paymentCapturedAt: { type: Date, default: null },
    paymentFailureReason: { type: String, default: '' },
    kotPrinted: { type: Boolean, default: false, index: true },
    kotPrintedAt: { type: Date, default: null },
    orderStatus: {
      type: String,
      enum: ['Pending', 'Confirmed', 'Preparing', 'Ready', 'Served', 'Completed'],
      default: 'Pending',
    },
    completedAt: { type: Date, default: null },
    hiddenFromActive: { type: Boolean, default: false, index: true },
    deletedByOwnerAt: { type: Date, default: null, index: true },
    isArchived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date, default: null },
    archiveKey: { type: String, default: '' },
  },
  { timestamps: true },
)

orderSchema.index({ restaurantId: 1, createdAt: -1 })
orderSchema.index({ restaurantId: 1, orderStatus: 1, createdAt: -1 })
orderSchema.index({ restaurantId: 1, floorNumber: 1, tableNumber: 1, createdAt: -1 })
orderSchema.index({ restaurantId: 1, tableNumber: 1, createdAt: -1 })
orderSchema.index({ restaurantId: 1, paymentStatus: 1, createdAt: -1 })
orderSchema.index({ restaurantId: 1, paymentStatus: 1, orderStatus: 1, createdAt: -1 })
orderSchema.index({ restaurantId: 1, hiddenFromActive: 1, createdAt: -1 })
orderSchema.index({ restaurantId: 1, isArchived: 1, createdAt: -1 })
orderSchema.index({ restaurantId: 1, tableNumber: 1, isArchived: 1, createdAt: -1 })
orderSchema.index({ hiddenFromActive: 1, deletedByOwnerAt: 1, isArchived: 1 })
orderSchema.index({ providerOrderId: 1 }, { unique: true, sparse: true })
orderSchema.index({ providerPaymentId: 1 }, { unique: true, sparse: true })

export default mongoose.model('Order', orderSchema)
