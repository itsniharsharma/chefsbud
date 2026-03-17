import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../components/Button'
import OrderCard from '../components/OrderCard'
import { useAuth } from '../hooks/useAuth'
import { queryKeys } from '../lib/queryKeys'
import { useRecentOrdersQuery } from '../hooks/useDashboardQueries'
import { orderService } from '../services/orderService'
import { formatCurrencyINR } from '../utils/currency'

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default function RecentOrdersPage() {
  const { restaurant } = useAuth()
  const queryClient = useQueryClient()
  const [scope, setScope] = useState('All')
  const [error, setError] = useState('')
  const [deletingOrderId, setDeletingOrderId] = useState('')
  const [printingBillOrderId, setPrintingBillOrderId] = useState('')
  const [printingKotOrderId, setPrintingKotOrderId] = useState('')

  const { data, isLoading } = useRecentOrdersQuery({
    restaurantId: restaurant?._id,
    scope,
  })

  const completedOrders = useMemo(() => (Array.isArray(data) ? data : []), [data])

  const totals = useMemo(() => {
    const count = completedOrders.length
    const revenue = completedOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0)
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

  const markBillPrintedMutation = useMutation({
    mutationFn: ({ id }) => orderService.markBillPrinted(id),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['dashboard', 'recent-orders', restaurant?._id] })
      const previousData = queryClient.getQueriesData({ queryKey: ['dashboard', 'recent-orders', restaurant?._id] })
      queryClient.setQueriesData({ queryKey: ['dashboard', 'recent-orders', restaurant?._id] }, (orders) =>
        applyPrintedState(orders, id, 'billPrinted', 'billPrintedAt'),
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
      setError(requestError?.response?.data?.message || 'Failed to update bill print status')
    },
  })

  const markKotPrintedMutation = useMutation({
    mutationFn: ({ id }) => orderService.markKotPrinted(id),
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

  const buildBillHtml = (order) => {
    const rows = (order.items || [])
      .map((item) => {
        const qty = Number(item.quantity || 0)
        const price = Number(item.price || 0)
        const subtotal = qty * price
        return `
          <tr>
            <td>${escapeHtml(item.name)}</td>
            <td style="text-align:center;">${qty}</td>
            <td style="text-align:right;">${escapeHtml(formatCurrencyINR(price))}</td>
            <td style="text-align:right;">${escapeHtml(formatCurrencyINR(subtotal))}</td>
          </tr>
        `
      })
      .join('')

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Bill ${escapeHtml(order._id || order.id)}</title>
  </head>
  <body style="font-family:Arial,sans-serif;padding:16px;color:#0f172a;">
    <h2 style="margin:0 0 8px 0;">${escapeHtml(restaurant?.name || "Chef's Bud")}</h2>
    <div style="font-size:12px;line-height:1.6;">
      <div><strong>Order:</strong> ${escapeHtml(order._id || order.id)}</div>
      <div><strong>Table:</strong> ${escapeHtml(order.tableNumber)} | <strong>Floor:</strong> ${escapeHtml(order.floorNumber || 1)}</div>
      <div><strong>Time:</strong> ${escapeHtml(order.createdAt ? new Date(order.createdAt).toLocaleString() : '-')}</div>
      <div><strong>Status:</strong> ${escapeHtml(order.orderStatus || '-')}</div>
    </div>
    <hr style="margin:10px 0;"/>
    <table style="width:100%;font-size:13px;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="text-align:left;padding:4px 0;">Item</th>
          <th style="text-align:center;padding:4px 0;">Qty</th>
          <th style="text-align:right;padding:4px 0;">Price</th>
          <th style="text-align:right;padding:4px 0;">Subtotal</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <hr style="margin:10px 0;"/>
    <div style="text-align:right;font-weight:700;">Total: ${escapeHtml(formatCurrencyINR(order.totalAmount || 0))}</div>
  </body>
</html>`
  }

  const printBillForOrder = async (order) => {
    const orderId = String(order?._id || order?.id || '')
    if (!orderId || !restaurant?._id) return

    setPrintingBillOrderId(orderId)
    setError('')

    try {
      await markBillPrintedMutation.mutateAsync({ id: orderId })

      const opened = window.open('', '_blank', 'width=860,height=700')
      if (!opened) {
        throw new Error('Popup blocked. Please allow popups to print bill.')
      }

      opened.document.write(buildBillHtml(order))
      opened.document.close()
      opened.focus()
      opened.print()
    } catch (requestError) {
      setError(requestError?.message || requestError?.response?.data?.message || 'Unable to print bill')
    } finally {
      setPrintingBillOrderId('')
    }
  }

  const printKotForOrder = async (order) => {
    const orderId = String(order?._id || order?.id || '')
    if (!orderId || !restaurant?._id) return

    setPrintingKotOrderId(orderId)
    setError('')

    try {
      await markKotPrintedMutation.mutateAsync({ id: orderId })

      const printableItems = Array.isArray(order.items)
        ? order.items
            .map((item) => {
              const name = escapeHtml(typeof item === 'string' ? item : item?.name || 'Item')
              const qty = typeof item === 'string' ? 1 : Number(item?.quantity || 1)
              return `<tr><td style="padding:4px 0;">${name}</td><td style="padding:4px 0;text-align:right;">x${qty}</td></tr>`
            })
            .join('')
        : ''

      const opened = window.open('', '_blank', 'width=380,height=640')
      if (!opened) {
        throw new Error('Popup blocked. Please allow popups to print KOT.')
      }

      const createdAt = order.createdAt ? new Date(order.createdAt).toLocaleString() : '-'
      const note = order.customerNote ? escapeHtml(String(order.customerNote)) : ''

      opened.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>KOT - ${orderId}</title>
  </head>
  <body style="font-family:Arial,sans-serif;padding:14px;color:#0f172a;">
    <h2 style="margin:0 0 8px 0;">KITCHEN ORDER TICKET</h2>
    <div style="font-size:12px;line-height:1.6;">
      <div><strong>Order:</strong> ${orderId}</div>
      <div><strong>Table:</strong> ${order.tableNumber} | <strong>Floor:</strong> ${order.floorNumber || 1}</div>
      <div><strong>Time:</strong> ${createdAt}</div>
      <div><strong>Status:</strong> ${order.orderStatus}</div>
    </div>
    <hr style="margin:10px 0;"/>
    <table style="width:100%;font-size:13px;border-collapse:collapse;">
      <tbody>
        ${printableItems}
      </tbody>
    </table>
    ${note ? `<hr style="margin:10px 0;"/><div style="font-size:12px;"><strong>Note:</strong> ${note}</div>` : ''}
  </body>
</html>`)
      opened.document.close()
      opened.focus()
      opened.print()
    } catch (requestError) {
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
