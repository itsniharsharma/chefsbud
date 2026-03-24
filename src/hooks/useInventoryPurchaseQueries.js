import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/queryKeys'
import { inventoryService } from '../services/inventoryService'

export function useInventorySuppliers({ restaurantId }) {
  return useQuery({
    queryKey: queryKeys.inventory.suppliers(restaurantId),
    enabled: Boolean(restaurantId),
    queryFn: () => inventoryService.listSuppliers(),
    select: (data) => (Array.isArray(data?.suppliers) ? data.suppliers : []),
    staleTime: 120_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

export function useInventoryItems({ restaurantId }) {
  return useQuery({
    queryKey: queryKeys.inventory.items(restaurantId),
    enabled: Boolean(restaurantId),
    queryFn: () => inventoryService.listItems(),
    select: (data) => (Array.isArray(data?.items) ? data.items : []),
    staleTime: 120_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

export function useCreateSupplier({ restaurantId }) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload) => inventoryService.createSupplier(payload),
    onSuccess: (created) => {
      queryClient.setQueryData(queryKeys.inventory.suppliers(restaurantId), (current = []) => {
        const items = Array.isArray(current) ? current : []
        const exists = items.some((item) => String(item?._id) === String(created?._id))
        if (exists) return items
        return [created, ...items].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
      })
    },
  })
}

export function useCreateInventoryItem({ restaurantId }) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload) => inventoryService.createItem(payload),
    onSuccess: (created) => {
      queryClient.setQueryData(queryKeys.inventory.items(restaurantId), (current = []) => {
        const items = Array.isArray(current) ? current : []
        const exists = items.some((item) => String(item?._id) === String(created?._id))
        if (exists) return items
        return [created, ...items].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
      })
    },
  })
}

export function useCreatePurchase({ restaurantId }) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload) => inventoryService.createPurchase(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.purchases(restaurantId) })
    },
  })
}
