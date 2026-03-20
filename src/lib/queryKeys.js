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
    analyticsOverview: (restaurantId, rangeDays) => [
      'dashboard',
      'analytics-overview',
      restaurantId,
      String(rangeDays || 14),
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
}
