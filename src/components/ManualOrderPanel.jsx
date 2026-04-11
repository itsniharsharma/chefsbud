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

// Generate unique idempotency key
const generateIdempotencyKey = () => {
  return `manual-order-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

const ManualOrderPanel = memo(function ManualOrderPanel({ restaurantId, restaurantSlug = '', menu = {}, tables = [], onOrderCreated }) {
  const [selectedFloor, setSelectedFloor] = useState('1')
  const [selectedTable, setSelectedTable] = useState('')
  const [cart, setCart] = useState({}) // { itemId: { id, name, price, quantity, portionSize } }
  const [activeCategory, setActiveCategory] = useState('')
  const [menuError, setMenuError] = useState('')
  const queryClient = useQueryClient()

  const createOrderMutation = useMutation({
    mutationFn: async ({ items, tableNumber, floorNumber }) => {
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

  const categoryIndex = useMemo(() => buildCategoryIndex(menu?.items), [menu?.items])

  // Set first category as active on load
  useEffect(() => {
    if (activeCategory || !menuCategories.length) return
    setActiveCategory(menuCategories[0]?._id || '')
  }, [menuCategories.length, activeCategory, menuCategories])

  // Get items for active category
  const categoryItems = useMemo(() => {
    if (!activeCategory) return []
    return categoryIndex.get(String(activeCategory)) || []
  }, [activeCategory, categoryIndex])

  // Get available tables for selected floor
  const availableTables = useMemo(() => {
    if (!tables || !Array.isArray(tables)) return []
    const floor = Number(selectedFloor)
    return tables
      .filter((t) => Number(t?.floorNumber || 1) === floor && t?.active)
      .sort((a, b) => Number(a.tableNumber) - Number(b.tableNumber))
  }, [tables, selectedFloor])

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
    })
  }

  const handleClearCart = () => {
    setCart({})
    setMenuError('')
  }

  const uniqueFloors = useMemo(() => {
    if (!tables || !Array.isArray(tables)) return ['1']
    const floors = new Set(tables.map((t) => String(t?.floorNumber || 1)))
    return Array.from(floors).sort((a, b) => Number(a) - Number(b))
  }, [tables])

  return (
    <div className="flex h-full flex-col overflow-y-scroll rounded-2xl border border-red-200 bg-gradient-to-b from-red-50 to-white p-4 shadow-sm">
      {/* Header */}
      <div className="mb-4 border-b border-red-200 pb-3">
        <h3 className="text-base font-semibold text-slate-900">Manual Order Creation</h3>
        <p className="mt-1 text-xs text-slate-600">Select items, choose table, and create</p>
      </div>

      {/* Error */}
      {menuError && (
        <div className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{menuError}</div>
      )}

      {/* Floor & Table Selection */}
      <div className="mb-4 space-y-2 border-b border-red-200 pb-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-700">
            <span className="font-medium">Floor</span>
            <select
              className="input h-8 text-sm"
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
              className="input h-8 text-sm"
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
      </div>

      {/* Content */}
      {!menu?.categories?.length ? (
        <div className="py-4 text-center text-xs text-slate-500">No menu available</div>
      ) : (
        <>
          {/* Categories Tabs */}
          <div className="mb-3 flex gap-1 overflow-x-auto pb-2">
            {menuCategories.map((category) => (
              <button
                key={category._id}
                onClick={() => setActiveCategory(category._id)}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
                  activeCategory === category._id
                    ? 'bg-red-600 text-white'
                    : 'border border-slate-300 text-slate-700 hover:border-red-400'
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>

          {/* Items Grid */}
          <div className="mb-4 flex-1 space-y-2 overflow-y-auto">
            {categoryItems.length > 0 ? (
              categoryItems.map((item) => (
                <div
                  key={item._id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2 text-xs hover:border-red-400"
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-slate-900">{item.name}</p>
                    <p className="text-slate-600">{formatCurrencyINR(item.price)}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${item.isVeg === false ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                        {getDietLabel(item.isVeg)}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                        {formatPortionSizeLabel(item.portionSize)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleSelectItem(item)}
                    disabled={createOrderMutation.isPending}
                    className="ml-2 rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    +
                  </button>
                </div>
              ))
            ) : (
              <p className="py-4 text-center text-xs text-slate-500">No items in category</p>
            )}
          </div>

          {/* Cart Summary */}
          {Object.keys(cart).length > 0 && (
            <>
              <div className="mb-3 space-y-2 border-t border-red-200 pt-3">
                <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-2">
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

                <div className="rounded-lg bg-red-100 p-2">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium text-slate-700">Items:</span>
                    <span className="font-bold text-slate-900">{cartStats.count}</span>
                  </div>
                  <div className="mt-1 flex justify-between border-t border-red-200 pt-1">
                    <span className="font-bold text-slate-900">Total:</span>
                    <span className="font-bold text-red-700">{formatCurrencyINR(cartStats.total)}</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
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
            </>
          )}
        </>
      )}
    </div>
  )
})

export default ManualOrderPanel
