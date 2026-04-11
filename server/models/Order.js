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

const billAdjustmentItemSchema = new mongoose.Schema(
  {
    sourceType: { type: String, enum: ['menu', 'custom'], required: true },
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', default: null },
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    defaultUnitPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false },
)

const orderSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    restaurantSlug: { type: String, required: true, trim: true },
    floorNumber: { type: Number, required: true, min: 1, default: 1 },
    tableNumber: { type: Number, required: true },
    items: { type: [orderItemSchema], required: true },
    subtotalAmount: { type: Number, default: 0, min: 0 },
    discountTotal: { type: Number, default: 0, min: 0 },
    billAdjustments: { type: [billAdjustmentItemSchema], default: [] },
    billAdjustmentSubtotal: { type: Number, default: 0, min: 0 },
    billFinalTotalAmount: { type: Number, default: null, min: 0 },
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
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    idempotencyKey: { type: String, default: '', trim: true, maxlength: 120 },
    orderDateKey: { type: String, default: '', trim: true },
    dailyOrderNumber: { type: Number, default: null, min: 1 },
    customerNote: { type: String, default: '', trim: true, maxlength: 500 },
    totalAmount: { type: Number, required: true, min: 0 },
    paymentProvider: { type: String, enum: ['', 'razorpay', 'razorpay_me'], default: '' },
    paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Failed', 'Unpaid'], default: 'Unpaid' },
    providerOrderId: { type: String, trim: true },
    providerPaymentId: { type: String, trim: true },
    paymentCapturedAt: { type: Date, default: null },
    paymentFailureReason: { type: String, default: '' },
    billPrinted: { type: Boolean, default: false },
    billPrintedAt: { type: Date, default: null },
    kotPrinted: { type: Boolean, default: false },
    kotPrintedAt: { type: Date, default: null },
    kotPrintCount: { type: Number, default: 0, min: 0 },
    lastKotReprintReason: { type: String, default: '', trim: true, maxlength: 240 },
    lastKotReprintBy: { type: String, default: '', trim: true, maxlength: 120 },
    lastKotReprintAt: { type: Date, default: null },
    orderStatus: {
      type: String,
      enum: ['Preparing', 'Served', 'Completed'],
      default: 'Preparing',
    },
    customerRating: { type: Number, min: 1, max: 5, default: null },
    customerRatedAt: { type: Date, default: null },
    inventoryConsumptionCycle: { type: Number, default: 0, min: 0 },
    inventoryProcessedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    analyticsTrackedAt: { type: Date, default: null },
    analyticsTrackingState: { type: String, enum: ['', 'processing', 'tracked'], default: '' },
    analyticsTrackingStartedAt: { type: Date, default: null },
    hiddenFromActive: { type: Boolean, default: false },
    hiddenFromRecent: { type: Boolean, default: false },
    deletedByOwnerAt: { type: Date, default: null },
    isArchived: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
    archiveKey: { type: String, default: '' },
  },
  { timestamps: true },
)

// Active board listing (default path): restaurant + non-archived + active visibility, newest first.
orderSchema.index({ restaurantId: 1, isArchived: 1, hiddenFromActive: 1, createdAt: -1 })

// Completed/recent views with completion-time sorting.
orderSchema.index({ restaurantId: 1, isArchived: 1, orderStatus: 1, completedAt: -1, createdAt: -1 })

// Floor-filtered active board query.
orderSchema.index({ restaurantId: 1, isArchived: 1, hiddenFromActive: 1, floorNumber: 1, createdAt: -1 })

// Active table transfer checks and updates.
orderSchema.index({ restaurantId: 1, isArchived: 1, hiddenFromActive: 1, floorNumber: 1, tableNumber: 1 })

// Public table order timeline and status checks.
orderSchema.index({ restaurantSlug: 1, tableNumber: 1, isArchived: 1, createdAt: -1 })

// Archival purge path.
orderSchema.index({ isArchived: 1, archivedAt: 1, orderStatus: 1 })

// Analytics backfill scanner prefers oldest completed, untracked records.
orderSchema.index({ restaurantId: 1, isArchived: 1, orderStatus: 1, analyticsTrackedAt: 1, completedAt: 1, createdAt: 1 })

orderSchema.index({ providerOrderId: 1 }, { unique: true, sparse: true })
orderSchema.index({ providerPaymentId: 1 }, { unique: true, sparse: true })
orderSchema.index(
  { restaurantId: 1, orderDateKey: 1, dailyOrderNumber: 1 },
  {
    unique: true,
    partialFilterExpression: {
      orderDateKey: { $exists: true, $ne: '' },
      dailyOrderNumber: { $exists: true, $ne: null },
    },
  },
)
orderSchema.index(
  { restaurantId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true, $ne: '' } } },
)

export default mongoose.model('Order', orderSchema)
