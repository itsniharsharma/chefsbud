function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function nowWithinWindow(offer, now = new Date()) {
  const start = offer?.startTime ? new Date(offer.startTime) : null
  const end = offer?.endTime ? new Date(offer.endTime) : null

  if (start && now < start) return false
  if (end && now > end) return false
  return true
}

function mapItemTotals(orderItems) {
  const byId = new Map()
  for (const item of orderItems) {
    byId.set(String(item.menuItemId), {
      menuItemId: String(item.menuItemId),
      name: item.name,
      quantity: Number(item.quantity || 0),
      price: Number(item.price || 0),
      subtotal: Number(item.price || 0) * Number(item.quantity || 0),
    })
  }
  return byId
}

function applyItemPercentQty(offer, itemMap) {
  const targetIds = Array.isArray(offer.conditions?.menuItemIds) ? offer.conditions.menuItemIds.map(String) : []
  const minQty = Number(offer.conditions?.minQty || 0)
  const discountPercent = Number(offer.actions?.discountPercent || 0)

  if (!targetIds.length || minQty < 1 || discountPercent <= 0) return null

  let discount = 0
  let matched = []
  for (const id of targetIds) {
    const item = itemMap.get(id)
    if (!item || item.quantity < minQty) continue
    const itemDiscount = item.subtotal * (discountPercent / 100)
    discount += itemDiscount
    matched.push(item.name)
  }

  if (discount <= 0) return null
  return {
    discountAmount: round2(discount),
    description: `${discountPercent}% off on ${minQty}+ qty (${matched.join(', ')})`,
  }
}

function applyCartFlatThreshold(offer, subtotal) {
  const minSubtotal = Number(offer.conditions?.minSubtotal || 0)
  const discountAmount = Number(offer.actions?.discountAmount || 0)

  if (discountAmount <= 0) return null
  if (subtotal < minSubtotal) return null

  return {
    discountAmount: round2(discountAmount),
    description: `Flat Rs ${discountAmount} off above Rs ${minSubtotal}`,
  }
}

function applyBxgy(offer, itemMap) {
  const buyItemId = String(offer.conditions?.buyItemId || '')
  const buyQty = Number(offer.conditions?.buyQty || 0)
  const freeItemId = String(offer.actions?.freeItemId || '')
  const freeQty = Number(offer.actions?.freeQty || 0)

  if (!buyItemId || !freeItemId || buyQty < 1 || freeQty < 1) return null

  const buyItem = itemMap.get(buyItemId)
  const freeItem = itemMap.get(freeItemId)
  if (!buyItem || !freeItem) return null
  if (buyItem.quantity < buyQty) return null

  const bundles = Math.floor(buyItem.quantity / buyQty)
  const freeUnits = Math.min(freeItem.quantity, bundles * freeQty)
  if (freeUnits <= 0) return null

  const discount = freeUnits * freeItem.price
  return {
    discountAmount: round2(discount),
    description: `Buy ${buyQty} ${buyItem.name} get ${freeQty} ${freeItem.name} free`,
  }
}

function evaluateOffer(offer, itemMap, subtotal) {
  const ruleType = offer.ruleType
  if (ruleType === 'item_percent_qty') return applyItemPercentQty(offer, itemMap)
  if (ruleType === 'cart_flat_threshold') return applyCartFlatThreshold(offer, subtotal)
  if (ruleType === 'bxgy') return applyBxgy(offer, itemMap)
  return null
}

export function applyOffersToOrder({ orderItems, offers }) {
  const itemMap = mapItemTotals(orderItems)
  const subtotalAmount = round2(orderItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0))

  const eligibleOffers = (Array.isArray(offers) ? offers : [])
    .filter((offer) => offer?.active)
    .filter((offer) => nowWithinWindow(offer))
    .sort((a, b) => {
      const pa = Number(a?.priority || 100)
      const pb = Number(b?.priority || 100)
      if (pa !== pb) return pa - pb
      return new Date(a?.createdAt || 0).getTime() - new Date(b?.createdAt || 0).getTime()
    })

  const stackableApplied = []
  const exclusiveCandidates = []

  for (const offer of eligibleOffers) {
    const evaluation = evaluateOffer(offer, itemMap, subtotalAmount)
    if (!evaluation || evaluation.discountAmount <= 0) continue

    const applied = {
      offerId: String(offer._id),
      name: offer.name,
      ruleType: offer.ruleType || 'legacy',
      stackingPolicy: offer.stackingPolicy || 'stackable',
      discountAmount: round2(evaluation.discountAmount),
      description: evaluation.description,
    }

    if (offer.stackingPolicy === 'exclusive') {
      exclusiveCandidates.push(applied)
    } else {
      stackableApplied.push(applied)
    }
  }

  let appliedOffers = [...stackableApplied]
  if (exclusiveCandidates.length) {
    const bestExclusive = exclusiveCandidates.sort((a, b) => b.discountAmount - a.discountAmount)[0]
    appliedOffers.push(bestExclusive)
  }

  let discountTotal = round2(appliedOffers.reduce((sum, offer) => sum + offer.discountAmount, 0))
  if (discountTotal > subtotalAmount) {
    discountTotal = subtotalAmount
  }

  const totalAmount = round2(Math.max(0, subtotalAmount - discountTotal))

  return {
    subtotalAmount,
    discountTotal,
    totalAmount,
    appliedOffers,
  }
}
