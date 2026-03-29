import mongoose from 'mongoose'

const purchaseOrderLineSchema = new mongoose.Schema(
  {
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    itemName: { type: String, required: true, trim: true, maxlength: 160 },
    orderedQty: { type: Number, required: true, min: 0.000001 },
    receivedQty: { type: Number, default: 0, min: 0 },
    unit: { type: String, enum: ['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet'], required: true },
    expectedRate: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
)

const purchaseOrderSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    poNumber: { type: String, required: true, trim: true, maxlength: 80 },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventorySupplier', default: null, index: true },
    supplierNameSnapshot: { type: String, default: '', trim: true, maxlength: 160 },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLocation', default: null, index: true },
    status: {
      type: String,
      enum: ['draft', 'approved', 'partially_received', 'fully_received', 'closed', 'cancelled'],
      default: 'draft',
      index: true,
    },
    expectedDate: { type: Date, default: null },
    notes: { type: String, default: '', trim: true, maxlength: 400 },
    items: { type: [purchaseOrderLineSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

purchaseOrderSchema.index({ restaurantId: 1, poNumber: 1 }, { unique: true })
purchaseOrderSchema.index({ restaurantId: 1, status: 1, createdAt: -1 })

export default mongoose.model('PurchaseOrder', purchaseOrderSchema)
