import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Button from '../components/Button'
import CustomerBottomNav from '../components/CustomerBottomNav'
import { menuService } from '../services/menuService'
import { useCustomerCart } from '../hooks/useCustomerCart'
import { formatCurrencyINR } from '../utils/currency'
import { buildCustomerCheckoutUrl } from '../utils/customerUrl'

export default function CustomerMenuPage() {
  const navigate = useNavigate()
  const { restaurantSlug, tableNumber } = useParams()
  const { getSession, addItem, removeItem } = useCustomerCart()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState({ restaurant: null, categories: [], items: [], offers: [] })
  const [activeCategory, setActiveCategory] = useState(null)

  const session = getSession(restaurantSlug, tableNumber)
  const cart = session.items

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')

    menuService
      .getBySlug(restaurantSlug)
      .then((data) => {
        if (!active) return
        setMenu(data)
        setActiveCategory(null)
        setError('')
      })
      .catch((requestError) => {
        if (!active) return
        setError(requestError?.response?.data?.message || 'Unable to load menu')
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [restaurantSlug, tableNumber])

  const visibleItems = useMemo(() => {
    if (!activeCategory) return []
    return menu.items.filter((item) => item.available && item.categoryId === activeCategory)
  }, [activeCategory, menu.items])

  const itemCountByCategory = useMemo(() => {
    const counts = new Map()
    for (const item of menu.items) {
      if (!item.available) continue
      const key = item.categoryId
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return counts
  }, [menu.items])

  const cartQuantityByItemId = useMemo(() => {
    const quantityMap = new Map()
    for (const entry of cart) {
      quantityMap.set(entry.menuItemId, entry.quantity)
    }
    return quantityMap
  }, [cart])

  const openCheckout = () => {
    navigate(buildCustomerCheckoutUrl({ slug: restaurantSlug, tableNumber }))
  }

  const total = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart])

  const totalItemCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart])

  if (loading) {
    return <div className="min-h-screen p-4 text-sm royal-muted customer-shell">Loading royal dining menu...</div>
  }

  if (error) {
    return <div className="min-h-screen p-4 text-sm text-amber-200 customer-shell">{error}</div>
  }

  return (
    <div className="customer-shell pb-32">
      <header className="sticky top-0 z-20 border-b border-amber-200/20 bg-[#09112a]/80 p-4 backdrop-blur">
        <div className="customer-hero royal-reveal p-4 md:p-5">
          <p className="customer-page-title text-xs font-semibold uppercase">Chef's Bud Royal Lounge</p>
          <h1 className="mt-1 text-2xl font-bold text-amber-50 md:text-3xl">Welcome to {menu.restaurant?.name}</h1>
          <p className="mt-1 text-sm royal-muted">Table {tableNumber} • Signature dining, elegantly delivered</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="royal-surface rounded-lg px-2 py-2">
              <p className="font-bold royal-highlight">{menu.categories.length}</p>
              <p className="royal-muted">Categories</p>
            </div>
            <div className="royal-surface rounded-lg px-2 py-2">
              <p className="font-bold royal-highlight">{menu.items.length}</p>
              <p className="royal-muted">Dishes</p>
            </div>
            <div className="royal-surface rounded-lg px-2 py-2">
              <p className="font-bold royal-highlight">{totalItemCount}</p>
              <p className="royal-muted">In Cart</p>
            </div>
          </div>
        </div>
      </header>

      <div className="p-4">
        {menu.offers?.length > 0 && (
          <div className="customer-glass royal-reveal royal-reveal-delay-1 mb-4 rounded-xl p-3 text-sm royal-highlight shadow-sm">
            {menu.offers.map((offer) => `✨ ${offer.name}`).join('   •   ')}
          </div>
        )}

        {!activeCategory ? (
          <div>
            <h2 className="mb-3 text-lg font-semibold text-amber-50">Explore Signature Categories</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {menu.categories.map((category) => (
                <button
                  key={category._id}
                  onClick={() => setActiveCategory(category._id)}
                  className="lux-card royal-reveal royal-reveal-delay-1 min-h-32 overflow-hidden px-3 py-4 text-center text-base font-semibold text-amber-50 transition hover:-translate-y-1 hover:border-amber-300"
                >
                  <div className="mb-2 rounded-lg border border-amber-200/30 bg-gradient-to-br from-amber-200/20 to-transparent p-2 text-2xl">🍽️</div>
                  <p>{category.name}</p>
                  <p className="mt-1 text-xs royal-muted">{itemCountByCategory.get(category._id) || 0} dishes</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <Button variant="secondary" className="royal-button-secondary" onClick={() => setActiveCategory(null)}>
                ← Back to Categories
              </Button>
              <p className="text-sm font-medium royal-muted">Chef Selection</p>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {visibleItems.map((item) => {
                const quantity = cartQuantityByItemId.get(item._id) || 0
                return (
                  <div key={item._id} className="lux-card royal-reveal royal-reveal-delay-2 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-amber-200/35 bg-gradient-to-br from-amber-100/25 to-transparent text-sm font-bold royal-highlight">
                          {item.name?.charAt(0) || 'D'}
                        </div>
                        <div>
                          <h3 className="text-base font-semibold text-amber-50">{item.name}</h3>
                        <p className="text-sm royal-muted">{item.description || 'A signature dish from our kitchen.'}</p>
                        </div>
                      </div>
                      <p className="dish-badge rounded-full px-3 py-1 text-sm font-bold">
                        {formatCurrencyINR(item.price)}
                      </p>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs font-medium royal-muted">
                        {item.bestseller ? '⭐ Bestseller' : 'Popular in this section'}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          className="h-8 w-8 rounded-lg border border-amber-200/35 text-amber-50"
                          onClick={() => removeItem(restaurantSlug, tableNumber, item._id)}
                        >
                          -
                        </button>
                        <span className="min-w-6 text-center text-sm font-semibold text-amber-50">{quantity}</span>
                        <button
                          className="h-8 w-8 rounded-lg border border-amber-300/70 bg-amber-200 text-[#2d1b00]"
                          onClick={() => addItem(restaurantSlug, tableNumber, item)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {cart.length > 0 && (
        <div className="customer-floating-cta fixed bottom-20 left-0 right-0 z-30 p-4">
          <Button className="royal-button-primary w-full" onClick={openCheckout}>
            View Cart • {formatCurrencyINR(total)}
          </Button>
        </div>
      )}

      <CustomerBottomNav restaurantSlug={restaurantSlug} tableNumber={tableNumber} />
    </div>
  )
}
