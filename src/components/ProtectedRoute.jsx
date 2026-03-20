import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { hasBillingAccess } from '../utils/billingAccess'

const staffAllowedPaths = new Set([
  '/dashboard/orders',
  '/dashboard/menu',
  '/dashboard/offers',
  '/dashboard/recent-orders',
])

function normalizeStaffPath(pathname) {
  const currentPath = String(pathname || '')
  if (currentPath === '/dashboard/billing') {
    return '/dashboard/recent-orders'
  }
  return currentPath
}

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, authLoading, user } = useAuth()
  const location = useLocation()

  if (authLoading) {
    return <div className="p-6 text-sm text-slate-500">Loading...</div>
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }

  if (!hasBillingAccess(user?.billing)) {
    return <Navigate to="/plans" replace />
  }

  if (user?.role === 'staff') {
    const currentPath = normalizeStaffPath(location.pathname)
    if (!staffAllowedPaths.has(currentPath)) {
      return <Navigate to="/dashboard/orders" replace />
    }
  }

  return children
}
