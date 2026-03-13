import { useQuery } from '@tanstack/react-query'
import { analyticsService } from '../services/analyticsService'
import { menuService } from '../services/menuService'
import { orderService } from '../services/orderService'
import { tableService } from '../services/tableService'
import { queryKeys } from '../lib/queryKeys'

export function useOrdersBoardQuery({ restaurantId, statusFilter, scope }) {
  return useQuery({
    queryKey: queryKeys.dashboard.ordersBoard(restaurantId, statusFilter, scope),
    enabled: Boolean(restaurantId),
    queryFn: () =>
      orderService.listBoard(restaurantId, {
        status: statusFilter,
        scope: scope === 'Today' ? 'today' : 'all',
      }),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  })
}

export function useTablesQuery({ restaurantId }) {
  return useQuery({
    queryKey: queryKeys.dashboard.tables(restaurantId),
    enabled: Boolean(restaurantId),
    queryFn: () => tableService.list(restaurantId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  })
}

export function useMenuQuery({ restaurantSlug }) {
  return useQuery({
    queryKey: queryKeys.dashboard.menu(restaurantSlug),
    enabled: Boolean(restaurantSlug),
    queryFn: () => menuService.getBySlug(restaurantSlug),
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  })
}

export function useDashboardAnalyticsCardsQuery({ restaurantId }) {
  return useQuery({
    queryKey: queryKeys.dashboard.analyticsCards(restaurantId),
    enabled: Boolean(restaurantId),
    queryFn: () => analyticsService.dashboard(restaurantId),
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  })
}
