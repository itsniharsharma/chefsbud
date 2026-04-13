import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import { useAuth } from '../hooks/useAuth'
import { queryKeys } from '../lib/queryKeys'
import { analyticsService } from '../services/analyticsService'
import { menuService } from '../services/menuService'
import { orderService } from '../services/orderService'
import { tableService } from '../services/tableService'

const titles = {
  '/dashboard': 'Dashboard',
  '/dashboard/orders': 'Orders',
  '/dashboard/menu': 'Menu Management',
  '/dashboard/tables': 'Table Management',
  '/dashboard/offers': 'Offers (Under Development)',
  '/dashboard/analytics': 'Analytics (Under Development)',
  '/dashboard/recent-orders': 'Recent Orders',
  '/dashboard/settings': 'Settings',
  '/inventory': 'Inventory',
  '/inventory/indent': 'Indent Management',
  '/inventory/wastage': 'Wastage',
  '/inventory/stock': 'Current Stock',
  '/inventory/reports': 'Stock Report',
  '/inventory/purchase': 'Purchase Management',
  '/inventory/purchase/add': 'Add Purchase',
  '/inventory/conversion': 'Convert Raw Material',
  '/inventory/recipes': 'Recipe Builder',
  '/inventory/request': 'Request For Purchase',
  '/inventory/analytics': 'Inventory Analytics',
}

export default function DashboardLayout() {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { restaurant, user } = useAuth()
  const queryClient = useQueryClient()
  const isOwner = user?.role === 'owner'
  const shouldPrefetchDashboardData = location.pathname.startsWith('/dashboard')

  useEffect(() => {
    if (!shouldPrefetchDashboardData) return
    if (!restaurant?._id || !restaurant?.slug) return

    queryClient.prefetchQuery({
      queryKey: queryKeys.dashboard.ordersBoard(restaurant._id, 'All', 'All', 'all'),
      queryFn: () =>
        orderService.listBoard(restaurant._id, {
          status: 'All',
          scope: 'all',
        }),
    })
    queryClient.prefetchQuery({
      queryKey: queryKeys.dashboard.menu(restaurant._id),
      queryFn: () => menuService.getManagedMenu(restaurant._id),
    })
    queryClient.prefetchQuery({
      queryKey: queryKeys.dashboard.recentOrders(restaurant._id, 'All'),
      queryFn: () =>
        orderService.list(restaurant._id, {
          view: 'completed',
          scope: 'all',
          limit: 200,
        }),
    })

    if (isOwner) {
      queryClient.prefetchQuery({
        queryKey: queryKeys.dashboard.analyticsCards(restaurant._id),
        queryFn: () => analyticsService.dashboard(restaurant._id),
      })
      queryClient.prefetchQuery({
        queryKey: queryKeys.dashboard.tables(restaurant._id),
        queryFn: () => tableService.list(restaurant._id),
      })
    }
  }, [restaurant?._id, restaurant?.slug, queryClient, isOwner, shouldPrefetchDashboardData])

  return (
    <div className="owner-shell">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="ml-0 p-3 pb-8 md:ml-[20rem] md:p-6 lg:p-8">
        <button
          className="mb-4 rounded-xl border border-red-100 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm md:hidden"
          onClick={() => setSidebarOpen(true)}
        >
          ☰ Workspace Menu
        </button>
        <Header title={titles[location.pathname] || 'Dashboard'} />
        <div className="premium-grid">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
