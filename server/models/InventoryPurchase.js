import mongoose from 'mongoose'

const purchaseLineItemSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    itemName: { type: String, required: true, trim: true, maxlength: 160 },
    quantity: { type: Number, required: true, min: 0 },
    unit: {
      type: String,
      enum: ['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet'],
      required: true,
    },
    rate: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
)

const inventoryPurchaseSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    sourceType: { type: String, enum: ['Supplier', 'Restaurant', 'Kitchen'], required: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventorySupplier', default: null },
    supplierNameSnapshot: { type: String, default: '', trim: true, maxlength: 160 },
    invoiceDate: { type: Date, required: true },
    invoiceNumber: { type: String, required: true, trim: true, maxlength: 80 },
    gstNo: { type: String, default: '', trim: true, maxlength: 32 },
    cgstPercent: { type: Number, default: 0, min: 0, max: 100 },
    sgstPercent: { type: Number, default: 0, min: 0, max: 100 },
    igstPercent: { type: Number, default: 0, min: 0, max: 100 },
    deliveryCharge: { type: Number, default: 0, min: 0 },
    discountType: { type: String, enum: ['Fixed', 'Percentage'], default: 'Fixed' },
    discountValue: { type: Number, default: 0, min: 0 },
    totalDiscountAmount: { type: Number, default: 0, min: 0 },
    paymentType: { type: String, enum: ['Unpaid', 'Paid'], default: 'Unpaid' },
    items: { type: [purchaseLineItemSchema], required: true },
    subtotalAmount: { type: Number, required: true, min: 0 },
    taxableAmount: { type: Number, required: true, min: 0 },
    cgstAmount: { type: Number, required: true, min: 0 },
    sgstAmount: { type: Number, required: true, min: 0 },
    igstAmount: { type: Number, required: true, min: 0 },
    grandTotalAmount: { type: Number, required: true, min: 0 },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    createdByRole: { type: String, enum: ['owner', 'staff'], default: 'owner' },
  },
  { timestamps: true },
)

inventoryPurchaseSchema.index({ restaurantId: 1, createdAt: -1 })
inventoryPurchaseSchema.index({ restaurantId: 1, invoiceDate: -1, _id: -1 })
inventoryPurchaseSchema.index({ restaurantId: 1, invoiceNumber: 1 })
inventoryPurchaseSchema.index({ restaurantId: 1, paymentType: 1, sourceType: 1, createdAt: -1 })
inventoryPurchaseSchema.index({ restaurantId: 1, 'items.itemId': 1, createdAt: -1 })

export default mongoose.model('InventoryPurchase', inventoryPurchaseSchema)
