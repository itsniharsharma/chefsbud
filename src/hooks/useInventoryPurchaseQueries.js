import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/queryKeys'
import { inventoryService } from '../services/inventoryService'

function mapPurchaseToRows(purchase) {
  if (!purchase || !Array.isArray(purchase.items)) return []

  return purchase.items.map((item, itemIndex) => ({
    purchaseId: purchase._id,
    itemIndex,
    invoiceDate: purchase.invoiceDate,
    invoiceNumber: purchase.invoiceNumber,
    sourceType: purchase.sourceType,
    supplierName: purchase.supplierNameSnapshot,
    paymentType: purchase.paymentType,
    itemId: item.itemId,
    itemName: item.itemName,
    quantity: item.quantity,
    unit: item.unit,
    rate: item.rate,
    amount: item.amount,
    createdAt: purchase.createdAt,
    updatedAt: purchase.updatedAt,
  }))
}

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
    onSuccess: (savedPurchase) => {
      const nextRows = mapPurchaseToRows(savedPurchase)
      queryClient.setQueryData(
        queryKeys.inventory.purchases(restaurantId, { limit: 200 }),
        (current = []) => {
          const rows = Array.isArray(current) ? current : []
          const existingKeys = new Set(
            rows.map((row) => `${String(row?.purchaseId || '')}:${Number(row?.itemIndex || 0)}`),
          )
          const dedupedNewRows = nextRows.filter(
            (row) => !existingKeys.has(`${String(row?.purchaseId || '')}:${Number(row?.itemIndex || 0)}`),
          )
          return [...dedupedNewRows, ...rows].slice(0, 200)
        },
      )
    },
  })
}

export function useInventoryPurchaseRows({ restaurantId, limit = 200, paymentType = '', sourceType = '' }) {
  const filters = { limit, paymentType, sourceType }

  return useQuery({
    queryKey: queryKeys.inventory.purchases(restaurantId, filters),
    enabled: Boolean(restaurantId),
    queryFn: () => inventoryService.listPurchaseRows(filters),
    select: (data) => (Array.isArray(data?.rows) ? data.rows : []),
    staleTime: 120_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

export function useUpdateInventoryPurchaseItem({ restaurantId }) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ purchaseId, itemIndex, payload }) =>
      inventoryService.updatePurchaseItemRow({ purchaseId, itemIndex, payload }),
    onSuccess: (result) => {
      const nextRow = result?.row
      if (!nextRow) return

      const queries = queryClient.getQueriesData({ queryKey: ['inventory', 'purchases', restaurantId] })
      for (const [queryKey] of queries) {
        queryClient.setQueryData(queryKey, (current = []) => {
          const rows = Array.isArray(current) ? current : []
          return rows.map((row) => {
            const samePurchase = String(row?.purchaseId) === String(nextRow?.purchaseId)
            const sameIndex = Number(row?.itemIndex) === Number(nextRow?.itemIndex)
            return samePurchase && sameIndex ? nextRow : row
          })
        })
      }
    },
  })
}
