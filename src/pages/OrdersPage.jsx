import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import OrderCard from '../components/OrderCard'
import Button from '../components/Button'
import { orderService } from '../services/orderService'
import { useAuth } from '../hooks/useAuth'
import { queryKeys } from '../lib/queryKeys'
import { useOrdersBoardQuery } from '../hooks/useDashboardQueries'

const statusFilters = ['All', 'Confirmed', 'Preparing', 'Ready', 'Served']

export default function OrdersPage() {
  const { restaurant } = useAuth()
  const [statusFilter, setStatusFilter] = useState('All')
  const [scope, setScope] = useState('All')
  const [error, setError] = useState('')
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

  const refreshBoard = () => {
    if (!restaurant?._id) return Promise.resolve()
    return queryClient.invalidateQueries({
      queryKey: ['dashboard', 'orders-board', restaurant._id],
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

  const onStatusChange = (id, status) => {
    if (!restaurant?._id) return
    updateStatusMutation.mutate({ id, status })
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
              />
            ))}
            {!activeOrders.length && <p className="text-sm text-slate-500">No active orders in this view.</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
