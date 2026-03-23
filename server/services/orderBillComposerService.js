import MenuItem from '../models/MenuItem.js'

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function normalizeQuantity(value) {
  const quantity = Number(value)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    return null
  }
  return quantity
}

function normalizeUnitPrice(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100000) {
    return null
  }
  return round2(numeric)
}

function normalizeName(value) {
  return String(value || '').trim()
}

export async function buildValidatedBillAdjustments({ restaurantId, adjustments = [] }) {
  const rows = Array.isArray(adjustments) ? adjustments.slice(0, 50) : []
  if (!rows.length) {
    return {
      billAdjustments: [],
      adjustmentSubtotal: 0,
    }
  }

  const menuIds = [...new Set(
    rows
      .filter((entry) => String(entry?.sourceType || '') === 'menu')
      .map((entry) => String(entry?.menuItemId || '').trim())
      .filter(Boolean),
  )]

  const menuItems = menuIds.length
    ? await MenuItem.find({ _id: { $in: menuIds }, restaurantId })
      .select('_id name price')
      .lean()
    : []

  const menuMap = new Map(menuItems.map((item) => [String(item._id), item]))
  const billAdjustments = []

  for (const raw of rows) {
    const sourceType = String(raw?.sourceType || '').trim().toLowerCase()

    if (sourceType === 'menu') {
      const menuItemId = String(raw?.menuItemId || '').trim()
      const menuItem = menuMap.get(menuItemId)
      if (!menuItem) {
        const error = new Error('Invalid menu item selected for bill adjustment.')
        error.statusCode = 400
        throw error
      }

      const quantity = normalizeQuantity(raw?.quantity)
      const defaultUnitPrice = round2(menuItem.price)
      const unitPrice = raw?.unitPrice === undefined || raw?.unitPrice === null || raw?.unitPrice === ''
        ? defaultUnitPrice
        : normalizeUnitPrice(raw?.unitPrice)

      if (!quantity || unitPrice === null) {
        const error = new Error('Bill adjustment quantity or price is invalid.')
        error.statusCode = 400
        throw error
      }

      billAdjustments.push({
        sourceType: 'menu',
        menuItemId,
        name: String(menuItem.name || '').trim(),
        quantity,
        unitPrice,
        defaultUnitPrice,
      })
      continue
    }

    if (sourceType === 'custom') {
      const name = normalizeName(raw?.name)
      const quantity = normalizeQuantity(raw?.quantity)
      const unitPrice = normalizeUnitPrice(raw?.unitPrice)

      if (!name || name.length > 160 || !quantity || unitPrice === null) {
        const error = new Error('Custom bill item name, quantity or price is invalid.')
        error.statusCode = 400
        throw error
      }

      billAdjustments.push({
        sourceType: 'custom',
        menuItemId: null,
        name,
        quantity,
        unitPrice,
        defaultUnitPrice: unitPrice,
      })
      continue
    }

    const error = new Error('Unsupported bill adjustment type.')
    error.statusCode = 400
    throw error
  }

  return {
    billAdjustments,
    adjustmentSubtotal: round2(
      billAdjustments.reduce((sum, item) => sum + Number(item.unitPrice || 0) * Number(item.quantity || 0), 0),
    ),
  }
}