import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import BillPrintModal from '../components/BillPrintModal'
import Button from '../components/Button'
import KotReprintModal from '../components/KotReprintModal'
import OrderCard from '../components/OrderCard'
import { useAuth } from '../hooks/useAuth'
import { queryKeys } from '../lib/queryKeys'
import { useRecentOrdersQuery } from '../hooks/useDashboardQueries'
import { orderService } from '../services/orderService'
import { formatCurrencyINR } from '../utils/currency'
import { buildBillHtml, buildKotHtml, closePrintWindow, openPrintWindow, printIntoWindow } from '../utils/orderPrint'
import { buildBillPrintPayload, buildReprintOrderForBill } from '../utils/billPrintFlow'

export default function RecentOrdersPage() {
  const { restaurant } = useAuth()
  const queryClient = useQueryClient()
  const [scope, setScope] = useState('All')
  const [error, setError] = useState('')
  const [deletingOrderId, setDeletingOrderId] = useState('')
  const [printingBillOrderId, setPrintingBillOrderId] = useState('')
  const [printingKotOrderId, setPrintingKotOrderId] = useState('')
  const [billTargetOrder, setBillTargetOrder] = useState(null)
  const [reprintTargetOrder, setReprintTargetOrder] = useState(null)

  const { data, isLoading } = useRecentOrdersQuery({
    restaurantId: restaurant?._id,
    scope,
  })

  const completedOrders = useMemo(() => (Array.isArray(data) ? data : []), [data])

  const totals = useMemo(() => {
    const count = completedOrders.length
    const revenue = completedOrders.reduce((sum, order) => sum + Number(order.billFinalTotalAmount ?? order.totalAmount ?? 0), 0)
    return { count, revenue }
  }, [completedOrders])

  const refreshRecentOrders = () => {
    if (!restaurant?._id) return Promise.resolve()
    return queryClient.invalidateQueries({
      queryKey: queryKeys.dashboard.recentOrders(restaurant._id, scope),
    })
  }

  const applyPrintedState = (orders, orderId, field, atField) => {
    if (!Array.isArray(orders)) return orders
    return orders.map((order) => {
      if (String(order._id || order.id) !== String(orderId)) return order
      return {
        ...order,
        [field]: true,
        [atField]: new Date().toISOString(),
      }
    })
  }

  const applyUpdatedOrder = (orders, updatedOrder) => {
    if (!Array.isArray(orders) || !updatedOrder) return orders
    return orders.map((order) => {
      if (String(order._id || order.id) !== String(updatedOrder._id || updatedOrder.id)) return order
      return {
        ...order,
        ...updatedOrder,
      }
    })
  }

  const markBillPrintedMutation = useMutation({
    mutationFn: ({ id, payload }) => orderService.markBillPrinted(id, payload),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['dashboard', 'recent-orders', restaurant?._id] })
      const previousData = queryClient.getQueriesData({ queryKey: ['dashboard', 'recent-orders', restaurant?._id] })
      queryClient.setQueriesData({ queryKey: ['dashboard', 'recent-orders', restaurant?._id] }, (orders) =>
        applyPrintedState(orders, id, 'billPrinted', 'billPrintedAt'),
      )
      return { previousData }
    },
    onSuccess: (updatedOrder) => {
      setError('')
      queryClient.setQueriesData({ queryKey: ['dashboard', 'recent-orders', restaurant?._id] }, (orders) =>
        applyUpdatedOrder(orders, updatedOrder),
      )
      refreshRecentOrders()
    },
    onError: (requestError, _variables, context) => {
      if (context?.previousData) {
        for (const [key, value] of context.previousData) {
          queryClient.setQueryData(key, value)
        }
      }
      setError(requestError?.response?.data?.message || 'Failed to update bill print status')
    },
  })

  const markKotPrintedMutation = useMutation({
    mutationFn: ({ id, payload }) => orderService.markKotPrinted(id, payload),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['dashboard', 'recent-orders', restaurant?._id] })
      const previousData = queryClient.getQueriesData({ queryKey: ['dashboard', 'recent-orders', restaurant?._id] })
      queryClient.setQueriesData({ queryKey: ['dashboard', 'recent-orders', restaurant?._id] }, (orders) =>
        applyPrintedState(orders, id, 'kotPrinted', 'kotPrintedAt'),
      )
      return { previousData }
    },
    onSuccess: () => {
      setError('')
      refreshRecentOrders()
    },
    onError: (requestError, _variables, context) => {
      if (context?.previousData) {
        for (const [key, value] of context.previousData) {
          queryClient.setQueryData(key, value)
        }
      }
      setError(requestError?.response?.data?.message || 'Failed to update KOT print status')
    },
  })

  const deleteOrderMutation = useMutation({
    mutationFn: ({ id }) => orderService.delete(id),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['dashboard', 'recent-orders', restaurant?._id] })
      const previousData = queryClient.getQueriesData({ queryKey: ['dashboard', 'recent-orders', restaurant?._id] })
      queryClient.setQueriesData({ queryKey: ['dashboard', 'recent-orders', restaurant?._id] }, (orders) => {
        if (!Array.isArray(orders)) return orders
        return orders.filter((order) => String(order._id || order.id) !== String(id))
      })
      return { previousData }
    },
    onSuccess: () => {
      setError('')
      if (restaurant?._id) {
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'orders-board', restaurant._id] })
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.analyticsCards(restaurant._id) })
      }
      refreshRecentOrders()
    },
    onError: (requestError, _variables, context) => {
      if (context?.previousData) {
        for (const [key, value] of context.previousData) {
          queryClient.setQueryData(key, value)
        }
      }
      setError(requestError?.response?.data?.message || 'Failed to delete order')
    },
  })

  const printBillForOrder = async (order, options = {}) => {
    const orderId = String(order?._id || order?.id || '')
    if (!orderId || !restaurant?._id) return

    const confirmed = Boolean(options?.confirmed)
    const payload = buildBillPrintPayload(options)

    if (!confirmed) {
      setBillTargetOrder(order)
      return
    }

    let printWindow = null
    setPrintingBillOrderId(orderId)
    setError('')

    try {
      printWindow = openPrintWindow({
        title: 'bill',
        features: 'width=860,height=700',
      })

      let orderForPrint
      if (order?.billPrinted) {
        orderForPrint = buildReprintOrderForBill({ order, billAdjustments: payload.billAdjustments })
      } else {
        orderForPrint = await markBillPrintedMutation.mutateAsync({ id: orderId, payload })
      }

      printIntoWindow(printWindow, buildBillHtml({ order: orderForPrint, restaurantName: restaurant?.name }))
      setBillTargetOrder(null)
    } catch (requestError) {
      closePrintWindow(printWindow)
      setError(requestError?.message || requestError?.response?.data?.message || 'Unable to print bill')
    } finally {
      setPrintingBillOrderId('')
    }
  }

  const printKotForOrder = async (order, payload = {}) => {
    const orderId = String(order?._id || order?.id || '')
    if (!orderId || !restaurant?._id) return

    if (order?.kotPrinted && !payload?.reprintPasskey) {
      setReprintTargetOrder(order)
      return
    }

    let printWindow = null
    setPrintingKotOrderId(orderId)
    setError('')

    try {
      printWindow = openPrintWindow({
        title: 'KOT',
        features: 'width=380,height=640',
      })
      await markKotPrintedMutation.mutateAsync({ id: orderId, payload })
      printIntoWindow(printWindow, buildKotHtml({ order }))
      setReprintTargetOrder(null)
    } catch (requestError) {
      closePrintWindow(printWindow)
      setError(requestError?.message || requestError?.response?.data?.message || 'Unable to print KOT')
    } finally {
      setPrintingKotOrderId('')
    }
  }

  const deleteRecentOrder = async (order) => {
    const orderId = String(order?._id || order?.id || '')
    if (!orderId || !restaurant?._id) return

    setDeletingOrderId(orderId)
    setError('')
    try {
      await deleteOrderMutation.mutateAsync({ id: orderId })
    } catch (requestError) {
      setError(requestError?.response?.data?.message || requestError?.message || 'Failed to delete order')
    } finally {
      setDeletingOrderId('')
    }
  }

  return (
    <div className="space-y-5">
      <BillPrintModal
        open={Boolean(billTargetOrder)}
        order={billTargetOrder}
        restaurantId={restaurant?._id}
        printing={Boolean(printingBillOrderId)}
        onClose={() => setBillTargetOrder(null)}
        onSimplePrint={() => printBillForOrder(billTargetOrder, { confirmed: true })}
        onPrintWithAdjustments={(payload) => printBillForOrder(billTargetOrder, { confirmed: true, ...payload })}
      />
      <KotReprintModal
        open={Boolean(reprintTargetOrder)}
        order={reprintTargetOrder}
        hasPasskey={Boolean(restaurant?.hasKotReprintPasskey)}
        loading={Boolean(printingKotOrderId)}
        onClose={() => setReprintTargetOrder(null)}
        onConfirm={(payload) => printKotForOrder(reprintTargetOrder, payload)}
      />
      {error && <p className="text-sm text-[var(--primary)]">{error}</p>}

      <div className="card flex flex-wrap gap-2 p-4">
        <Button variant={scope === 'Today' ? 'primary' : 'secondary'} onClick={() => setScope('Today')}>
          Today
        </Button>
        <Button variant={scope === 'All' ? 'primary' : 'secondary'} onClick={() => setScope('All')}>
          All
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Completed Orders</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{totals.count}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Completed Orders Revenue</p>
          <p className="mt-1 text-2xl font-bold text-[var(--primary)]">{formatCurrencyINR(totals.revenue)}</p>
        </div>
      </div>

      <section className="space-y-3 rounded-2xl border border-red-100 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800">Recent Orders</h2>
        <div className="grid grid-cols-1 gap-4">
          {isLoading ? (
            <p className="text-sm text-slate-500">Loading recent orders...</p>
          ) : completedOrders.length ? (
            completedOrders.map((order) => (
              <div key={order._id || order.id} className="space-y-2">
                <OrderCard
                  order={order}
                  onPrintBill={printBillForOrder}
                  onPrintKot={printKotForOrder}
                  printingBillOrderId={printingBillOrderId}
                  printingKotOrderId={printingKotOrderId}
                  showStatusActions={false}
                />
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    className="border-red-300 bg-red-50 text-red-700 hover:border-red-400 hover:bg-red-100"
                    disabled={deletingOrderId === String(order._id || order.id)}
                    onClick={() => deleteRecentOrder(order)}
                  >
                    {deletingOrderId === String(order._id || order.id) ? 'Deleting...' : 'Delete Order'}
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">No completed orders yet.</p>
          )}
        </div>
      </section>
    </div>
  )
}
