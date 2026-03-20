import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/queryKeys'
import { orderService } from '../services/orderService'

const CUSTOMER_STATUS_STALE_MS = 12_000
const CUSTOMER_TABLE_REFETCH_MS = 12_000
const CUSTOMER_ORDER_REFETCH_MS = 12_000
const CUSTOMER_TERMINAL_ORDER_REFETCH_MS = 25_000

function getVisibleRefetchInterval(intervalMs) {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    return false
  }

  return intervalMs
}

function getTableOrdersRefetchInterval() {
  return getVisibleRefetchInterval(CUSTOMER_TABLE_REFETCH_MS)
}

function getOrderStatusRefetchInterval(query) {
  const orderStatus = String(query.state.data?.orderStatus || '').trim()
  const isTerminal = orderStatus === 'Completed'
  return getVisibleRefetchInterval(
    isTerminal ? CUSTOMER_TERMINAL_ORDER_REFETCH_MS : CUSTOMER_ORDER_REFETCH_MS,
  )
}

export function useCustomerTableOrdersQuery({ restaurantSlug, tableNumber }) {
  return useQuery({
    queryKey: queryKeys.customer.tableOrders(restaurantSlug, tableNumber),
    enabled: Boolean(restaurantSlug && tableNumber),
    queryFn: () => orderService.trackTable(restaurantSlug, tableNumber),
    staleTime: CUSTOMER_STATUS_STALE_MS,
    gcTime: 10 * 60_000,
    refetchInterval: getTableOrdersRefetchInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (previousData) => previousData,
  })
}

export function useCustomerOrderStatusQuery({ restaurantSlug, tableNumber, orderId }) {
  const queryClient = useQueryClient()
  const tableOrdersKey = queryKeys.customer.tableOrders(restaurantSlug, tableNumber)
  const cachedTableOrders = queryClient.getQueryData(tableOrdersKey)
  const cachedTableOrdersState = queryClient.getQueryState(tableOrdersKey)

  return useQuery({
    queryKey: queryKeys.customer.orderStatus(restaurantSlug, tableNumber, orderId),
    enabled: Boolean(restaurantSlug && tableNumber && orderId),
    queryFn: () => orderService.track(restaurantSlug, tableNumber, orderId),
    staleTime: CUSTOMER_STATUS_STALE_MS,
    gcTime: 10 * 60_000,
    refetchInterval: getOrderStatusRefetchInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    initialData: () => {
      if (!Array.isArray(cachedTableOrders)) {
        return undefined
      }

      return cachedTableOrders.find((order) => String(order?._id) === String(orderId))
    },
    initialDataUpdatedAt: () => cachedTableOrdersState?.dataUpdatedAt,
    placeholderData: (previousData) => previousData,
    onSuccess: (latestOrder) => {
      queryClient.setQueryData(tableOrdersKey, (existingOrders) => {
        if (!Array.isArray(existingOrders)) {
          return existingOrders
        }

        return existingOrders.map((order) =>
          String(order?._id) === String(latestOrder?._id) ? latestOrder : order,
        )
      })
    },
  })
}
