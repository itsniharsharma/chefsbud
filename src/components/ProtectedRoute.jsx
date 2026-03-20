import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

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

function toTimestamp(value) {
  const ts = value ? new Date(value).getTime() : NaN
  return Number.isFinite(ts) ? ts : 0
}

function hasBillingAccess(billing) {
  if (!billing) {
    return false
  }

  if (billing.status === 'active') {
    return true
  }

  const now = Date.now()
  const graceWindowEnds = Math.max(toTimestamp(billing.graceEndsAt), toTimestamp(billing.currentPeriodEnd))
  return ['grace_period', 'past_due'].includes(billing.status) && graceWindowEnds > now
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
