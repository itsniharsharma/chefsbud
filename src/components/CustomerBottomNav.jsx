import { NavLink } from 'react-router-dom'
import {
  buildCustomerCheckoutUrl,
  buildCustomerMenuUrl,
  buildCustomerStatusUrl,
} from '../utils/customerUrl'

const baseItemClass = 'flex min-h-12 flex-col items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold transition'

function navClassName({ isActive }) {
  return `${baseItemClass} ${
    isActive
      ? 'customer-nav-item-active border'
      : 'border border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-900'
  }`
}

export default function CustomerBottomNav({ restaurantSlug, tableNumber }) {
  const menuPath = buildCustomerMenuUrl({ slug: restaurantSlug, tableNumber })
  const ordersPath = buildCustomerCheckoutUrl({ slug: restaurantSlug, tableNumber })
  const statusPath = buildCustomerStatusUrl({ slug: restaurantSlug, tableNumber })

  return (
    <footer className="customer-nav-shell safe-bottom fixed bottom-0 left-0 right-0 z-50 px-3 pt-2">
      <nav className="mx-auto grid max-w-md grid-cols-3 gap-2">
        <NavLink to={menuPath} end className={navClassName}>
          <span className="text-sm">◉</span>
          <span>Menu</span>
        </NavLink>
        <NavLink to={ordersPath} className={navClassName}>
          <span className="text-sm">◎</span>
          <span>Orders</span>
        </NavLink>
        <NavLink to={statusPath} className={navClassName}>
          <span className="text-sm">◈</span>
          <span>Status</span>
        </NavLink>
      </nav>
    </footer>
  )
}