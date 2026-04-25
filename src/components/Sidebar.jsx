import { AnimatePresence } from 'framer-motion'
import { ArrowRight, ChartColumnBig, ChevronDown, Clock3, Layers3, LayoutDashboard, Settings2, ShoppingCart, Sparkles, Table2, UtensilsCrossed, Warehouse } from 'lucide-react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useMenuQuery } from '../hooks/useDashboardQueries'
import { preloadRouteByPath } from '../utils/routePreload'

const logisticsCards = [
  {
    label: 'Dashboard',
    to: '/dashboard',
    roles: ['owner', 'staff'],
    end: true,
    description: 'Daily pulse, revenue, and workspace summary',
    icon: LayoutDashboard,
  },
  {
    label: 'Orders',
    to: '/dashboard/orders',
    roles: ['owner', 'staff'],
    description: 'Live order board and kitchen coordination',
    icon: ShoppingCart,
  },
  {
    label: 'Menu',
    to: '/dashboard/menu',
    roles: ['owner', 'staff'],
    description: 'Menu categories, pricing, and item control',
    icon: UtensilsCrossed,
  },
  {
    label: 'Inventory',
    to: '/inventory',
    roles: ['owner', 'staff'],
    description: 'Stock, recipes, procurement, and wastage',
    icon: Warehouse,
  },
  {
    label: 'Tables',
    to: '/dashboard/tables',
    roles: ['owner'],
    description: 'Floor map and table allocation tools',
    icon: Table2,
  },
  {
    label: 'Offers (Dev)',
    to: '/dashboard/offers',
    roles: ['owner', 'staff'],
    description: 'Promo experiments and campaign controls',
    icon: Sparkles,
  },
  {
    label: 'Analytics',
    to: '/dashboard/analytics',
    roles: ['owner'],
    description: 'Revenue, conversion, and decision intelligence',
    icon: ChartColumnBig,
  },
  {
    label: 'Recent Orders',
    to: '/dashboard/recent-orders',
    roles: ['owner', 'staff'],
    description: 'Completed orders and billing history',
    icon: Clock3,
  },
  {
    label: 'Settings',
    to: '/dashboard/settings',
    roles: ['owner'],
    description: 'Restaurant, staff, and billing settings',
    icon: Settings2,
  },
]

export default function Sidebar({ isOpen, onClose }) {
  const { logout, user, restaurant } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [logisticsOpen, setLogisticsOpen] = useState(false)
  const role = user?.role || 'owner'
  const inventoryEnabled = restaurant?.featureConfig?.inventoryEnabled !== false
  const analyticsEnabled = restaurant?.featureConfig?.analyticsEnabled !== false
  const activeCategoryId = useMemo(() => {
    const search = new URLSearchParams(location.search || '')
    return String(search.get('category') || '').trim()
  }, [location.search])
  const { data: menuData } = useMenuQuery({
    restaurantId: restaurant?._id,
  })
  const menuCategories = useMemo(() => {
    const categories = Array.isArray(menuData?.categories) ? menuData.categories : []
    const categoryCountMap = new Map()

    const rawCategoryCounts = menuData?.indexes?.categoryCounts
    if (rawCategoryCounts && typeof rawCategoryCounts === 'object') {
      for (const [categoryId, count] of Object.entries(rawCategoryCounts)) {
        categoryCountMap.set(String(categoryId || ''), Number(count || 0))
      }
    }

    const rawCategoryItems = menuData?.indexes?.categoryItems
    if (rawCategoryItems && typeof rawCategoryItems === 'object') {
      for (const [categoryId, items] of Object.entries(rawCategoryItems)) {
        if (!categoryCountMap.has(String(categoryId || ''))) {
          categoryCountMap.set(String(categoryId || ''), Array.isArray(items) ? items.length : 0)
        }
      }
    }

    return categories
      .filter((category) => Boolean(category?.name && category?._id))
      .map((category) => ({
        ...category,
        itemCount: Number(categoryCountMap.get(String(category._id || '')) || 0),
      }))
  }, [menuData])
  const visibleLinks = useMemo(
    () =>
      logisticsCards.filter((link) => {
        if (!link.roles.includes(role)) return false
        if (!inventoryEnabled && link.to.startsWith('/inventory')) return false
        if (!analyticsEnabled && link.to.startsWith('/dashboard/analytics')) return false
        return true
      }),
    [role, inventoryEnabled, analyticsEnabled],
  )

  const onSelectMenuCategory = (categoryId) => {
    const normalizedCategoryId = String(categoryId || '').trim()
    if (!normalizedCategoryId) return

    const nextParams = new URLSearchParams(location.search || '')
    nextParams.set('category', normalizedCategoryId)

    navigate(`/dashboard/orders?${nextParams.toString()}`)
    onClose?.()
  }

  const onLogout = () => {
    logout()
    navigate('/', { replace: true })
    onClose?.()
  }

  return (
    <>
      {isOpen && <button className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={onClose} />}
      <aside
        className={`owner-sidebar fixed left-0 top-0 z-40 h-screen w-[82vw] max-w-xs overflow-y-auto border-r border-red-100 p-4 transition-transform md:w-[20rem] md:max-w-[20rem] md:p-5 md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="owner-header-panel mb-4 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--primary)]">Executive Suite</p>
          <p className="mt-1 text-2xl font-extrabold text-[var(--primary)]">Chef's Bud</p>
          <p className="mt-1 text-xs text-slate-500">Luxury Restaurant Intelligence</p>
        </div>

        <button className="mb-4 text-sm text-slate-600 md:hidden" onClick={onClose}>
          Close
        </button>

        <button
          type="button"
          onClick={() => setLogisticsOpen((value) => !value)}
          className="mb-3 flex w-full items-center justify-between rounded-2xl border border-red-100 bg-white/95 px-4 py-3 text-left shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition hover:border-red-200 hover:shadow-[0_14px_30px_rgba(15,23,42,0.08)]"
        >
          <span className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-dark)] text-white shadow-[0_12px_24px_rgba(229,9,20,0.24)]">
              <Layers3 size={18} strokeWidth={2.3} />
            </span>
            <span>
              <span className="block text-sm font-extrabold text-slate-900">Logistics</span>
              <span className="block text-xs text-slate-500">Workspace categories</span>
            </span>
          </span>
          <ChevronDown
            size={18}
            className={`shrink-0 text-slate-500 transition-transform duration-200 ${logisticsOpen ? 'rotate-180' : ''}`}
          />
        </button>

        <AnimatePresence initial={false}>
          {logisticsOpen ? (
            <div className="overflow-hidden">
              <div className="mb-3 rounded-2xl border border-rose-100 bg-gradient-to-br from-white to-rose-50/60 p-3 shadow-[0_12px_26px_rgba(15,23,42,0.06)]">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[var(--primary)]">Quick Access</p>
                <p className="mt-1 text-xs text-slate-500">Tap a card to open that workspace section.</p>
              </div>

              <div className="space-y-2">
                {visibleLinks.map((link) => {
                  const Icon = link.icon

                  return (
                    <NavLink
                      key={link.to}
                      to={link.to}
                      end={link.end}
                      onClick={onClose}
                      onMouseEnter={() => preloadRouteByPath(link.to)}
                      onFocus={() => preloadRouteByPath(link.to)}
                      className={({ isActive }) =>
                        `group flex items-center gap-3 rounded-2xl border p-3 text-left transition-all duration-200 ${
                          isActive
                            ? 'border-[var(--primary)] bg-gradient-to-r from-[var(--primary)] to-[var(--primary-dark)] text-white shadow-[0_16px_28px_rgba(229,9,20,0.24)]'
                            : 'border-white/80 bg-white/95 text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.06)] hover:border-rose-200 hover:shadow-[0_14px_28px_rgba(15,23,42,0.08)]'
                        }`
                      }
                    >
                      <span
                        className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-sm font-bold transition ${
                          link.to === '/inventory'
                            ? 'border-rose-100 bg-rose-50 text-[var(--primary)]'
                            : 'border-white/70 bg-white/80 text-[var(--primary)]'
                        }`}
                      >
                        {Icon ? <Icon size={18} strokeWidth={2.2} /> : null}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold leading-tight">{link.label}</span>
                        <span className={`mt-1 block text-xs leading-5 ${link.to === '/inventory' ? 'text-white/90' : 'text-slate-500'}`}>
                          {link.description}
                        </span>
                      </span>

                      <ArrowRight size={16} className="shrink-0 opacity-70 transition-transform group-hover:translate-x-0.5" />
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="mb-4 rounded-2xl border border-red-100 bg-white/90 p-3 shadow-[0_8px_20px_rgba(15,23,42,0.06)]">
              <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[var(--primary)]">Menu Categories</p>
              <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                {menuCategories.length ? (
                  menuCategories.map((category) => (
                    <button
                      key={category._id}
                      type="button"
                      onClick={() => onSelectMenuCategory(category._id)}
                      className={`w-full rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${
                        activeCategoryId === String(category._id)
                          ? 'bg-gradient-to-r from-[var(--primary)] to-[var(--primary-dark)] text-white shadow-[0_10px_20px_rgba(229,9,20,0.22)]'
                          : 'border border-slate-200 bg-white text-slate-700 hover:border-red-200 hover:bg-red-50'
                      }`}
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="truncate">{category.name}</span>
                          <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                            {Number(category.itemCount || 0)}
                          </span>
                        </span>
                    </button>
                  ))
                ) : (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">No menu categories found for this restaurant.</p>
                )}
              </div>
            </div>
          )}
        </AnimatePresence>

      <button
        onClick={onLogout}
        className="mt-6 w-full rounded-xl border border-red-100 bg-white px-3 py-2.5 text-left text-sm font-semibold text-slate-700 shadow-sm hover:bg-red-50"
      >
        Logout
      </button>
      </aside>
    </>
  )
}