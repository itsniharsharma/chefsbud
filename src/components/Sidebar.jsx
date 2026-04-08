import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { preloadRouteByPath } from '../utils/routePreload'

const links = [
  { label: 'Dashboard', to: '/dashboard', roles: ['owner', 'staff'] },
  { label: 'Orders', to: '/dashboard/orders', roles: ['owner', 'staff'] },
  { label: 'Menu', to: '/dashboard/menu', roles: ['owner', 'staff'] },
  { label: 'Inventory', to: '/inventory', roles: ['owner', 'staff'] },
  { label: 'Tables', to: '/dashboard/tables', roles: ['owner'] },
  { label: 'Offers (Dev)', to: '/dashboard/offers', roles: ['owner', 'staff'] },
  { label: 'Analytics', to: '/dashboard/analytics', roles: ['owner'] },
  { label: 'Recent Orders', to: '/dashboard/recent-orders', roles: ['owner', 'staff'] },
  { label: 'Settings', to: '/dashboard/settings', roles: ['owner'] },
]

export default function Sidebar({ isOpen, onClose }) {
  const { logout, user } = useAuth()
  const navigate = useNavigate()
  const role = user?.role || 'owner'
  const visibleLinks = links.filter((link) => link.roles.includes(role))

  const onLogout = () => {
    logout()
    navigate('/', { replace: true })
    onClose?.()
  }

  return (
    <>
      {isOpen && <button className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={onClose} />}
      <aside
        className={`owner-sidebar fixed left-0 top-0 z-40 h-screen w-[82vw] max-w-xs overflow-y-auto border-r border-red-100 p-4 transition-transform md:w-64 md:p-5 md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
      <div className="owner-header-panel mb-6 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--primary)]">Executive Suite</p>
        <p className="mt-1 text-2xl font-extrabold text-[var(--primary)]">Chef's Bud</p>
        <p className="mt-1 text-xs text-slate-500">Luxury Restaurant Intelligence</p>
      </div>
      <button className="mb-4 text-sm text-slate-600 md:hidden" onClick={onClose}>
        Close
      </button>
      <nav className="space-y-1.5">
        {visibleLinks.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === '/dashboard'}
            onClick={onClose}
            onMouseEnter={() => preloadRouteByPath(link.to)}
            onFocus={() => preloadRouteByPath(link.to)}
            className={({ isActive }) =>
              `block rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                isActive
                  ? 'bg-gradient-to-r from-[var(--primary-dark)] to-[var(--primary)] text-white shadow-[0_12px_22px_rgba(229,9,20,0.24)]'
                  : 'text-slate-700 hover:bg-white hover:text-slate-900 hover:shadow-sm'
              }`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
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