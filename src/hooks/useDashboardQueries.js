import { useQuery } from '@tanstack/react-query'
import { analyticsService } from '../services/analyticsService'
import { menuService } from '../services/menuService'
import { orderService } from '../services/orderService'
import { tableService } from '../services/tableService'
import { queryKeys } from '../lib/queryKeys'

export function useOrdersBoardQuery({ restaurantId, statusFilter, scope, floorNumber }) {
  return useQuery({
    queryKey: queryKeys.dashboard.ordersBoard(restaurantId, statusFilter, scope, floorNumber),
    enabled: Boolean(restaurantId),
    queryFn: () =>
      orderService.listBoard(restaurantId, {
        status: statusFilter,
        scope: scope === 'Today' ? 'today' : 'all',
        ...(floorNumber ? { floorNumber } : {}),
      }),
    refetchInterval: 25_000,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  })
}

export function useRecentOrdersQuery({ restaurantId, scope }) {
  return useQuery({
    queryKey: queryKeys.dashboard.recentOrders(restaurantId, scope),
    enabled: Boolean(restaurantId),
    queryFn: () =>
      orderService.list(restaurantId, {
        view: 'completed',
        scope: scope === 'Today' ? 'today' : 'all',
        limit: 200,
      }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  })
}

export function useTablesQuery({ restaurantId }) {
  return useQuery({
    queryKey: queryKeys.dashboard.tables(restaurantId),
    enabled: Boolean(restaurantId),
    queryFn: () => tableService.list(restaurantId),
    refetchInterval: 90_000,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  })
}

export function useMenuQuery({ restaurantId }) {
  return useQuery({
    queryKey: queryKeys.dashboard.menu(restaurantId),
    enabled: Boolean(restaurantId),
    queryFn: () => menuService.getManagedMenu(restaurantId),
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  })
}

export function useDashboardAnalyticsCardsQuery({ restaurantId }) {
  return useQuery({
    queryKey: queryKeys.dashboard.analyticsCards(restaurantId),
    enabled: Boolean(restaurantId),
    queryFn: () => analyticsService.dashboard(restaurantId),
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  })
}
