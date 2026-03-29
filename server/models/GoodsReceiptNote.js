import mongoose from 'mongoose'

const goodsReceiptLineSchema = new mongoose.Schema(
  {
    purchaseOrderItemIndex: { type: Number, required: true, min: 0 },
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    itemName: { type: String, default: '', trim: true, maxlength: 160 },
    orderedQty: { type: Number, default: 0, min: 0 },
    receivedQty: { type: Number, required: true, min: 0 },
    acceptedQty: { type: Number, required: true, min: 0 },
    rejectedQty: { type: Number, default: 0, min: 0 },
    unit: { type: String, enum: ['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet'], required: true },
    unitRate: { type: Number, default: 0, min: 0 },
    note: { type: String, default: '', trim: true, maxlength: 220 },
  },
  { _id: false },
)

const goodsReceiptNoteSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    purchaseOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true, index: true },
    grnNumber: { type: String, required: true, trim: true, maxlength: 80 },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLocation', default: null, index: true },
    status: { type: String, enum: ['partial', 'full'], default: 'partial', index: true },
    lines: { type: [goodsReceiptLineSchema], default: [] },
    invoiceNumber: { type: String, default: '', trim: true, maxlength: 80 },
    invoiceDate: { type: Date, default: null },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  },
  { timestamps: true },
)

goodsReceiptNoteSchema.index({ restaurantId: 1, grnNumber: 1 }, { unique: true })
goodsReceiptNoteSchema.index({ restaurantId: 1, purchaseOrderId: 1, createdAt: -1 })

export default mongoose.model('GoodsReceiptNote', goodsReceiptNoteSchema)
