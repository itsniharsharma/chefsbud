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
  recentOrders: () => import('../pages/RecentOrdersPage'),
  settings: () => import('../pages/SettingsPage'),
  inventory: () => import('../pages/InventoryPage'),
  inventoryModule: () => import('../pages/InventoryModulePage'),
  addPurchase: () => import('../pages/AddPurchasePage'),
  customerMenu: () => import('../pages/CustomerMenuPage'),
  customerCheckout: () => import('../pages/CustomerCheckoutPage'),
  customerStatus: () => import('../pages/CustomerStatusPage'),
  customerTracking: () => import('../pages/CustomerOrderTrackingPage'),
}

const routePathImporters = {
  '/dashboard': importers.dashboard,
  '/dashboard/orders': importers.orders,
  '/dashboard/menu': importers.menu,
  '/dashboard/tables': importers.tables,
  '/dashboard/offers': importers.offers,
  '/dashboard/analytics': importers.analytics,
  '/dashboard/recent-orders': importers.recentOrders,
  '/dashboard/settings': importers.settings,
  '/inventory': importers.inventory,
  '/inventory/indent': importers.inventoryModule,
  '/inventory/wastage': importers.inventoryModule,
  '/inventory/stock': importers.inventoryModule,
  '/inventory/reports': importers.inventoryModule,
  '/inventory/purchase': importers.inventoryModule,
  '/inventory/purchase/add': importers.addPurchase,
  '/inventory/conversion': importers.inventoryModule,
  '/inventory/request': importers.inventoryModule,
}

export function preloadRouteByPath(path) {
  if (!path) return
  const importer = routePathImporters[path]
  if (importer) {
    importer()
  }
}

export function warmCriticalRoutes() {
  importers.dashboardLayout()
  importers.dashboard()
  importers.orders()
  importers.menu()
  importers.inventory()
}

export function warmCustomerRoutes() {
  importers.customerMenu()
  importers.customerCheckout()
  importers.customerStatus()
  importers.customerTracking()
}
