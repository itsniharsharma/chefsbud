export const importers = {
  dashboardLayout: () => import('../layouts/DashboardLayout'),
  landing: () => import('../pages/LandingPage'),
  platform: () => import('../pages/PlatformPage'),
  trust: () => import('../pages/TrustPage'),
  contact: () => import('../pages/ContactPage'),
  login: () => import('../pages/LoginPage'),
  register: () => import('../pages/RegisterPage'),
  pricing: () => import('../pages/PricingPage'),
  dashboard: () => import('../pages/DashboardPage'),
  orders: () => import('../pages/OrdersPage'),
  menu: () => import('../pages/MenuPage'),
  tables: () => import('../pages/TablesPage'),
  offers: () => import('../pages/OffersPage'),
  analytics: () => import('../pages/AnalyticsPage'),
  billing: () => import('../pages/BillingPage'),
  settings: () => import('../pages/SettingsPage'),
  customerMenu: () => import('../pages/CustomerMenuPage'),
  customerCheckout: () => import('../pages/CustomerCheckoutPage'),
  customerStatus: () => import('../pages/CustomerStatusPage'),
  customerTracking: () => import('../pages/CustomerOrderTrackingPage'),
}

const dashboardPathImporters = {
  '/dashboard': importers.dashboard,
  '/dashboard/orders': importers.orders,
  '/dashboard/menu': importers.menu,
  '/dashboard/tables': importers.tables,
  '/dashboard/offers': importers.offers,
  '/dashboard/analytics': importers.analytics,
  '/dashboard/billing': importers.billing,
  '/dashboard/settings': importers.settings,
}

export function preloadRouteByPath(path) {
  if (!path) return
  const importer = dashboardPathImporters[path]
  if (importer) {
    importer()
  }
}

export function warmCriticalRoutes() {
  importers.dashboardLayout()
  importers.dashboard()
  importers.orders()
  importers.menu()
}

export function warmCustomerRoutes() {
  importers.customerMenu()
  importers.customerCheckout()
  importers.customerStatus()
  importers.customerTracking()
}