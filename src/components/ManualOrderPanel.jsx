import { memo, useMemo, useState, useCallback, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from './Button'
import { orderService } from '../services/orderService'
import { queryKeys } from '../lib/queryKeys'
import { formatCurrencyINR } from '../utils/currency'

const portionSizeLabelMap = {
  small: 'Small',
  regular: 'Regular',
  medium: 'Medium',
  large: 'Large',
  xlarge: 'XLarge',
}

function normalizeSearchTerm(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function lowerBound(entries, target) {
  let lo = 0
  let hi = entries.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (entries[mid].key < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

function upperBound(entries, target) {
  let lo = 0
  let hi = entries.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (entries[mid].key <= target) lo = mid + 1
    else hi = mid
  }
  return lo
}

function formatPortionSizeLabel(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return portionSizeLabelMap[normalized] || 'Medium'
}

function getDietLabel(isVeg) {
  return isVeg === false ? 'Non-Veg' : 'Veg'
}

function buildCategoryIndex(items = []) {
  const categoryMap = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const categoryId = String(item?.categoryId || '')
    if (!categoryId || !item?.available || !item?.name) continue
    const categoryList = categoryMap.get(categoryId) || []
    categoryList.push(item)
    categoryMap.set(categoryId, categoryList)
  }
  return categoryMap
}

function hydrateCategoryIndex(menu = {}) {
  if (menu?.indexes && typeof menu.indexes === 'object' && menu.indexes.categoryItems) {
    return new Map(Object.entries(menu.indexes.categoryItems || {}))
  }

  return buildCategoryIndex(menu?.items)
}

// Generate unique idempotency key
const generateIdempotencyKey = () => {
  return `manual-order-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

const ManualOrderPanel = memo(function ManualOrderPanel({
  restaurantId,
  restaurantSlug = '',
  menu = {},
  tables = [],
  onOrderCreated,
  externalActiveCategory = '',
  qrOrdersPanel = null,
}) {
  const [selectedFloor, setSelectedFloor] = useState('1')
  const [selectedTable, setSelectedTable] = useState('')
  const [cart, setCart] = useState({}) // { itemId: { id, name, price, quantity, portionSize } }
  const [activeCategory, setActiveCategory] = useState('')
  const [itemSearchTerm, setItemSearchTerm] = useState('')
  const [menuError, setMenuError] = useState('')
  const [customerNote, setCustomerNote] = useState('')
  const queryClient = useQueryClient()

  const createOrderMutation = useMutation({
    mutationFn: async ({ items, tableNumber, floorNumber, customerNote }) => {
      if (!items.length) throw new Error('No items selected')

      const normalizedSlug = String(restaurantSlug || '').trim()
      if (!normalizedSlug) {
        throw new Error('Restaurant slug is missing. Refresh and try again.')
      }

      const idempotencyKey = generateIdempotencyKey()
      return orderService.create({
        restaurantSlug: normalizedSlug,
        tableNumber: Number(tableNumber),
        floorNumber: Number(floorNumber),
        customerNote: String(customerNote || '').trim(),
        items: items.map((item) => ({
          menuItemId: item.id,
          quantity: item.quantity,
        })),
        idempotencyKey,
      })
    },
    onSuccess: (createdOrder) => {
      // Invalidate orders board to fetch fresh data
      queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard.ordersBoard(restaurantId),
      })

      // Clear cart
      setCart({})
      setMenuError('')

      // Callback
      if (onOrderCreated) {
        onOrderCreated(createdOrder)
      }
    },
    onError: (error) => {
      setMenuError(error?.response?.data?.message || error?.message || 'Failed to create order')
    },
  })

  // Group menu into categories
  const menuCategories = useMemo(() => {
    if (!menu?.categories || !Array.isArray(menu.categories)) return []
    return menu.categories.filter((cat) => Boolean(cat?.name))
  }, [menu])

  const categoryIndex = useMemo(() => hydrateCategoryIndex(menu), [menu])

  // Set first category as active on load
  useEffect(() => {
    if (activeCategory || !menuCategories.length) return
    setActiveCategory(menuCategories[0]?._id || '')
  }, [menuCategories.length, activeCategory, menuCategories])

  useEffect(() => {
    const nextCategory = String(externalActiveCategory || '').trim()
    if (!nextCategory) return

    const existsInMenu = menuCategories.some((category) => String(category?._id || '') === nextCategory)
    if (!existsInMenu) return

    setActiveCategory(nextCategory)
  }, [externalActiveCategory, menuCategories])

  // Get items for active category
  const categoryItems = useMemo(() => {
    if (!activeCategory) return []
    return categoryIndex.get(String(activeCategory)) || []
  }, [activeCategory, categoryIndex])

  const allAvailableItems = useMemo(() => {
    if (Array.isArray(menu?.items) && menu.items.length) {
      return menu.items.filter((item) => item?.available && item?.name)
    }

    const merged = []
    for (const list of categoryIndex.values()) {
      if (!Array.isArray(list)) continue
      for (const item of list) {
        if (item?.available && item?.name) merged.push(item)
      }
    }
    return merged
  }, [menu, categoryIndex])

  const itemExactNameIndex = useMemo(() => {
    const index = new Map()
    for (const item of allAvailableItems) {
      const key = normalizeSearchTerm(item?.name)
      if (!key) continue
      const bucket = index.get(key) || []
      bucket.push(item)
      index.set(key, bucket)
    }
    return index
  }, [allAvailableItems])

  const sortedItemNameEntries = useMemo(() => {
    return allAvailableItems
      .map((item) => ({ key: normalizeSearchTerm(item?.name), item }))
      .filter((entry) => Boolean(entry.key))
      .sort((a, b) => a.key.localeCompare(b.key))
  }, [allAvailableItems])

  const searchedItems = useMemo(() => {
    const query = normalizeSearchTerm(itemSearchTerm)
    if (!query) return []

    const seenIds = new Set()
    const result = []

    const exact = itemExactNameIndex.get(query) || []
    for (const item of exact) {
      const id = String(item?._id || '')
      if (!id || seenIds.has(id)) continue
      seenIds.add(id)
      result.push(item)
    }

    const start = lowerBound(sortedItemNameEntries, query)
    const end = upperBound(sortedItemNameEntries, `${query}\uffff`)
    for (let index = start; index < end; index += 1) {
      const item = sortedItemNameEntries[index]?.item
      const id = String(item?._id || '')
      if (!id || seenIds.has(id)) continue
      seenIds.add(id)
      result.push(item)
    }

    if (!result.length) {
      // Safety fallback to ensure search still returns results when index shape drifts.
      for (const item of allAvailableItems) {
        const id = String(item?._id || '')
        const key = normalizeSearchTerm(item?.name)
        if (!id || seenIds.has(id) || !key.includes(query)) continue
        seenIds.add(id)
        result.push(item)
      }
    }

    return result
  }, [itemSearchTerm, itemExactNameIndex, sortedItemNameEntries, allAvailableItems])

  const hasActiveSearch = Boolean(normalizeSearchTerm(itemSearchTerm))
  const visibleItems = hasActiveSearch ? searchedItems : categoryItems

  // Get available tables for selected floor
  const availableTables = useMemo(() => {
    if (!tables || !Array.isArray(tables)) return []
    const floor = Number(selectedFloor)
    return tables
      .filter((t) => Number(t?.floorNumber || 1) === floor && t?.active)
      .sort((a, b) => Number(a.tableNumber) - Number(b.tableNumber))
  }, [tables, selectedFloor])

  useEffect(() => {
    if (!availableTables.length) {
      if (selectedTable) setSelectedTable('')
      return
    }

    const isSelectedTableAvailable = availableTables.some(
      (table) => String(table?.tableNumber || '') === String(selectedTable || ''),
    )

    if (!isSelectedTableAvailable) {
      setSelectedTable(String(availableTables[0]?.tableNumber || ''))
    }
  }, [availableTables, selectedTable])

  // Calculate cart total and item count
  const cartStats = useMemo(() => {
    const items = Object.values(cart)
    if (!items.length) return { count: 0, total: 0 }

    return {
      count: items.reduce((sum, item) => sum + item.quantity, 0),
      total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    }
  }, [cart])

  const handleSelectItem = useCallback(
    (item) => {
      setCart((prev) => {
        const next = { ...prev }
        const itemId = item._id

        if (next[itemId]) {
          next[itemId].quantity += 1
        } else {
          next[itemId] = {
            id: item._id,
            name: item.name,
            price: item.price,
            quantity: 1,
            portionSize: item?.portionSize || 'medium',
          }
        }
        return next
      })
    },
    []
  )

  const handleUpdateItemQuantity = useCallback((itemId, quantity) => {
    setCart((prev) => {
      const next = { ...prev }
      if (quantity <= 0) {
        delete next[itemId]
      } else {
        next[itemId].quantity = quantity
      }
      return next
    })
  }, [])

  const handleRemoveItem = useCallback((itemId) => {
    setCart((prev) => {
      const next = { ...prev }
      delete next[itemId]
      return next
    })
  }, [])

  const handleCreateOrder = async () => {
    if (!selectedTable) {
      setMenuError('Please select a table')
      return
    }

    if (!Object.keys(cart).length) {
      setMenuError('Add items to the order')
      return
    }

    setMenuError('')

    const items = Object.values(cart).map((item) => ({
      ...item,
    }))

    createOrderMutation.mutate({
      items,
      tableNumber: Number(selectedTable),
      floorNumber: Number(selectedFloor),
      customerNote,
    })
  }

  const handleClearCart = () => {
    setCart({})
    setMenuError('')
    setCustomerNote('')
  }

  const uniqueFloors = useMemo(() => {
    if (!tables || !Array.isArray(tables)) return ['1']
    const floors = new Set(tables.map((t) => String(t?.floorNumber || 1)))
    return Array.from(floors).sort((a, b) => Number(a) - Number(b))
  }, [tables])

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[1.08fr_0.92fr]">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-red-200 bg-gradient-to-b from-red-50 to-white p-4 shadow-sm">
        <div className="mb-3 border-b border-red-200 pb-2">
          <h3 className="text-base font-semibold text-slate-900">Manual Order Creation</h3>
          <p className="mt-1 text-xs text-slate-600">Choose a category and add sub-items to the live bill.</p>
        </div>

        {menuError ? <div className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{menuError}</div> : null}

        <div className="mb-3 space-y-2 border-b border-red-200 pb-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-slate-700">
              <span className="font-medium">Floor</span>
              <select
                className="input h-10 text-sm leading-5"
                value={selectedFloor}
                onChange={(e) => {
                  setSelectedFloor(e.target.value)
                  setSelectedTable('')
                }}
              >
                {uniqueFloors.map((floor) => (
                  <option key={floor} value={floor}>
                    Floor {floor}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-slate-700">
              <span className="font-medium">Table</span>
              <select
                className="input h-10 text-sm leading-5"
                value={selectedTable}
                onChange={(e) => setSelectedTable(e.target.value)}
              >
                <option value="">Select table</option>
                {availableTables.map((table) => (
                  <option key={table._id} value={table.tableNumber}>
                    Table {table.tableNumber}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Search item</span>
            <input
              className="input h-10 text-sm"
              type="text"
              value={itemSearchTerm}
              onChange={(event) => setItemSearchTerm(event.target.value)}
              placeholder="Type item name..."
            />
          </label>
        </div>

        {!menu?.categories?.length ? (
          <div className="py-4 text-center text-xs text-slate-500">No menu available</div>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between gap-3 border-b border-red-100 pb-2">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--primary)]">
                {hasActiveSearch ? `Search results (${visibleItems.length})` : menuCategories.find((category) => String(category?._id || '') === String(activeCategory || ''))?.name || 'Selected Category'}
              </p>
              {!hasActiveSearch && activeCategory ? (
                <p className="text-[11px] text-slate-500">Tap cards below to add items</p>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1 pt-1">
              {visibleItems.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {visibleItems.map((item) => (
                    <button
                      key={item._id}
                      type="button"
                      onClick={() => handleSelectItem(item)}
                      disabled={createOrderMutation.isPending}
                      className="group flex min-h-[8.75rem] flex-col justify-between rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-[0_8px_18px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-red-300 hover:shadow-[0_14px_26px_rgba(15,23,42,0.08)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <div>
                        <p className="line-clamp-2 text-sm font-semibold text-slate-900">{item.name}</p>
                        <p className="mt-1 text-base font-bold text-[var(--primary)]">{formatCurrencyINR(item.price)}</p>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${item.isVeg === false ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                          {getDietLabel(item.isVeg)}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                          {formatPortionSizeLabel(item.portionSize)}
                        </span>
                        <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--primary)] opacity-0 transition group-hover:opacity-100">
                          Click to add
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-xs text-slate-500">
                  {hasActiveSearch ? 'No items match your search' : 'No items in category'}
                </p>
              )}
            </div>
          </>
        )}
      </section>

      <section className="flex min-h-0 flex-col gap-3 overflow-hidden">
        <div className="flex min-h-0 flex-[0_0_auto] flex-col overflow-hidden rounded-2xl border border-red-200 bg-white p-4 shadow-sm">
          <div className="mb-2 border-b border-red-100 pb-2">
            <h3 className="text-base font-semibold text-slate-900">Billing Section</h3>
            <p className="mt-1 text-xs text-slate-600">Manual add items, notes, and create order.</p>
          </div>

          {Object.keys(cart).length ? (
            <div className="mb-2 max-h-28 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-2">
              {Object.values(cart).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded bg-white p-1.5 text-xs"
                >
                  <span className="flex-1 truncate text-slate-900">{item.name}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleUpdateItemQuantity(item.id, item.quantity - 1)}
                      className="h-5 w-5 rounded border border-slate-300 text-center leading-4 hover:bg-red-50"
                    >
                      −
                    </button>
                    <span className="w-5 text-center font-medium">{item.quantity}</span>
                    <button
                      onClick={() => handleUpdateItemQuantity(item.id, item.quantity + 1)}
                      className="h-5 w-5 rounded border border-slate-300 text-center leading-4 hover:bg-green-50"
                    >
                      +
                    </button>
                    <button
                      onClick={() => handleRemoveItem(item.id)}
                      className="ml-1 text-red-600 hover:text-red-700"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mb-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Add items from the left panel to start billing.
            </p>
          )}

          <div className="mb-2 rounded-lg bg-red-100 p-2">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-slate-700">Items:</span>
              <span className="font-bold text-slate-900">{cartStats.count}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-red-200 pt-1">
              <span className="font-bold text-slate-900">Total:</span>
              <span className="font-bold text-red-700">{formatCurrencyINR(cartStats.total)}</span>
            </div>
          </div>

          <label className="mb-2 block">
            <span className="mb-1 block text-xs font-medium text-slate-800">Additional Note (optional)</span>
            <textarea
              className="input min-h-[68px] bg-white/95 text-sm"
              value={customerNote}
              onChange={(event) => setCustomerNote(event.target.value.slice(0, 500))}
              placeholder="Example: less spicy, no onion, serve together"
            />
            <p className="mt-1 text-xs text-slate-500">{customerNote.length}/500</p>
          </label>

          <div className="flex gap-2">
            <Button
              className="flex-1"
              size="sm"
              variant="secondary"
              onClick={handleClearCart}
              disabled={createOrderMutation.isPending}
            >
              Clear
            </Button>
            <Button
              className="flex-1"
              size="sm"
              onClick={handleCreateOrder}
              disabled={!selectedTable || createOrderMutation.isPending}
            >
              {createOrderMutation.isPending ? 'Creating...' : 'Create Order'}
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-red-100 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-base font-semibold text-slate-800">Orders</h3>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {qrOrdersPanel || <p className="text-sm text-slate-500"> All orders will appear here.</p>}
          </div>
        </div>
      </section>
    </div>
  )
})

export default ManualOrderPanel
