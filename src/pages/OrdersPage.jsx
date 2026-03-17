import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import OrderCard from '../components/OrderCard'
import Button from '../components/Button'
import { orderService } from '../services/orderService'
import { useAuth } from '../hooks/useAuth'
import { queryKeys } from '../lib/queryKeys'
import { useOrdersBoardQuery } from '../hooks/useDashboardQueries'
import { formatCurrencyINR } from '../utils/currency'

const statusFilters = ['All', 'Confirmed', 'Preparing', 'Ready', 'Served']

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default function OrdersPage() {
  const { restaurant } = useAuth()
  const [statusFilter, setStatusFilter] = useState('All')
  const [scope, setScope] = useState('All')
  const [error, setError] = useState('')
  const [printingBillOrderId, setPrintingBillOrderId] = useState('')
  const [printingKotOrderId, setPrintingKotOrderId] = useState('')
  const queryClient = useQueryClient()

  const { data } = useOrdersBoardQuery({
    restaurantId: restaurant?._id,
    statusFilter,
    scope,
  })

  const activeOrders = useMemo(() => data?.activeOrders || [], [data])

  const applyOrderUpdateToBoard = (boardData, orderId, nextStatus) => {
    if (!boardData) return boardData

    const active = (boardData.activeOrders || []).map((order) => ({ ...order }))
    const activeIndex = active.findIndex((order) => String(order._id || order.id) === String(orderId))

    if (activeIndex >= 0) {
      if (nextStatus === 'Completed') {
        active.splice(activeIndex, 1)
      } else {
        active[activeIndex] = { ...active[activeIndex], orderStatus: nextStatus }
      }
    }

    return { ...boardData, activeOrders: active }
  }

  const applyKotPrintedUpdateToBoard = (boardData, orderId) => {
    if (!boardData) return boardData

    const active = (boardData.activeOrders || []).map((order) => ({ ...order }))
    const activeIndex = active.findIndex((order) => String(order._id || order.id) === String(orderId))

    if (activeIndex >= 0) {
      active[activeIndex] = {
        ...active[activeIndex],
        kotPrinted: true,
        kotPrintedAt: new Date().toISOString(),
      }
    }

    return { ...boardData, activeOrders: active }
  }

  const applyBillPrintedUpdateToBoard = (boardData, orderId) => {
    if (!boardData) return boardData

    const active = (boardData.activeOrders || []).map((order) => ({ ...order }))
    const activeIndex = active.findIndex((order) => String(order._id || order.id) === String(orderId))

    if (activeIndex >= 0) {
      active[activeIndex] = {
        ...active[activeIndex],
        billPrinted: true,
        billPrintedAt: new Date().toISOString(),
      }
    }

    return { ...boardData, activeOrders: active }
  }

  const refreshBoard = () => {
    if (!restaurant?._id) return Promise.resolve()
    queryClient.invalidateQueries({
      queryKey: ['dashboard', 'orders-board', restaurant._id],
    })
    return queryClient.invalidateQueries({
      queryKey: ['dashboard', 'recent-orders', restaurant._id],
    })
  }

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }) => orderService.updateStatus(id, status),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['dashboard', 'orders-board', restaurant?._id] })
      const previousBoards = queryClient.getQueriesData({
        queryKey: ['dashboard', 'orders-board', restaurant?._id],
      })

      queryClient.setQueriesData({ queryKey: ['dashboard', 'orders-board', restaurant?._id] }, (boardData) =>
        applyOrderUpdateToBoard(boardData, id, status),
      )

      return { previousBoards }
    },
    onSuccess: () => {
      setError('')
      refreshBoard()
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.analyticsCards(restaurant?._id) })
    },
    onError: (requestError, _variables, context) => {
      if (context?.previousBoards) {
        for (const [key, value] of context.previousBoards) {
          queryClient.setQueryData(key, value)
        }
      }
      setError(requestError?.response?.data?.message || 'Failed to update status')
    },
  })

  const markKotPrintedMutation = useMutation({
    mutationFn: ({ id }) => orderService.markKotPrinted(id),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['dashboard', 'orders-board', restaurant?._id] })
      const previousBoards = queryClient.getQueriesData({
        queryKey: ['dashboard', 'orders-board', restaurant?._id],
      })

      queryClient.setQueriesData({ queryKey: ['dashboard', 'orders-board', restaurant?._id] }, (boardData) =>
        applyKotPrintedUpdateToBoard(boardData, id),
      )

      return { previousBoards }
    },
    onSuccess: () => {
      setError('')
      refreshBoard()
    },
    onError: (requestError, _variables, context) => {
      if (context?.previousBoards) {
        for (const [key, value] of context.previousBoards) {
          queryClient.setQueryData(key, value)
        }
      }
      setError(requestError?.response?.data?.message || 'Failed to update KOT status')
    },
  })

  const markBillPrintedMutation = useMutation({
    mutationFn: ({ id }) => orderService.markBillPrinted(id),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['dashboard', 'orders-board', restaurant?._id] })
      const previousBoards = queryClient.getQueriesData({
        queryKey: ['dashboard', 'orders-board', restaurant?._id],
      })

      queryClient.setQueriesData({ queryKey: ['dashboard', 'orders-board', restaurant?._id] }, (boardData) =>
        applyBillPrintedUpdateToBoard(boardData, id),
      )

      return { previousBoards }
    },
    onSuccess: () => {
      setError('')
      refreshBoard()
    },
    onError: (requestError, _variables, context) => {
      if (context?.previousBoards) {
        for (const [key, value] of context.previousBoards) {
          queryClient.setQueryData(key, value)
        }
      }
      setError(requestError?.response?.data?.message || 'Failed to update bill print status')
    },
  })

  const onStatusChange = (id, status) => {
    if (!restaurant?._id) return
    updateStatusMutation.mutate({ id, status })
  }

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

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-[var(--primary)]">{error}</p>}
      <div className="card flex flex-wrap gap-2 p-4">
        {statusFilters.map((filter) => (
          <Button
            key={filter}
            variant={statusFilter === filter ? 'primary' : 'secondary'}
            onClick={() => setStatusFilter(filter)}
          >
            {filter}
          </Button>
        ))}
        <Button variant={scope === 'Today' ? 'primary' : 'secondary'} onClick={() => setScope('Today')}>
          Today
        </Button>
        <Button variant={scope === 'All' ? 'primary' : 'secondary'} onClick={() => setScope('All')}>
          All
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <section className="space-y-3 rounded-2xl border border-red-100 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-800">Active Orders</h2>
          <div className="grid grid-cols-1 gap-4">
            {activeOrders.map((order) => (
              <OrderCard
                key={order._id || order.id}
                order={order}
                onStatusChange={onStatusChange}
                onPrintBill={printBillForOrder}
                onPrintKot={printKotForOrder}
                printingBillOrderId={printingBillOrderId}
                printingKotOrderId={printingKotOrderId}
              />
            ))}
            {!activeOrders.length && <p className="text-sm text-slate-500">No active orders in this view.</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
