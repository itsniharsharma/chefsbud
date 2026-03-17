import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import CustomerBottomNav from '../components/CustomerBottomNav'
import Button from '../components/Button'
import { menuService } from '../services/menuService'
import { useCustomerCart } from '../hooks/useCustomerCart'
import { formatCurrencyINR } from '../utils/currency'
import { buildCustomerCheckoutUrl } from '../utils/customerUrl'

export default function CustomerMenuPage() {
  const navigate = useNavigate()
  const { restaurantSlug, tableNumber } = useParams()
  const [searchParams] = useSearchParams()
  const { getSession, addItem, removeItem } = useCustomerCart()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState({ restaurant: null, categories: [], items: [], offers: [] })
  // null = category grid view; a category._id = items view for that category
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
        setActiveCategory(null) // start at grid
      })
      .catch((err) => {
        if (!active) return
        setError(err?.response?.data?.message || 'Unable to load menu')
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })
    return () => { active = false }
  }, [restaurantSlug])

  const availableItems = useMemo(() => menu.items.filter((item) => item.available), [menu.items])

  const itemCountByCategory = useMemo(() => {
    const counts = new Map()
    for (const item of availableItems) {
      counts.set(item.categoryId, (counts.get(item.categoryId) || 0) + 1)
    }
    return counts
  }, [availableItems])

  const visibleItems = useMemo(
    () => (activeCategory ? availableItems.filter((item) => item.categoryId === activeCategory) : []),
    [activeCategory, availableItems],
  )

  const cartQuantityByItemId = useMemo(() => {
    const map = new Map()
    for (const entry of cart) map.set(entry.menuItemId, entry.quantity)
    return map
  }, [cart])

  const total = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart])
  const totalItemCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart])

  const selectedCategoryName = menu.categories.find((c) => c._id === activeCategory)?.name || ''

  const floorNumber = Number(searchParams.get('floor') || 1)

  const openCheckout = () => navigate(buildCustomerCheckoutUrl({ slug: restaurantSlug, tableNumber, floorNumber }))

  if (loading) {
    return <div className="customer-shell-v2 min-h-screen p-4 text-sm text-gray-500">Loading menu…</div>
  }
  if (error) {
    return <div className="customer-shell-v2 min-h-screen p-4 text-sm text-red-500">{error}</div>
  }

  return (
    <div className="customer-shell-v2 pb-32">
      {/* ── Sticky App Bar ── */}
      <header className="customer-appbar sticky top-0 z-30">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {activeCategory && (
                <button
                  onClick={() => setActiveCategory(null)}
                  className="mr-1 flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100"
                  aria-label="Back to categories"
                >
                  ‹
                </button>
              )}
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Your table</p>
                <p className="text-xl font-bold text-gray-900">{menu.restaurant?.name || 'Restaurant'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-gray-600">
              <span className="customer-icon-chip">T{tableNumber}</span>
              <span className="customer-icon-chip">Menu</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-4">
        {/* ── Banner ── */}
        <section className="customer-banner-card mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-200">Now serving</p>
          <h1 className="mt-2 text-2xl font-extrabold leading-tight text-white md:text-3xl">
            {menu.restaurant?.name || 'Restaurant Menu'}
          </h1>
          <p className="mt-1 text-sm text-red-100">Pick a category to explore dishes.</p>
          {Array.isArray(menu.offers) && menu.offers.length ? (
            <p className="mt-3 text-xs font-medium text-red-100">
              {menu.offers.map((o) => o.name).join('  |  ')}
            </p>
          ) : null}
        </section>

        {/* ── CATEGORY GRID (initial view) ── */}
        {!activeCategory && (
          <section className="mt-5">
            <h2 className="mb-3 text-lg font-bold text-gray-900">Categories</h2>
            {!menu.categories.length ? (
              <div className="customer-empty-card">No categories available yet.</div>
            ) : (
              <div className="customer-category-grid">
                {menu.categories.map((category) => {
                  const count = itemCountByCategory.get(category._id) || 0
                  const letter = category.name?.charAt(0)?.toUpperCase() || '?'
                  return (
                    <button
                      key={category._id}
                      onClick={() => setActiveCategory(category._id)}
                      className="customer-category-box"
                    >
                      <div className="customer-category-box-icon">{letter}</div>
                      <p className="mt-2 text-sm font-bold text-gray-900 leading-tight">{category.name}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{count} {count === 1 ? 'item' : 'items'}</p>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {/* ── ITEMS VIEW (after category selected) ── */}
        {activeCategory && (
          <section className="mt-5">
            <div className="mb-3 flex items-center justify-between">
              <Button
                variant="secondary"
                className="border-red-200 text-red-700 hover:border-red-300"
                onClick={() => setActiveCategory(null)}
              >
                Back to Menu
              </Button>
            </div>

            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">{selectedCategoryName}</h2>
              <p className="text-xs text-gray-500">{visibleItems.length} items</p>
            </div>

            {!visibleItems.length ? (
              <div className="customer-empty-card">No available dishes in this category right now.</div>
            ) : (
              <div className="space-y-3">
                {visibleItems.map((item) => {
                  const quantity = cartQuantityByItemId.get(item._id) || 0
                  return (
                    <article key={item._id} className="customer-food-card">
                      <div className="min-w-0 flex-1">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-600">
                          {item.bestseller ? 'Bestseller' : 'Fresh pick'}
                        </p>
                        <h3 className="text-base font-bold text-gray-900">{item.name}</h3>
                        <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                          {item.description || 'Chef special prepared with quality ingredients.'}
                        </p>
                        <p className="mt-2 text-lg font-extrabold text-red-600">{formatCurrencyINR(item.price)}</p>
                      </div>

                      <div className="ml-3 flex flex-col items-end justify-between gap-3">
                        <div className="customer-mini-photo">{item.name?.charAt(0) || 'F'}</div>
                        {quantity > 0 ? (
                          <div className="customer-qty-control">
                            <button onClick={() => removeItem(restaurantSlug, tableNumber, item._id)}>−</button>
                            <span>{quantity}</span>
                            <button onClick={() => addItem(restaurantSlug, tableNumber, item)}>+</button>
                          </div>
                        ) : (
                          <button
                            className="customer-add-btn"
                            onClick={() => addItem(restaurantSlug, tableNumber, item)}
                          >
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
        )}
      </main>

      {/* ── Sticky Cart CTA ── */}
      {totalItemCount > 0 && (
        <div className="pointer-events-none fixed bottom-20 left-0 right-0 z-40 px-4">
          <div className="pointer-events-auto mx-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-gray-500">Cart</p>
              <p className="text-sm font-semibold text-gray-900">{totalItemCount} items</p>
            </div>
            <button className="customer-cta-btn" onClick={openCheckout}>
              View Cart {formatCurrencyINR(total)}
            </button>
          </div>
        </div>
      )}

      <CustomerBottomNav restaurantSlug={restaurantSlug} tableNumber={tableNumber} floorNumber={floorNumber} />
    </div>
  )
}
