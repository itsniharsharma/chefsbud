import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/queryKeys'
import { inventoryService } from '../services/inventoryService'

function withListContainer(current, listKey, fallback = []) {
  const baseList = Array.isArray(fallback) ? fallback : []

  if (Array.isArray(current)) {
    return {
      list: current,
      write: (nextList) => (Array.isArray(nextList) ? nextList : baseList),
    }
  }

  if (current && typeof current === 'object') {
    const list = Array.isArray(current[listKey]) ? current[listKey] : baseList
    return {
      list,
      write: (nextList) => ({
        ...current,
        [listKey]: Array.isArray(nextList) ? nextList : baseList,
      }),
    }
  }

  return {
    list: baseList,
    write: (nextList) => ({
      [listKey]: Array.isArray(nextList) ? nextList : baseList,
    }),
  }
}

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
      queryClient.setQueryData(queryKeys.inventory.suppliers(restaurantId), (current) => {
        const { list, write } = withListContainer(current, 'suppliers')
        const items = Array.isArray(list) ? list : []
        const exists = items.some((item) => String(item?._id) === String(created?._id))
        if (exists) return write(items)
        const nextItems = [created, ...items].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
        return write(nextItems)
      })
    },
  })
}

export function useCreateInventoryItem({ restaurantId }) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload) => inventoryService.createItem(payload),
    onSuccess: (created) => {
      queryClient.setQueryData(queryKeys.inventory.items(restaurantId), (current) => {
        const { list, write } = withListContainer(current, 'items')
        const items = Array.isArray(list) ? list : []
        const exists = items.some((item) => String(item?._id) === String(created?._id))
        if (exists) return write(items)
        const nextItems = [created, ...items].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
        return write(nextItems)
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

      const queries = queryClient.getQueriesData({ queryKey: ['inventory', 'purchases', restaurantId] })
      for (const [queryKey] of queries) {
        queryClient.setQueryData(queryKey, (current) => {
          const { list, write } = withListContainer(current, 'rows')
          const rows = Array.isArray(list) ? list : []
          const existingKeys = new Set(
            rows.map((row) => `${String(row?.purchaseId || '')}:${Number(row?.itemIndex || 0)}`),
          )
          const dedupedNewRows = nextRows.filter(
            (row) => !existingKeys.has(`${String(row?.purchaseId || '')}:${Number(row?.itemIndex || 0)}`),
          )
          return write([...dedupedNewRows, ...rows].slice(0, 200))
        })
      }

      queryClient.invalidateQueries({
        queryKey: ['inventory', 'purchases', restaurantId],
        refetchType: 'active',
      })
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
        queryClient.setQueryData(queryKey, (current) => {
          const { list, write } = withListContainer(current, 'rows')
          const rows = Array.isArray(list) ? list : []
          const nextRows = rows.map((row) => {
            const samePurchase = String(row?.purchaseId) === String(nextRow?.purchaseId)
            const sameIndex = Number(row?.itemIndex) === Number(nextRow?.itemIndex)
            return samePurchase && sameIndex ? nextRow : row
          })

          return write(nextRows)
        })
      }
    },
  })
}

export function useDeleteInventoryPurchaseItem({ restaurantId }) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ purchaseId, itemIndex }) =>
      inventoryService.deletePurchaseItemRow({ purchaseId, itemIndex }),
    onSuccess: (result, variables) => {
      const deletedPurchaseId = String(result?.purchaseId || variables?.purchaseId || '')
      const deletedItemIndex = Number(result?.itemIndex ?? variables?.itemIndex ?? -1)
      if (!deletedPurchaseId || deletedItemIndex < 0) return

      const queries = queryClient.getQueriesData({ queryKey: ['inventory', 'purchases', restaurantId] })
      for (const [queryKey] of queries) {
        queryClient.setQueryData(queryKey, (current) => {
          const { list, write } = withListContainer(current, 'rows')
          const rows = Array.isArray(list) ? list : []

          const nextRows = rows
            .filter((row) => {
              const samePurchase = String(row?.purchaseId) === deletedPurchaseId
              const sameIndex = Number(row?.itemIndex) === deletedItemIndex
              return !(samePurchase && sameIndex)
            })
            .map((row) => {
              const samePurchase = String(row?.purchaseId) === deletedPurchaseId
              const index = Number(row?.itemIndex)
              if (!samePurchase || index < 0) return row
              if (index <= deletedItemIndex) return row
              return { ...row, itemIndex: index - 1 }
            })

          return write(nextRows)
        })
      }
    },
  })
}
