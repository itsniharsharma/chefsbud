import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import Button from './Button'
import { menuService } from '../services/menuService'
import { formatCurrencyINR } from '../utils/currency'
import { getOrderDisplayNumber } from '../utils/orderDisplay'

const MAX_ITEM_NAME_LENGTH = 160
const MIN_QTY = 1
const MAX_QTY = 100
const MIN_PRICE = 0
const MAX_PRICE = 100000

function clampInteger(value, min, max) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10)
  if (!Number.isFinite(parsed)) return min
  return Math.min(max, Math.max(min, parsed))
}

function clampPrice(value, min, max) {
  const raw = String(value ?? '').trim()
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) return min
  return Math.min(max, Math.max(min, parsed))
}

function normalizeName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ITEM_NAME_LENGTH)
}

function createDraftId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildMenuDraft(item) {
  const defaultPrice = Number(item?.price || 0)
  return {
    draftId: createDraftId('menu'),
    sourceType: 'menu',
    menuItemId: String(item?._id || ''),
    name: String(item?.name || ''),
    quantity: 1,
    unitPrice: defaultPrice,
  }
}

function buildCustomDraft({ name, quantity, unitPrice }) {
  const safeQuantity = Number(quantity || 1)
  const safeUnitPrice = Number(unitPrice || 0)

  return {
    draftId: createDraftId('custom'),
    sourceType: 'custom',
    menuItemId: '',
    name: String(name || '').trim(),
    quantity: safeQuantity,
    unitPrice: safeUnitPrice,
  }
}

export default function BillPrintModal({
  open,
  order,
  restaurantId,
  printing,
  onClose,
  onSimplePrint,
}) {
  const [step, setStep] = useState('choice')
  const [menuData, setMenuData] = useState({ categories: [], items: [] })
  const [menuLoading, setMenuLoading] = useState(false)
  const [menuError, setMenuError] = useState('')
  const [adjustments, setAdjustments] = useState([])
  const [billDiscountPercent, setBillDiscountPercent] = useState('0')
  const [manualForm, setManualForm] = useState({ name: '', quantity: 1, unitPrice: '' })
  const [formError, setFormError] = useState('')

  const normalizePercent = (value) => {
    const parsed = Number.parseFloat(String(value ?? '').trim())
    if (!Number.isFinite(parsed)) return 0
    return Math.min(100, Math.max(0, parsed))
  }

  useEffect(() => {
    if (!open) {
      setStep('choice')
      setMenuLoading(false)
      setMenuError('')
      setAdjustments([])
      setBillDiscountPercent('0')
      setManualForm({ name: '', quantity: 1, unitPrice: '' })
      setFormError('')
    }
  }, [open])

  useEffect(() => {
    setMenuData({ categories: [], items: [] })
    setMenuError('')
  }, [restaurantId])

  useEffect(() => {
    if (!open) return
    setBillDiscountPercent(String(Number(order?.billDiscountPercent || 0)))
  }, [open, order?.billDiscountPercent])

  const loadMenu = async () => {
    if (!restaurantId || menuLoading || menuData.items.length) return

    setMenuLoading(true)
    setMenuError('')
    try {
      const data = await menuService.getManagedMenu(restaurantId)
      setMenuData({
        categories: Array.isArray(data?.categories) ? data.categories : [],
        items: Array.isArray(data?.items) ? data.items : [],
      })
    } catch (requestError) {
      setMenuError(requestError?.response?.data?.message || 'Unable to load menu items for bill adjustments.')
    } finally {
      setMenuLoading(false)
    }
  }

  const openComposer = () => {
    setStep('composer')
    void loadMenu()
  }

  const groupedCategories = useMemo(() => {
    const itemsByCategory = new Map()
    for (const item of menuData.items) {
      const categoryId = String(item?.categoryId || '')
      if (!itemsByCategory.has(categoryId)) {
        itemsByCategory.set(categoryId, [])
      }
      itemsByCategory.get(categoryId).push(item)
    }

    return menuData.categories
      .map((category) => ({
        ...category,
        items: itemsByCategory.get(String(category?._id || '')) || [],
      }))
      .filter((category) => category.items.length > 0)
  }, [menuData])

  const selectedMenuItemIds = useMemo(
    () => new Set(adjustments.filter((entry) => entry.sourceType === 'menu').map((entry) => String(entry.menuItemId))),
    [adjustments],
  )

  const adjustmentSubtotal = useMemo(
    () => adjustments.reduce((sum, entry) => sum + Number(entry.unitPrice || 0) * Number(entry.quantity || 0), 0),
    [adjustments],
  )

  const baseBillTotal = useMemo(
    () => Number(order?.billFinalTotalAmount ?? order?.totalAmount ?? 0),
    [order?.billFinalTotalAmount, order?.totalAmount],
  )

  const finalBillTotal = useMemo(
    () => {
      const gross = Number(baseBillTotal || 0) + Number(adjustmentSubtotal || 0)
      const discountAmount = (gross * normalizePercent(billDiscountPercent)) / 100
      return gross - discountAmount
    },
    [baseBillTotal, adjustmentSubtotal, billDiscountPercent],
  )

  const discountAmount = useMemo(() => {
    const gross = Number(baseBillTotal || 0) + Number(adjustmentSubtotal || 0)
    return (gross * normalizePercent(billDiscountPercent)) / 100
  }, [baseBillTotal, adjustmentSubtotal, billDiscountPercent])

  const toggleMenuItem = (item) => {
    const menuItemId = String(item?._id || '')
    setFormError('')
    setAdjustments((current) => {
      const exists = current.some((entry) => entry.sourceType === 'menu' && String(entry.menuItemId) === menuItemId)
      if (exists) {
        return current.filter((entry) => !(entry.sourceType === 'menu' && String(entry.menuItemId) === menuItemId))
      }

      return [...current, buildMenuDraft(item)]
    })
  }

  const updateAdjustment = (draftId, field, rawValue) => {
    setAdjustments((current) =>
      current.map((entry) => {
        if (entry.draftId !== draftId) return entry

        if (field === 'quantity') {
          return { ...entry, quantity: clampInteger(rawValue, MIN_QTY, MAX_QTY) }
        }

        if (field === 'unitPrice') {
          return { ...entry, unitPrice: clampPrice(rawValue, MIN_PRICE, MAX_PRICE) }
        }

        return { ...entry, [field]: rawValue }
      }),
    )
  }

  const removeAdjustment = (draftId) => {
    setAdjustments((current) => current.filter((entry) => entry.draftId !== draftId))
  }

  const addManualItem = () => {
    const name = normalizeName(manualForm.name)
    const quantity = clampInteger(manualForm.quantity, MIN_QTY, MAX_QTY)
    const unitPrice = clampPrice(manualForm.unitPrice, MIN_PRICE, MAX_PRICE)

    if (!name || name.length > MAX_ITEM_NAME_LENGTH) {
      setFormError('Manual item name is required and must be under 160 characters.')
      return
    }

    if (!Number.isInteger(quantity) || quantity < MIN_QTY || quantity > MAX_QTY) {
      setFormError('Manual item quantity must be between 1 and 100.')
      return
    }

    if (!Number.isFinite(unitPrice) || unitPrice < MIN_PRICE || unitPrice > MAX_PRICE) {
      setFormError('Manual item price must be between 0 and 100000.')
      return
    }

    setAdjustments((current) => [...current, buildCustomDraft({ name, quantity, unitPrice })])
    setManualForm({ name: '', quantity: 1, unitPrice: '' })
    setFormError('')
  }

  const getNormalizedAdjustments = () =>
    adjustments.map((entry) => ({
      sourceType: entry.sourceType,
      menuItemId: entry.sourceType === 'menu' ? entry.menuItemId : undefined,
      name: entry.sourceType === 'custom' ? normalizeName(entry.name) : undefined,
      quantity: clampInteger(entry.quantity, MIN_QTY, MAX_QTY),
      unitPrice: clampPrice(entry.unitPrice, MIN_PRICE, MAX_PRICE),
    }))

  const submitAdjustments = () => {
    setStep('choice')
  }

  return (
    <Modal open={open} title="Print Bill + KOT" onClose={printing ? undefined : onClose}>
      {step === 'choice' ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Order <span className="font-semibold text-slate-900">{getOrderDisplayNumber(order)}</span> is ready to print.
            Print Bill + KOT directly or add bill-only extra items first.
          </p>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <div className="flex items-center justify-between gap-3">
              <span>Current total</span>
              <span className="font-semibold text-slate-900">{formatCurrencyINR(order?.billFinalTotalAmount ?? order?.totalAmount ?? 0)}</span>
            </div>
            <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-2">
              <label htmlFor="bill-discount-percent" className="text-xs font-medium text-slate-600">Discount (%)</label>
              <input
                id="bill-discount-percent"
                className="input w-24 px-2 py-1 text-right text-xs"
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={billDiscountPercent}
                onChange={(event) => setBillDiscountPercent(event.target.value)}
              />
            </div>
            {adjustments.length ? (
              <div className="mt-2 flex items-center justify-between text-xs">
                <span>Extra items ({adjustments.length})</span>
                <span className="font-semibold text-slate-900">+{formatCurrencyINR(adjustmentSubtotal)}</span>
              </div>
            ) : null}
            <div className="mt-2 flex items-center justify-between text-xs">
              <span>Discount amount</span>
              <span className="font-semibold text-slate-900">-{formatCurrencyINR(discountAmount)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-1 text-xs">
              <span className="font-medium">Final total</span>
              <span className="font-bold text-[var(--primary)]">{formatCurrencyINR(finalBillTotal)}</span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={printing}>
              Cancel
            </Button>
            <Button type="button" variant="secondary" onClick={openComposer} disabled={printing}>
              Add Extra Items
            </Button>
            <Button
              type="button"
              onClick={() =>
                onSimplePrint?.({
                  billAdjustments: getNormalizedAdjustments(),
                  billDiscountPercent: normalizePercent(billDiscountPercent),
                })
              }
              disabled={printing}
            >
              {printing ? 'Printing...' : 'Simply Print Both'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3" aria-live="polite">
          {/* Top actions */}
          <div className="sticky top-0 z-10 -mx-1 flex justify-end gap-2 border-b border-slate-100 bg-white px-1 pb-2">
            <Button type="button" variant="secondary" className="text-xs" onClick={() => setStep('choice')} disabled={printing}>
              Back
            </Button>
            <Button type="button" variant="secondary" className="text-xs" onClick={onClose} disabled={printing}>
              Cancel
            </Button>
            <Button type="button" className="text-xs" onClick={submitAdjustments} disabled={printing}>
              Next
            </Button>
          </div>

          {/* Bill total summary */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <div className="flex items-center justify-between">
              <span>Base total</span>
              <span className="font-semibold text-slate-900">{formatCurrencyINR(baseBillTotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Adjustments</span>
              <span className="font-semibold text-slate-900">+{formatCurrencyINR(adjustmentSubtotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Discount ({normalizePercent(billDiscountPercent)}%)</span>
              <span className="font-semibold text-slate-900">-{formatCurrencyINR(discountAmount)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-1">
              <span className="font-medium">Final total</span>
              <span className="font-bold text-[var(--primary)]">{formatCurrencyINR(finalBillTotal)}</span>
            </div>
          </div>

          {formError ? (
            <p className="rounded-md border border-red-100 bg-red-50 px-2 py-1 text-xs font-medium text-red-600" role="alert">
              {formError}
            </p>
          ) : null}
          {menuError ? (
            <p className="rounded-md border border-red-100 bg-red-50 px-2 py-1 text-xs font-medium text-red-600" role="alert">
              {menuError}
            </p>
          ) : null}

          {/* Selected adjustments */}
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Added items</h4>
            {adjustments.length ? (
              <div className="space-y-1 rounded-lg border border-slate-200 p-2">
                {adjustments.map((entry) => (
                  <div key={entry.draftId} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{entry.name}</p>
                    <input
                      className="input w-14 px-1 py-1 text-xs"
                      type="number"
                      min={MIN_QTY}
                      max={MAX_QTY}
                      inputMode="numeric"
                      aria-label={`Quantity for ${entry.name}`}
                      value={entry.quantity}
                      onChange={(event) => updateAdjustment(entry.draftId, 'quantity', event.target.value)}
                    />
                    <input
                      className="input w-20 px-1 py-1 text-xs"
                      type="number"
                      min={MIN_PRICE}
                      max={MAX_PRICE}
                      step="0.01"
                      inputMode="decimal"
                      aria-label={`Unit price for ${entry.name}`}
                      value={entry.unitPrice}
                      onChange={(event) => updateAdjustment(entry.draftId, 'unitPrice', event.target.value)}
                    />
                    <button
                      type="button"
                      className="shrink-0 text-slate-400 hover:text-red-500"
                      onClick={() => removeAdjustment(entry.draftId)}
                      aria-label={`Remove ${entry.name}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400">
                No adjustments added yet.
              </p>
            )}
          </div>

          {/* Manual item form */}
          <div className="rounded-lg border border-slate-200 p-2">
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Add manual item</h4>
            <div className="space-y-1.5">
              <label htmlFor="manual-item-name" className="sr-only">
                Manual item name
              </label>
              <input
                id="manual-item-name"
                className="input w-full px-2 py-1 text-xs"
                placeholder="Item name"
                maxLength={MAX_ITEM_NAME_LENGTH}
                value={manualForm.name}
                onChange={(event) => setManualForm((prev) => ({ ...prev, name: normalizeName(event.target.value) }))}
              />
              <div className="flex gap-1.5">
                <label htmlFor="manual-item-qty" className="sr-only">
                  Manual item quantity
                </label>
                <input
                  id="manual-item-qty"
                  className="input flex-1 px-2 py-1 text-xs"
                  type="number"
                  min={MIN_QTY}
                  max={MAX_QTY}
                  inputMode="numeric"
                  placeholder="Qty"
                  value={manualForm.quantity}
                  onChange={(event) => setManualForm((prev) => ({ ...prev, quantity: event.target.value }))}
                />
                <label htmlFor="manual-item-price" className="sr-only">
                  Manual item price
                </label>
                <input
                  id="manual-item-price"
                  className="input flex-1 px-2 py-1 text-xs"
                  type="number"
                  min={MIN_PRICE}
                  max={MAX_PRICE}
                  step="0.01"
                  inputMode="decimal"
                  placeholder="Price (₹)"
                  value={manualForm.unitPrice}
                  onChange={(event) => setManualForm((prev) => ({ ...prev, unitPrice: event.target.value }))}
                />
                <Button type="button" variant="secondary" className="shrink-0 px-3 py-1 text-xs" onClick={addManualItem}>
                  Add
                </Button>
              </div>
            </div>
          </div>

          {/* Menu picker */}
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Pick from menu</h4>
            {menuLoading ? <p className="text-xs text-slate-500">Loading menu...</p> : null}
            {!menuLoading && groupedCategories.length ? (
              <div className="space-y-2">
                {groupedCategories.map((category) => (
                  <div key={category._id} className="rounded-lg border border-slate-200 p-2">
                    <h5 className="mb-1 text-xs font-semibold text-slate-700">{category.name}</h5>
                    <div className="space-y-1">
                      {category.items.map((item) => {
                        const selected = selectedMenuItemIds.has(String(item._id))
                        return (
                          <label
                            key={item._id}
                            className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                          >
                            <span className="font-medium text-slate-900">{item.name}</span>
                            <span className="shrink-0 text-slate-500">{formatCurrencyINR(item.price)}</span>
                            <input
                              type="checkbox"
                              className="shrink-0"
                              checked={selected}
                              aria-label={`${selected ? 'Remove' : 'Add'} ${item.name}`}
                              onChange={() => toggleMenuItem(item)}
                            />
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : !menuLoading ? (
              <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400">
                No menu items available.
              </p>
            ) : null}
          </div>

        </div>
      )}
    </Modal>
  )
}
