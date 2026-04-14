function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function normalizePercent(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  if (parsed < 0) return 0
  if (parsed > 100) return 100
  return round2(parsed)
}

export function normalizeBillAdjustments(adjustments) {
  if (!Array.isArray(adjustments) || adjustments.length === 0) {
    return []
  }

  return adjustments.map((entry) => ({
    sourceType: entry?.sourceType || 'custom',
    menuItemId: entry?.sourceType === 'menu' ? String(entry?.menuItemId || '') : undefined,
    name: entry?.sourceType === 'custom' ? String(entry?.name || '').trim() : undefined,
    quantity: Number(entry?.quantity || 0),
    unitPrice: Number(entry?.unitPrice || 0),
  }))
}

export function buildBillPrintPayload(options = {}) {
  const normalized = normalizeBillAdjustments(options?.billAdjustments)
  const payload = {}
  if (normalized.length) {
    payload.billAdjustments = normalized
  }
  payload.billDiscountPercent = normalizePercent(options?.billDiscountPercent)
  return payload
}

export function applyBillDiscountToOrder({ order, billDiscountPercent = 0 }) {
  const normalizedDiscountPercent = normalizePercent(billDiscountPercent)
  const totalAmount = Number(order?.totalAmount || 0)
  const adjustmentSubtotal = Number(order?.billAdjustmentSubtotal || 0)
  const grossBeforeDiscount = round2(totalAmount + adjustmentSubtotal)
  const billDiscountAmount = round2((grossBeforeDiscount * normalizedDiscountPercent) / 100)
  const billTaxableAmount = round2(Math.max(0, grossBeforeDiscount - billDiscountAmount))
  const billServiceChargePercent = normalizePercent(order?.billServiceChargePercent)
  const billGstPercent = normalizePercent(order?.billGstPercent)
  const billServiceChargeAmount = round2((billTaxableAmount * billServiceChargePercent) / 100)
  const billGstAmount = round2((billTaxableAmount * billGstPercent) / 100)

  return {
    ...order,
    billDiscountPercent: normalizedDiscountPercent,
    billDiscountAmount,
    billTaxableAmount,
    billServiceChargePercent,
    billServiceChargeAmount,
    billGstPercent,
    billGstAmount,
    billFinalTotalAmount: round2(billTaxableAmount + billServiceChargeAmount + billGstAmount),
  }
}

export function buildReprintOrderForBill({ order, billAdjustments, billDiscountPercent = 0 }) {
  const normalizedExtras = normalizeBillAdjustments(billAdjustments)
  const normalizedDiscountPercent = normalizePercent(billDiscountPercent)

  const existingAdjustments = Array.isArray(order?.billAdjustments) ? order.billAdjustments : []
  const existingSubtotal = Number(order?.billAdjustmentSubtotal || 0)
  const extraSubtotal = normalizedExtras.reduce(
    (sum, entry) => sum + Number(entry.unitPrice || 0) * Number(entry.quantity || 0),
    0,
  )
  const nextAdjustmentSubtotal = round2(existingSubtotal + extraSubtotal)
  const totalAmount = Number(order?.totalAmount || 0)
  const grossBeforeDiscount = round2(totalAmount + nextAdjustmentSubtotal)
  const billDiscountAmount = round2((grossBeforeDiscount * normalizedDiscountPercent) / 100)
  const billTaxableAmount = round2(Math.max(0, grossBeforeDiscount - billDiscountAmount))
  const billServiceChargePercent = normalizePercent(order?.billServiceChargePercent)
  const billGstPercent = normalizePercent(order?.billGstPercent)
  const billServiceChargeAmount = round2((billTaxableAmount * billServiceChargePercent) / 100)
  const billGstAmount = round2((billTaxableAmount * billGstPercent) / 100)

  return {
    ...order,
    billAdjustments: normalizedExtras.length ? [...existingAdjustments, ...normalizedExtras] : existingAdjustments,
    billAdjustmentSubtotal: nextAdjustmentSubtotal,
    billDiscountPercent: normalizedDiscountPercent,
    billDiscountAmount,
    billTaxableAmount,
    billServiceChargePercent,
    billServiceChargeAmount,
    billGstPercent,
    billGstAmount,
    billFinalTotalAmount: round2(billTaxableAmount + billServiceChargeAmount + billGstAmount),
  }
}
