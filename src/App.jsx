import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import { importers, warmCriticalRoutes, warmCustomerRoutes } from './utils/routePreload'
import { buildCustomerMenuUrl } from './utils/customerUrl'

const DashboardLayout = lazy(importers.dashboardLayout)
const LandingPage = lazy(importers.landing)
const PlatformPage = lazy(importers.platform)
const TrustPage = lazy(importers.trust)
const ContactPage = lazy(importers.contact)
const LoginPage = lazy(importers.login)
const RegisterPage = lazy(importers.register)
const PricingPage = lazy(importers.pricing)
const DashboardPage = lazy(importers.dashboard)
const OrdersPage = lazy(importers.orders)
const MenuPage = lazy(importers.menu)
const TablesPage = lazy(importers.tables)
const OffersPage = lazy(importers.offers)
const AnalyticsPage = lazy(importers.analytics)
const RecentOrdersPage = lazy(importers.recentOrders)
const SettingsPage = lazy(importers.settings)
const InventoryPage = lazy(importers.inventory)
const InventoryModulePage = lazy(importers.inventoryModule)
const AddPurchasePage = lazy(importers.addPurchase)
const CustomerMenuPage = lazy(importers.customerMenu)
const CustomerCheckoutPage = lazy(importers.customerCheckout)
const CustomerStatusPage = lazy(importers.customerStatus)
const CustomerOrderTrackingPage = lazy(importers.customerTracking)

function CustomerRouteFallback() {
  const { restaurantSlug, tableNumber } = useParams()
  const target = buildCustomerMenuUrl({ slug: restaurantSlug, tableNumber })
  return <Navigate to={target} replace />
}

function App() {
  useEffect(() => {
    const idleCallback = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 250))
    const cancelIdle = window.cancelIdleCallback || window.clearTimeout

    const id = idleCallback(() => {
      const currentPath = String(window.location.pathname || '')
      if (currentPath.startsWith('/r/')) {
        warmCustomerRoutes()
      } else {
        warmCriticalRoutes()
      }
    })

    return () => cancelIdle(id)
  }, [])

  return (
    <BrowserRouter>
      <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading...</div>}>
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<LandingPage />} />
          <Route path="/platform" element={<PlatformPage />} />
          <Route path="/trust" element={<TrustPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/plans" element={<PricingPage />} />
          <Route path="/pricing" element={<Navigate to="/plans" replace />} />
          <Route path="/r/:restaurantSlug/t/:tableNumber" element={<CustomerMenuPage />} />
          <Route path="/r/:restaurantSlug/t/:tableNumber/checkout" element={<CustomerCheckoutPage />} />
          <Route path="/r/:restaurantSlug/t/:tableNumber/status" element={<CustomerStatusPage />} />
          <Route
            path="/r/:restaurantSlug/t/:tableNumber/order/:orderId"
            element={<CustomerOrderTrackingPage />}
          />
          <Route
            path="/r/:restaurantSlug/t/:tableNumber/*"
            element={<CustomerRouteFallback />}
          />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="menu" element={<MenuPage />} />
            <Route path="tables" element={<TablesPage />} />
            <Route path="offers" element={<OffersPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="recent-orders" element={<RecentOrdersPage />} />
            <Route path="billing" element={<Navigate to="/dashboard/recent-orders" replace />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route
            path="/inventory"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<InventoryPage />} />
            <Route path="indent" element={<InventoryModulePage moduleKey="indent" />} />
            <Route path="wastage" element={<InventoryModulePage moduleKey="wastage" />} />
            <Route path="stock" element={<InventoryModulePage moduleKey="stock" />} />
            <Route path="reports" element={<InventoryModulePage moduleKey="reports" />} />
            <Route path="purchase" element={<InventoryModulePage moduleKey="purchase" />} />
            <Route path="purchase/add" element={<AddPurchasePage />} />
            <Route path="conversion" element={<InventoryModulePage moduleKey="conversion" />} />
            <Route path="request" element={<InventoryModulePage moduleKey="request" />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
