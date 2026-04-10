function normalizeText(value) {
  return String(value || '').trim()
}

function toLower(value) {
  return normalizeText(value).toLowerCase()
}

function extractNumber(text, regex) {
  const match = text.match(regex)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

function findItemByName(menuItems, nameHint) {
  const loweredHint = toLower(nameHint)
  if (!loweredHint) return null

  return menuItems.find((item) => toLower(item.name).includes(loweredHint)) || null
}

function getSelectedItems(menuItems, selectedItemIds = []) {
  const selectedSet = new Set((Array.isArray(selectedItemIds) ? selectedItemIds : []).map((id) => String(id)))
  return menuItems.filter((item) => selectedSet.has(String(item._id)))
}

function buildDraft({
  name,
  type,
  ruleType,
  conditions,
  actions,
  discountValue,
  stackingPolicy = 'stackable',
  priority = 100,
  sourcePrompt,
}) {
  return {
    name,
    type,
    ruleType,
    discountValue,
    conditions,
    actions,
    stackingPolicy,
    priority,
    active: true,
    startTime: null,
    endTime: null,
    sourcePrompt,
  }
}

function parseItemPercentQty({ prompt, selectedItems }) {
  const lowerPrompt = toLower(prompt)
  const discountPercent = extractNumber(lowerPrompt, /(\d+(?:\.\d+)?)\s*%/)
  const minQty = extractNumber(lowerPrompt, /buy(?:ing)?\s*(\d+)/)

  if (discountPercent === null || minQty === null) {
    return null
  }

  if (!selectedItems.length) {
    return {
      error: 'Select at least one menu item for quantity-based item discount.',
    }
  }

  const menuItemIds = selectedItems.map((item) => String(item._id))
  const selectedNames = selectedItems.map((item) => item.name).join(', ')

  return {
    draft: buildDraft({
      name: `${discountPercent}% off on ${minQty}+ qty`,
      type: 'Percentage Discount',
      ruleType: 'item_percent_qty',
      discountValue: `${discountPercent}%`,
      conditions: {
        menuItemIds,
        minQty,
      },
      actions: {
        discountPercent,
      },
      sourcePrompt: prompt,
    }),
    summary: `Applied ${discountPercent}% off when customer buys at least ${minQty} quantity of: ${selectedNames}.`,
  }
}

function parseCartFlatThreshold({ prompt }) {
  const lowerPrompt = toLower(prompt)
  const discountAmount =
    extractNumber(lowerPrompt, /(?:rs|inr|₹)\s*(\d+(?:\.\d+)?)\s*(?:off|discount)/) ||
    extractNumber(lowerPrompt, /(?:off|discount)\s*(?:of\s*)?(?:rs|inr|₹)?\s*(\d+(?:\.\d+)?)/)
  const minSubtotal = extractNumber(lowerPrompt, /(?:above|over|minimum|min)\s*(?:of\s*)?(?:rs|inr|₹)?\s*(\d+(?:\.\d+)?)/)

  if (discountAmount === null || minSubtotal === null) {
    return null
  }

  return {
    draft: buildDraft({
      name: `Flat Rs ${discountAmount} off above Rs ${minSubtotal}`,
      type: 'Flat Discount',
      ruleType: 'cart_flat_threshold',
      discountValue: `Rs ${discountAmount}`,
      conditions: {
        minSubtotal,
      },
      actions: {
        discountAmount,
      },
      sourcePrompt: prompt,
    }),
    summary: `Applied flat Rs ${discountAmount} discount when cart subtotal is at least Rs ${minSubtotal}.`,
  }
}

function parseBxgy({ prompt, menuItems, selectedItems }) {
  const lowerPrompt = toLower(prompt)
  const match = lowerPrompt.match(/buy\s*(\d+)\s+(.+?)\s+get\s*(\d+)\s+(.+?)\s+free/)
  if (!match) {
    return null
  }

  const buyQty = Number(match[1])
  const buyNameHint = match[2]
  const freeQty = Number(match[3])
  const freeNameHint = match[4]

  let buyItem = findItemByName(menuItems, buyNameHint)
  let freeItem = findItemByName(menuItems, freeNameHint)

  if (!buyItem && selectedItems[0]) buyItem = selectedItems[0]
  if (!freeItem && selectedItems[1]) freeItem = selectedItems[1]
  if (!freeItem && selectedItems[0]) freeItem = selectedItems[0]

  if (!buyItem || !freeItem || !buyQty || !freeQty) {
    return {
      error: 'Unable to map Buy X Get Y items. Select relevant items and retry with clearer names.',
    }
  }

  return {
    draft: buildDraft({
      name: `Buy ${buyQty} ${buyItem.name} get ${freeQty} ${freeItem.name} free`,
      type: 'Buy X Get Y',
      ruleType: 'bxgy',
      discountValue: `${freeQty} free`,
      conditions: {
        buyItemId: String(buyItem._id),
        buyQty,
      },
      actions: {
        freeItemId: String(freeItem._id),
        freeQty,
      },
      sourcePrompt: prompt,
    }),
    summary: `Offer configured as Buy ${buyQty} ${buyItem.name}, get ${freeQty} ${freeItem.name} free (discount applies only if free item is in cart).`,
  }
}

export function validateOfferDraft({ draft, restaurantMenuItemIds = [] }) {
  const errors = []
  const warnings = []

  if (!draft || typeof draft !== 'object') {
    return { valid: false, errors: ['Draft payload is required'], warnings }
  }

  if (!normalizeText(draft.name)) errors.push('Offer name is required')
  if (!normalizeText(draft.type)) errors.push('Offer type is required')

  const supportedRuleTypes = new Set(['item_percent_qty', 'cart_flat_threshold', 'bxgy'])
  if (!supportedRuleTypes.has(draft.ruleType)) {
    errors.push('Unsupported ruleType. Use one of item_percent_qty, cart_flat_threshold, bxgy')
  }

  const menuItemIdSet = new Set((Array.isArray(restaurantMenuItemIds) ? restaurantMenuItemIds : []).map(String))

  if (draft.ruleType === 'item_percent_qty') {
    const menuItemIds = Array.isArray(draft.conditions?.menuItemIds) ? draft.conditions.menuItemIds.map(String) : []
    const minQty = Number(draft.conditions?.minQty)
    const discountPercent = Number(draft.actions?.discountPercent)

    if (!menuItemIds.length) errors.push('item_percent_qty requires conditions.menuItemIds')
    if (!Number.isFinite(minQty) || minQty < 1) errors.push('item_percent_qty requires valid conditions.minQty >= 1')
    if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
      errors.push('item_percent_qty requires actions.discountPercent between 0 and 100')
    }

    for (const id of menuItemIds) {
      if (!menuItemIdSet.has(String(id))) {
        errors.push(`menuItemId ${id} is not valid for this restaurant`)
      }
    }
  }

  if (draft.ruleType === 'cart_flat_threshold') {
    const minSubtotal = Number(draft.conditions?.minSubtotal)
    const discountAmount = Number(draft.actions?.discountAmount)

    if (!Number.isFinite(minSubtotal) || minSubtotal < 0) {
      errors.push('cart_flat_threshold requires conditions.minSubtotal >= 0')
    }
    if (!Number.isFinite(discountAmount) || discountAmount <= 0) {
      errors.push('cart_flat_threshold requires actions.discountAmount > 0')
    }
  }

  if (draft.ruleType === 'bxgy') {
    const buyItemId = String(draft.conditions?.buyItemId || '')
    const buyQty = Number(draft.conditions?.buyQty)
    const freeItemId = String(draft.actions?.freeItemId || '')
    const freeQty = Number(draft.actions?.freeQty)

    if (!buyItemId) errors.push('bxgy requires conditions.buyItemId')
    if (!freeItemId) errors.push('bxgy requires actions.freeItemId')
    if (!Number.isFinite(buyQty) || buyQty < 1) errors.push('bxgy requires conditions.buyQty >= 1')
    if (!Number.isFinite(freeQty) || freeQty < 1) errors.push('bxgy requires actions.freeQty >= 1')

    if (buyItemId && !menuItemIdSet.has(buyItemId)) errors.push(`buyItemId ${buyItemId} is invalid`)
    if (freeItemId && !menuItemIdSet.has(freeItemId)) errors.push(`freeItemId ${freeItemId} is invalid`)
  }

  if (draft.stackingPolicy === 'exclusive') {
    warnings.push('Exclusive offer can block stacking with other active offers.')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

export function parseOfferPrompt({ prompt, menuItems, selectedItemIds }) {
  const cleanPrompt = normalizeText(prompt)
  if (!cleanPrompt) {
    return {
      error: 'Prompt is required',
    }
  }

  const items = Array.isArray(menuItems) ? menuItems : []
  const selectedItems = getSelectedItems(items, selectedItemIds)

  const parsers = [
    () => parseBxgy({ prompt: cleanPrompt, menuItems: items, selectedItems }),
    () => parseItemPercentQty({ prompt: cleanPrompt, selectedItems }),
    () => parseCartFlatThreshold({ prompt: cleanPrompt }),
  ]

  for (const parse of parsers) {
    const result = parse()
    if (!result) continue
    if (result.error) return { error: result.error }
    return {
      ...result,
      warnings: selectedItems.length ? [] : ['No menu item selected. Prompt parsing used only text context.'],
    }
  }

  return {
    error: 'Could not parse prompt into a supported phase-1 offer type. Try % off, flat discount, or Buy X Get Y.',
  }
}
