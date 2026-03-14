import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
        const firstCategory = data?.categories?.[0]?._id || null
        setActiveCategory(firstCategory)
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
  }, [restaurantSlug])

  const availableItems = useMemo(() => menu.items.filter((item) => item.available), [menu.items])

  const itemCountByCategory = useMemo(() => {
    const counts = new Map()
    for (const item of availableItems) {
      const key = item.categoryId
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return counts
  }, [availableItems])

  const visibleItems = useMemo(() => {
    if (!activeCategory) return []
    return availableItems.filter((item) => item.categoryId === activeCategory)
  }, [activeCategory, availableItems])

  const cartQuantityByItemId = useMemo(() => {
    const quantityMap = new Map()
    for (const entry of cart) {
      quantityMap.set(entry.menuItemId, entry.quantity)
    }
    return quantityMap
  }, [cart])

  const total = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart])
  const totalItemCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart])

  const selectedCategoryName =
    menu.categories.find((category) => category._id === activeCategory)?.name || 'Recommended'

  const openCheckout = () => {
    navigate(buildCustomerCheckoutUrl({ slug: restaurantSlug, tableNumber }))
  }

  if (loading) {
    return <div className="customer-shell-v2 min-h-screen p-4 text-sm text-slate-300">Loading menu...</div>
  }

  if (error) {
    return <div className="customer-shell-v2 min-h-screen p-4 text-sm text-red-300">{error}</div>
  }

  return (
    <div className="customer-shell-v2 pb-32">
      <header className="customer-appbar sticky top-0 z-30">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Your table</p>
              <p className="text-xl font-bold text-white">{menu.restaurant?.name || 'Restaurant'}</p>
            </div>
            <div className="flex items-center gap-2 text-slate-300">
              <span className="customer-icon-chip">T{tableNumber}</span>
              <span className="customer-icon-chip">Menu</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-4">
        <section className="customer-banner-card mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-200">Now serving</p>
          <h1 className="mt-2 text-2xl font-extrabold leading-tight text-white md:text-3xl">
            {menu.restaurant?.name || 'Restaurant Menu'}
          </h1>
          <p className="mt-1 text-sm text-slate-200">Explore categories and order instantly from your table.</p>
          {Array.isArray(menu.offers) && menu.offers.length ? (
            <p className="mt-3 text-xs font-medium text-red-100">{menu.offers.map((offer) => offer.name).join('  |  ')}</p>
          ) : null}
        </section>

        <section className="customer-search mt-4">
          <div className="customer-search-box">
            <span className="text-sm text-slate-500">Search items, dishes, drinks...</span>
          </div>
        </section>

        <section className="mt-4">
          <div className="customer-category-strip">
            {menu.categories.map((category) => {
              const isActive = category._id === activeCategory
              return (
                <button
                  key={category._id}
                  onClick={() => setActiveCategory(category._id)}
                  className={`customer-category-pill ${isActive ? 'active' : ''}`}
                >
                  <span>{category.name}</span>
                  <span className="text-[11px] opacity-80">{itemCountByCategory.get(category._id) || 0}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="mt-5">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-2xl font-bold text-white">{selectedCategoryName}</h2>
            <p className="text-xs text-slate-400">{visibleItems.length} items</p>
          </div>

          {!visibleItems.length ? (
            <div className="customer-empty-card">No available dishes in this category right now.</div>
          ) : (
            <div className="space-y-3">
              {visibleItems.map((item) => {
                const quantity = cartQuantityByItemId.get(item._id) || 0
                return (
                  <article key={item._id} className="customer-food-card">
                    <div className="min-w-0">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-300">
                        {item.bestseller ? 'Bestseller' : 'Fresh pick'}
                      </p>
                      <h3 className="truncate text-xl font-bold text-white">{item.name}</h3>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-300">
                        {item.description || 'Chef special prepared with quality ingredients.'}
                      </p>
                      <p className="mt-2 text-2xl font-extrabold text-red-400">{formatCurrencyINR(item.price)}</p>
                    </div>

                    <div className="ml-3 flex flex-col items-end justify-between gap-3">
                      <div className="customer-mini-photo">{item.name?.charAt(0) || 'F'}</div>
                      {quantity > 0 ? (
                        <div className="customer-qty-control">
                          <button onClick={() => removeItem(restaurantSlug, tableNumber, item._id)}>-</button>
                          <span>{quantity}</span>
                          <button onClick={() => addItem(restaurantSlug, tableNumber, item)}>+</button>
                        </div>
                      ) : (
                        <button className="customer-add-btn" onClick={() => addItem(restaurantSlug, tableNumber, item)}>
                          ADD
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </main>

      {totalItemCount > 0 ? (
        <div className="customer-cart-cta fixed bottom-20 left-0 right-0 z-40 px-4">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-2xl border border-red-400/45 bg-black/95 px-4 py-3 shadow-[0_16px_30px_rgba(0,0,0,0.45)]">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-slate-300">Cart</p>
              <p className="text-sm font-semibold text-white">{totalItemCount} items</p>
            </div>
            <button className="customer-cta-btn" onClick={openCheckout}>
              View Cart {formatCurrencyINR(total)}
            </button>
          </div>
        </div>
      ) : null}

      <CustomerBottomNav restaurantSlug={restaurantSlug} tableNumber={tableNumber} />
    </div>
  )
}
