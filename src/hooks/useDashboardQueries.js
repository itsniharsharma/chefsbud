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
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
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
    staleTime: 20_000,
    refetchInterval: 90_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  })
}

export function useTablesQuery({ restaurantId }) {
  return useQuery({
    queryKey: queryKeys.dashboard.tables(restaurantId),
    enabled: Boolean(restaurantId),
    queryFn: () => tableService.list(restaurantId),
    staleTime: 60_000,
    refetchInterval: 90_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  })
}

export function useMenuQuery({ restaurantId }) {
  return useQuery({
    queryKey: queryKeys.dashboard.menu(restaurantId),
    enabled: Boolean(restaurantId),
    queryFn: () => menuService.getManagedMenu(restaurantId),
    staleTime: 90_000,
    refetchInterval: 180_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  })
}

export function useDashboardAnalyticsCardsQuery({ restaurantId }) {
  return useQuery({
    queryKey: queryKeys.dashboard.analyticsCards(restaurantId),
    enabled: Boolean(restaurantId),
    queryFn: () => analyticsService.dashboard(restaurantId),
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  })
}

export function useAnalyticsOverviewQuery({ restaurantId, range }) {
  return useQuery({
    queryKey: queryKeys.dashboard.analyticsOverview(restaurantId, range),
    enabled: Boolean(restaurantId),
    queryFn: () => analyticsService.analytics(restaurantId, { range }),
    staleTime: 60_000,
    refetchInterval: 180_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  })
}
