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
    totalAmount: { type: Number, required: true, min: 0 },
    paymentStatus: { type: String, enum: ['Unpaid', 'Paid'], default: 'Unpaid' },
    orderStatus: {
      type: String,
      enum: ['Pending', 'Preparing', 'Ready', 'Served', 'Completed'],
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

export default mongoose.model('Order', orderSchema)
