function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function toNonNegative(value) {
  return Math.max(0, toNumber(value, 0))
}

export function composePurchasePayload({ payload, itemById = new Map(), supplierName = '' }) {
  const sourceType = String(payload?.sourceType || 'Supplier').trim()
  const invoiceDate = new Date(payload?.invoiceDate)
  const invoiceNumber = String(payload?.invoiceNumber || '').trim()
  const gstNo = String(payload?.gstNo ?? payload?.gst ?? '').trim()

  const cgstPercent = toNonNegative(payload?.cgstPercent ?? payload?.cgst)
  const sgstPercent = toNonNegative(payload?.sgstPercent ?? payload?.sgst)
  const igstPercent = toNonNegative(payload?.igstPercent ?? payload?.igst)
  const deliveryCharge = toNonNegative(payload?.deliveryCharge ?? payload?.delivery)

  const discountType = String(payload?.discountType || 'Fixed').trim() === 'Percentage' ? 'Percentage' : 'Fixed'
  const discountValue = toNonNegative(payload?.discountValue ?? payload?.discount)
  const paymentType = String(payload?.paymentType || 'Unpaid').trim() === 'Paid' ? 'Paid' : 'Unpaid'

  const items = Array.isArray(payload?.items) ? payload.items : []
  const normalizedItems = items.map((row) => {
    const itemId = String(row?.itemId || '').trim()
    const quantity = toNonNegative(row?.quantity)
    const rate = toNonNegative(row?.rate)
    const unit = String(row?.unit || 'Unit').trim() || 'Unit'
    const mapped = itemById.get(itemId)

    return {
      itemId,
      itemName: String(mapped?.name || row?.itemName || '').trim(),
      quantity,
      unit,
      rate,
      amount: round2(quantity * rate),
    }
  })

  const subtotalAmount = round2(normalizedItems.reduce((sum, row) => sum + row.amount, 0))
  const totalDiscountAmount =
    discountType === 'Percentage'
      ? round2((subtotalAmount * discountValue) / 100)
      : round2(Math.min(discountValue, subtotalAmount))

  const taxableAmount = round2(Math.max(0, subtotalAmount - totalDiscountAmount + deliveryCharge))
  const cgstAmount = round2((taxableAmount * cgstPercent) / 100)
  const sgstAmount = round2((taxableAmount * sgstPercent) / 100)
  const igstAmount = round2((taxableAmount * igstPercent) / 100)
  const grandTotalAmount = round2(taxableAmount + cgstAmount + sgstAmount + igstAmount)

  return {
    sourceType,
    invoiceDate,
    invoiceNumber,
    gstNo,
    cgstPercent,
    sgstPercent,
    igstPercent,
    deliveryCharge,
    discountType,
    discountValue,
    totalDiscountAmount,
    paymentType,
    items: normalizedItems,
    subtotalAmount,
    taxableAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    grandTotalAmount,
    supplierNameSnapshot: String(supplierName || '').trim(),
  }
}
