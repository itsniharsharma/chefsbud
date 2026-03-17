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
    ordersBoard: (restaurantId, statusFilter, scope) => [
      'dashboard',
      'orders-board',
      restaurantId,
      statusFilter,
      scope,
    ],
    recentOrders: (restaurantId, scope) => ['dashboard', 'recent-orders', restaurantId, scope],
    tables: (restaurantId) => ['dashboard', 'tables', restaurantId],
    menu: (restaurantSlug) => ['dashboard', 'menu', restaurantSlug],
  },
}
