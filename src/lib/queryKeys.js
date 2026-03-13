export const queryKeys = {
  dashboard: {
    analyticsCards: (restaurantId) => ['dashboard', 'analytics-cards', restaurantId],
    ordersBoard: (restaurantId, statusFilter, scope) => [
      'dashboard',
      'orders-board',
      restaurantId,
      statusFilter,
      scope,
    ],
    tables: (restaurantId) => ['dashboard', 'tables', restaurantId],
    menu: (restaurantSlug) => ['dashboard', 'menu', restaurantSlug],
  },
}
