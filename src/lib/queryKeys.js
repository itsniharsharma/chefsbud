export const queryKeys = {
  customer: {
    tableOrders: (restaurantSlug, tableNumber) => [
      'customer-table-orders',
      restaurantSlug,
      String(tableNumber),
    ],
    orderStatus: (restaurantSlug, tableNumber, orderId) => [
      'customer-order-status',
      restaurantSlug,
      String(tableNumber),
      String(orderId),
    ],
  },
  dashboard: {
    analyticsCards: (restaurantId) => ['dashboard', 'analytics-cards', restaurantId],
    analyticsOverview: (restaurantId, range) => [
      'dashboard',
      'analytics-overview',
      restaurantId,
      String(range || '14d'),
    ],
    analyticsDecision: (restaurantId, range) => [
      'dashboard',
      'analytics-decision',
      restaurantId,
      String(range || '14d'),
    ],
    ordersBoard: (restaurantId, statusFilter, scope, floorNumber = 'all') => [
      'dashboard',
      'orders-board',
      restaurantId,
      statusFilter,
      scope,
      String(floorNumber || 'all'),
    ],
    recentOrders: (restaurantId, scope) => ['dashboard', 'recent-orders', restaurantId, scope],
    tables: (restaurantId) => ['dashboard', 'tables', restaurantId],
    menu: (restaurantId) => ['dashboard', 'menu', restaurantId],
  },
  inventory: {
    suppliers: (restaurantId) => ['inventory', 'suppliers', restaurantId],
    items: (restaurantId) => ['inventory', 'items', restaurantId],
    recipes: (restaurantId) => ['inventory', 'recipes', restaurantId],
    analyticsOverview: (restaurantId) => ['inventory', 'analytics-overview', restaurantId],
    stock: (restaurantId, inventoryItemId) => ['inventory', 'stock', restaurantId, String(inventoryItemId || '')],
    purchases: (restaurantId, filters = {}) => [
      'inventory',
      'purchases',
      restaurantId,
      String(filters.limit || 100),
      String(filters.paymentType || ''),
      String(filters.sourceType || ''),
    ],
  },
}
