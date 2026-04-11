import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import CustomerBottomNav from '../components/CustomerBottomNav'
import Button from '../components/Button'
import { menuService } from '../services/menuService'
import { trackAddToCartReliable, trackMenuExposureReliable } from '../services/analyticsCaptureService'
import { getCustomerMenuSocket } from '../services/customerMenuSocketService'
import { useCustomerCart } from '../hooks/useCustomerCart'
import { formatCurrencyINR } from '../utils/currency'
import { createCustomerAnalyticsEventId, getCustomerAnalyticsSessionId } from '../utils/customerAnalytics'
import { buildCustomerCheckoutUrl } from '../utils/customerUrl'

function normalizePortionSize(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'small' || normalized === 'regular' || normalized === 'medium' || normalized === 'large' || normalized === 'xlarge') {
    return normalized
  }
  return 'medium'
}

function formatPortionSizeLabel(value) {
  const normalized = normalizePortionSize(value)
  if (normalized === 'small') return 'Small'
  if (normalized === 'regular') return 'Regular'
  if (normalized === 'medium') return 'Medium'
  if (normalized === 'large') return 'Large'
  if (normalized === 'xlarge') return 'XLarge'
  return 'Medium'
}

function getMenuFilterKey(dietFilter, sizeFilter) {
  return `${String(dietFilter || 'all').trim().toLowerCase()}|${String(sizeFilter || 'all').trim().toLowerCase()}`
}

function buildCustomerMenuIndexes(items = []) {
  const categoryItems = new Map()
  const categoryCounts = new Map()
  const filteredItems = new Map()
  const filteredCounts = new Map()
  const categoryFilteredItems = new Map()
  const categoryFilteredCounts = new Map()
  const filterCombos = [
    ['all', 'all'],
    ['veg', 'all'],
    ['nonveg', 'all'],
    ['all', 'small'],
    ['all', 'regular'],
    ['all', 'medium'],
    ['all', 'large'],
    ['all', 'xlarge'],
    ['veg', 'small'],
    ['veg', 'regular'],
    ['veg', 'medium'],
    ['veg', 'large'],
    ['veg', 'xlarge'],
    ['nonveg', 'small'],
    ['nonveg', 'regular'],
    ['nonveg', 'medium'],
    ['nonveg', 'large'],
    ['nonveg', 'xlarge'],
  ]

  for (const [dietFilter, sizeFilter] of filterCombos) {
    const key = getMenuFilterKey(dietFilter, sizeFilter)
    filteredItems.set(key, [])
    filteredCounts.set(key, new Map())
  }

  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.available) continue

    const categoryId = String(item?.categoryId || '')
    if (!categoryId) continue

    const normalizedSize = normalizePortionSize(item?.portionSize)
    const isVeg = item?.isVeg !== false
    const dietKey = isVeg ? 'veg' : 'nonveg'
    const sizeKey = normalizedSize

    const baseCategoryList = categoryItems.get(categoryId) || []
    baseCategoryList.push(item)
    categoryItems.set(categoryId, baseCategoryList)
    categoryCounts.set(categoryId, (categoryCounts.get(categoryId) || 0) + 1)

    if (!categoryFilteredItems.has(categoryId)) {
      categoryFilteredItems.set(categoryId, new Map())
      categoryFilteredCounts.set(categoryId, new Map())
      for (const [dietFilter, sizeFilter] of filterCombos) {
        const filterKey = getMenuFilterKey(dietFilter, sizeFilter)
        categoryFilteredItems.get(categoryId).set(filterKey, [])
        categoryFilteredCounts.get(categoryId).set(filterKey, 0)
      }
    }

    const matchingFilterKeys = [
      getMenuFilterKey('all', 'all'),
      getMenuFilterKey(dietKey, 'all'),
      getMenuFilterKey('all', sizeKey),
      getMenuFilterKey(dietKey, sizeKey),
    ]

    for (const filterKey of matchingFilterKeys) {
      const list = filteredItems.get(filterKey)
      list.push(item)

      const countMap = filteredCounts.get(filterKey)
      countMap.set(categoryId, (countMap.get(categoryId) || 0) + 1)
    }

    for (const [dietFilter, sizeFilter] of filterCombos) {
      const filterKey = getMenuFilterKey(dietFilter, sizeFilter)
      const list = categoryFilteredItems.get(categoryId).get(filterKey)
      const countMap = categoryFilteredCounts.get(categoryId)

      const dietMatches = dietFilter === 'all' || (dietFilter === 'veg' ? isVeg : !isVeg)
      const sizeMatches = sizeFilter === 'all' || sizeFilter === sizeKey
      if (!dietMatches || !sizeMatches) continue

      list.push(item)
      countMap.set(filterKey, (countMap.get(filterKey) || 0) + 1)
    }
  }

  return {
    categoryItems,
    categoryCounts,
    filteredItems,
    filteredCounts,
    categoryFilteredItems,
    categoryFilteredCounts,
  }
}

function hydrateMenuIndexes(menu = {}) {
  if (menu?.indexes && typeof menu.indexes === 'object') {
    const categoryItems = new Map(Object.entries(menu.indexes.categoryItems || {}))
    const categoryCounts = new Map(Object.entries(menu.indexes.categoryCounts || {}))
    const categoryFilteredItems = new Map(
      Object.entries(menu.indexes.categoryItemsByFilter || {}).map(([filterKey, categoryBuckets]) => [
        filterKey,
        new Map(Object.entries(categoryBuckets || {})),
      ]),
    )
    const categoryFilteredCounts = new Map(
      Object.entries(menu.indexes.categoryCountsByFilter || {}).map(([filterKey, categoryCountsByFilter]) => [
        filterKey,
        new Map(Object.entries(categoryCountsByFilter || {})),
      ]),
    )

    return {
      categoryItems,
      categoryCounts,
      filteredItems: new Map(),
      filteredCounts: new Map(),
      categoryFilteredItems,
      categoryFilteredCounts,
    }
  }

  return buildCustomerMenuIndexes(menu.items)
}

export default function CustomerMenuPage() {
  const navigate = useNavigate()
  const { restaurantSlug, tableNumber } = useParams()
  const [searchParams] = useSearchParams()
  const { getSession, addItem, removeItem } = useCustomerCart()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState({ restaurant: null, categories: [], items: [], offers: [] })
  const [dietFilter, setDietFilter] = useState('all')
  const [sizeFilter, setSizeFilter] = useState('all')
  // null = category grid view; a category._id = items view for that category
  const [activeCategory, setActiveCategory] = useState(null)
  const isMountedRef = useRef(true)
  const lastMenuRefreshRef = useRef(0)
  const refreshTimerRef = useRef(null)
  const disconnectTimerRef = useRef(null)
  const impressionObserverRef = useRef(null)
  const itemsContainerRef = useRef(null)
  const flushImpressionTimerRef = useRef(null)
  const pendingImpressionItemIdsRef = useRef(new Set())
  const trackedImpressionItemIdsRef = useRef(new Set())
  const trackedImpressionDayRef = useRef('')

  const session = getSession(restaurantSlug, tableNumber)
  const cart = session.items
  const menuIndexes = useMemo(() => hydrateMenuIndexes(menu), [menu])

  const fetchMenu = useCallback(async ({ showLoader = false } = {}) => {
    if (!restaurantSlug) return

    if (showLoader) {
      setLoading(true)
    }

    setError('')

    try {
      const data = await menuService.getBySlug(restaurantSlug)
      if (!isMountedRef.current) return
      setMenu(data)
      if (showLoader) {
        setActiveCategory(null)
      }
    } catch (err) {
      if (!isMountedRef.current) return
      setError(err?.response?.data?.message || 'Unable to load menu')
    } finally {
      if (showLoader && isMountedRef.current) {
        setLoading(false)
      }
    }
  }, [restaurantSlug])

  const scheduleMenuRefresh = useCallback(() => {
    const now = Date.now()
    if (now - lastMenuRefreshRef.current < 1_000) {
      return
    }

    lastMenuRefreshRef.current = now
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
    }

    refreshTimerRef.current = setTimeout(() => {
      void fetchMenu({ showLoader: false })
    }, 200)
  }, [fetchMenu])

  useEffect(() => {
    isMountedRef.current = true
    void fetchMenu({ showLoader: true })

    return () => {
      isMountedRef.current = false
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }
    }
  }, [fetchMenu])

  useEffect(() => {
    if (!restaurantSlug) return undefined

    const socket = getCustomerMenuSocket()
    const roomPayload = { restaurantSlug: String(restaurantSlug).trim().toLowerCase() }

    const clearDisconnectTimer = () => {
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current)
        disconnectTimerRef.current = null
      }
    }

    const onConnected = () => {
      socket.emit('menu:join-restaurant', roomPayload)
    }

    const onMenuItemCreated = (payload = {}) => {
      const item = payload?.item
      if (!item?._id) {
        scheduleMenuRefresh()
        return
      }

      setMenu((current) => {
        const items = Array.isArray(current?.items) ? current.items : []
        const exists = items.some((entry) => String(entry?._id || '') === String(item._id))
        if (exists) {
          return current
        }

        return {
          ...current,
          items: [item, ...items],
        }
      })
    }

    const onMenuItemUpdated = (payload = {}) => {
      const itemId = String(payload?.itemId || '').trim()
      const patch = payload?.patch && typeof payload.patch === 'object' ? payload.patch : null
      if (!itemId || !patch) {
        scheduleMenuRefresh()
        return
      }

      setMenu((current) => {
        const items = Array.isArray(current?.items) ? current.items : []
        let changed = false
        const nextItems = items.map((entry) => {
          if (String(entry?._id || '') !== itemId) {
            return entry
          }

          changed = true
          return {
            ...entry,
            ...patch,
          }
        })

        if (!changed) {
          scheduleMenuRefresh()
          return current
        }

        return {
          ...current,
          items: nextItems,
        }
      })
    }

    const onMenuItemDeleted = (payload = {}) => {
      const itemId = String(payload?.itemId || '').trim()
      if (!itemId) {
        scheduleMenuRefresh()
        return
      }

      setMenu((current) => {
        const items = Array.isArray(current?.items) ? current.items : []
        const nextItems = items.filter((entry) => String(entry?._id || '') !== itemId)
        if (nextItems.length === items.length) {
          scheduleMenuRefresh()
          return current
        }

        return {
          ...current,
          items: nextItems,
        }
      })
    }

    const onMenuRefreshRequired = () => {
      scheduleMenuRefresh()
    }

    socket.on('connect', onConnected)
    socket.on('menu:item-created', onMenuItemCreated)
    socket.on('menu:item-updated', onMenuItemUpdated)
    socket.on('menu:item-deleted', onMenuItemDeleted)
    socket.on('menu:refresh-required', onMenuRefreshRequired)

    const connectForLiveUpdates = () => {
      clearDisconnectTimer()
      if (!navigator.onLine) return
      if (!socket.connected) {
        socket.connect()
      } else {
        onConnected()
      }
    }

    const disconnectToSaveCost = () => {
      clearDisconnectTimer()
      // Short grace window avoids churn during rapid tab switching.
      disconnectTimerRef.current = setTimeout(() => {
        socket.emit('menu:leave-restaurant', roomPayload)
        socket.disconnect()
      }, 12_000)
    }

    const onVisibilityChanged = () => {
      if (document.visibilityState === 'visible') {
        connectForLiveUpdates()
      } else {
        disconnectToSaveCost()
      }
    }

    const onWindowOnline = () => {
      if (document.visibilityState === 'visible') {
        connectForLiveUpdates()
      }
    }

    const onWindowOffline = () => {
      disconnectToSaveCost()
    }

    document.addEventListener('visibilitychange', onVisibilityChanged)
    window.addEventListener('online', onWindowOnline)
    window.addEventListener('offline', onWindowOffline)

    if (document.visibilityState === 'visible') {
      connectForLiveUpdates()
    }

    return () => {
      clearDisconnectTimer()
      socket.emit('menu:leave-restaurant', roomPayload)
      socket.off('connect', onConnected)
      socket.off('menu:item-created', onMenuItemCreated)
      socket.off('menu:item-updated', onMenuItemUpdated)
      socket.off('menu:item-deleted', onMenuItemDeleted)
      socket.off('menu:refresh-required', onMenuRefreshRequired)
      document.removeEventListener('visibilitychange', onVisibilityChanged)
      window.removeEventListener('online', onWindowOnline)
      window.removeEventListener('offline', onWindowOffline)
      socket.disconnect()
    }
  }, [restaurantSlug, scheduleMenuRefresh])

  const currentFilterKey = useMemo(() => getMenuFilterKey(dietFilter, sizeFilter), [dietFilter, sizeFilter])

  const itemCountByCategory = useMemo(() => {
    const counts = menuIndexes.categoryFilteredCounts.get(currentFilterKey)
    return counts || new Map()
  }, [menuIndexes.categoryFilteredCounts, currentFilterKey])

  const visibleCategories = useMemo(() => {
    return menu.categories.filter((category) => (itemCountByCategory.get(category._id) || 0) > 0)
  }, [menu.categories, itemCountByCategory])

  const visibleItems = useMemo(() => {
    if (!activeCategory) return []
    return menuIndexes.categoryFilteredItems.get(currentFilterKey)?.get(activeCategory) || []
  }, [activeCategory, currentFilterKey, menuIndexes.categoryFilteredItems])

  const cartQuantityByItemId = useMemo(() => {
    const map = new Map()
    for (const entry of cart) map.set(entry.menuItemId, entry.quantity)
    return map
  }, [cart])

  const total = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart])
  const totalItemCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart])

  const selectedCategoryName = menu.categories.find((c) => c._id === activeCategory)?.name || ''

  const floorNumber = Number(searchParams.get('floor') || 1)
  const analyticsSessionId = useMemo(
    () => getCustomerAnalyticsSessionId({ restaurantSlug, tableNumber }),
    [restaurantSlug, tableNumber],
  )

  const flushImpressions = useCallback(() => {
    if (!restaurantSlug || !analyticsSessionId) return

    const currentDateKey = new Date().toISOString().slice(0, 10)

    if (trackedImpressionDayRef.current !== currentDateKey) {
      trackedImpressionItemIdsRef.current.clear()
      trackedImpressionDayRef.current = currentDateKey
    }

    const itemIds = [...pendingImpressionItemIdsRef.current]
    pendingImpressionItemIdsRef.current.clear()
    if (!itemIds.length) return

    const nextItemIds = itemIds.filter((itemId) => {
      const normalizedItemId = String(itemId || '').trim()
      if (!normalizedItemId) return false
      if (trackedImpressionItemIdsRef.current.has(normalizedItemId)) {
        return false
      }
      trackedImpressionItemIdsRef.current.add(normalizedItemId)
      return true
    })

    if (!nextItemIds.length) return

    trackMenuExposureReliable({
      restaurantSlug,
      sessionId: analyticsSessionId,
      eventId: createCustomerAnalyticsEventId({
        prefix: 'menu-view',
        restaurantSlug,
        tableNumber,
      }),
      menuItemIds: nextItemIds,
    })
  }, [analyticsSessionId, restaurantSlug, tableNumber])

  const scheduleImpressionFlush = useCallback(() => {
    if (flushImpressionTimerRef.current) {
      clearTimeout(flushImpressionTimerRef.current)
    }

    flushImpressionTimerRef.current = setTimeout(() => {
      flushImpressionTimerRef.current = null
      flushImpressions()
    }, 400)
  }, [flushImpressions])

  useEffect(() => {
    if (!activeCategory) {
      if (impressionObserverRef.current) {
        impressionObserverRef.current.disconnect()
        impressionObserverRef.current = null
      }
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.6) {
            return
          }

          const itemId = String(entry.target?.getAttribute('data-analytics-item-id') || '').trim()
          if (!itemId) return

          pendingImpressionItemIdsRef.current.add(itemId)
          observer.unobserve(entry.target)
          scheduleImpressionFlush()
        })
      },
      {
        threshold: [0.6],
      },
    )

    impressionObserverRef.current = observer
    return () => {
      observer.disconnect()
      if (impressionObserverRef.current === observer) {
        impressionObserverRef.current = null
      }
    }
  }, [activeCategory, scheduleImpressionFlush])

  useEffect(() => {
    if (!activeCategory || !impressionObserverRef.current) return

    const observer = impressionObserverRef.current
    const nodes = Array.from((itemsContainerRef.current || document).querySelectorAll('[data-analytics-item-id]'))
    nodes.forEach((node) => observer.observe(node))
  }, [activeCategory, visibleItems])

  useEffect(() => {
    const onVisibilityChanged = () => {
      if (document.visibilityState === 'hidden') {
        flushImpressions()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChanged)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChanged)
      flushImpressions()
      if (flushImpressionTimerRef.current) {
        clearTimeout(flushImpressionTimerRef.current)
      }
    }
  }, [flushImpressions])

  const trackAddToCart = (item) => {
    addItem(restaurantSlug, tableNumber, item)
    trackAddToCartReliable({
      restaurantSlug,
      eventId: createCustomerAnalyticsEventId({
        prefix: 'add-to-cart',
        restaurantSlug,
        tableNumber,
        menuItemId: item._id,
      }),
      menuItemId: item._id,
      quantity: 1,
    })
  }

  const openCheckout = () => navigate(buildCustomerCheckoutUrl({ slug: restaurantSlug, tableNumber, floorNumber }))
  const dietFilterLabel = dietFilter === 'veg' ? 'Veg' : dietFilter === 'nonveg' ? 'Non-Veg' : 'All'
  const sizeFilterLabelExtended =
    sizeFilter === 'small'
      ? 'Small'
      : sizeFilter === 'regular'
        ? 'Regular'
        : sizeFilter === 'medium'
          ? 'Medium'
          : sizeFilter === 'large'
            ? 'Large'
            : sizeFilter === 'xlarge'
              ? 'XLarge'
              : 'All'

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
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-gray-900">Categories</h2>
              <div className="customer-diet-toggle" role="tablist" aria-label="Diet filter">
                <button type="button" className={dietFilter === 'all' ? 'active' : ''} onClick={() => setDietFilter('all')}>
                  All
                </button>
                <button type="button" className={dietFilter === 'veg' ? 'active' : ''} onClick={() => setDietFilter('veg')}>
                  Veg
                </button>
                <button type="button" className={dietFilter === 'nonveg' ? 'active' : ''} onClick={() => setDietFilter('nonveg')}>
                  NonVeg
                </button>
              </div>
            </div>
            <div className="mb-3">
              <div className="customer-diet-toggle" role="tablist" aria-label="Portion size filter">
                <button type="button" className={sizeFilter === 'all' ? 'active' : ''} onClick={() => setSizeFilter('all')}>
                  All Sizes
                </button>
                <button type="button" className={sizeFilter === 'small' ? 'active' : ''} onClick={() => setSizeFilter('small')}>
                  Small
                </button>
                <button type="button" className={sizeFilter === 'regular' ? 'active' : ''} onClick={() => setSizeFilter('regular')}>
                  Regular
                </button>
                <button type="button" className={sizeFilter === 'medium' ? 'active' : ''} onClick={() => setSizeFilter('medium')}>
                  Medium
                </button>
                <button type="button" className={sizeFilter === 'large' ? 'active' : ''} onClick={() => setSizeFilter('large')}>
                  Large
                </button>
                <button type="button" className={sizeFilter === 'xlarge' ? 'active' : ''} onClick={() => setSizeFilter('xlarge')}>
                  XLarge
                </button>
              </div>
            </div>
            {!visibleCategories.length ? (
              <div className="customer-empty-card">No categories available yet.</div>
            ) : (
              <div className="customer-category-grid">
                {visibleCategories.map((category) => {
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

            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-2xl font-bold text-gray-900">{selectedCategoryName}</h2>
              <div className="flex items-center gap-3">
                <p className="text-xs text-gray-500">{dietFilterLabel} • {sizeFilterLabelExtended}: {visibleItems.length} items</p>
                <div className="customer-diet-toggle" role="tablist" aria-label="Diet filter">
                  <button type="button" className={dietFilter === 'all' ? 'active' : ''} onClick={() => setDietFilter('all')}>
                    All
                  </button>
                  <button type="button" className={dietFilter === 'veg' ? 'active' : ''} onClick={() => setDietFilter('veg')}>
                    Veg
                  </button>
                  <button type="button" className={dietFilter === 'nonveg' ? 'active' : ''} onClick={() => setDietFilter('nonveg')}>
                    NonVeg
                  </button>
                </div>
              </div>
            </div>
            <div className="mb-3">
              <div className="customer-diet-toggle" role="tablist" aria-label="Portion size filter">
                <button type="button" className={sizeFilter === 'all' ? 'active' : ''} onClick={() => setSizeFilter('all')}>
                  All Sizes
                </button>
                <button type="button" className={sizeFilter === 'small' ? 'active' : ''} onClick={() => setSizeFilter('small')}>
                  Small
                </button>
                <button type="button" className={sizeFilter === 'regular' ? 'active' : ''} onClick={() => setSizeFilter('regular')}>
                  Regular
                </button>
                <button type="button" className={sizeFilter === 'medium' ? 'active' : ''} onClick={() => setSizeFilter('medium')}>
                  Medium
                </button>
                <button type="button" className={sizeFilter === 'large' ? 'active' : ''} onClick={() => setSizeFilter('large')}>
                  Large
                </button>
                <button type="button" className={sizeFilter === 'xlarge' ? 'active' : ''} onClick={() => setSizeFilter('xlarge')}>
                  XLarge
                </button>
              </div>
            </div>

            {!visibleItems.length ? (
              <div className="customer-empty-card">No available dishes in this category right now.</div>
            ) : (
              <div ref={itemsContainerRef} className="space-y-3">
                {visibleItems.map((item) => {
                  const quantity = cartQuantityByItemId.get(item._id) || 0
                  const isVeg = item.isVeg !== false
                  return (
                    <article key={item._id} data-analytics-item-id={item._id} className="customer-food-card">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-red-600">
                            {item.bestseller ? 'Bestseller' : 'Fresh pick'}
                          </p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              isVeg ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {isVeg ? 'Veg' : 'Non-Veg'}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                            {formatPortionSizeLabel(item.portionSize)}
                          </span>
                        </div>
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
                            <button onClick={() => trackAddToCart(item)}>+</button>
                          </div>
                        ) : (
                          <button
                            className="customer-add-btn"
                            onClick={() => trackAddToCart(item)}
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
