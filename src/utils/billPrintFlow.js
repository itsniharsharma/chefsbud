function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
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
  return normalized.length ? { billAdjustments: normalized } : {}
}

export function buildReprintOrderForBill({ order, billAdjustments }) {
  const normalizedExtras = normalizeBillAdjustments(billAdjustments)
  if (!normalizedExtras.length) {
    return order
  }

  const existingAdjustments = Array.isArray(order?.billAdjustments) ? order.billAdjustments : []
  const existingSubtotal = Number(order?.billAdjustmentSubtotal || 0)
  const extraSubtotal = normalizedExtras.reduce(
    (sum, entry) => sum + Number(entry.unitPrice || 0) * Number(entry.quantity || 0),
    0,
  )
  const baseFinalTotal = Number(order?.billFinalTotalAmount ?? order?.totalAmount ?? 0)

  return {
    ...order,
    billAdjustments: [...existingAdjustments, ...normalizedExtras],
    billAdjustmentSubtotal: round2(existingSubtotal + extraSubtotal),
    billFinalTotalAmount: round2(baseFinalTotal + extraSubtotal),
  }
}
