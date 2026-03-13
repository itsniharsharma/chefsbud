import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import OrderCard from '../components/OrderCard'
import Button from '../components/Button'
import { orderService } from '../services/orderService'
import { useAuth } from '../hooks/useAuth'
import { queryKeys } from '../lib/queryKeys'
import { useOrdersBoardQuery } from '../hooks/useDashboardQueries'

const statusFilters = ['All', 'Pending', 'Preparing', 'Ready', 'Served', 'Completed']

export default function OrdersPage() {
  const { restaurant } = useAuth()
  const [statusFilter, setStatusFilter] = useState('All')
  const [scope, setScope] = useState('All')
  const [error, setError] = useState('')
  const queryClient = useQueryClient()

  const { data, isLoading, isFetching } = useOrdersBoardQuery({
    restaurantId: restaurant?._id,
    statusFilter,
    scope,
  })

  const activeOrders = useMemo(() => data?.activeOrders || [], [data])
  const recentOrders = useMemo(() => data?.recentOrders || [], [data])

  const refreshBoard = () => {
    if (!restaurant?._id) return Promise.resolve()
    return queryClient.invalidateQueries({
      queryKey: queryKeys.dashboard.ordersBoard(restaurant._id, statusFilter, scope),
    })
  }

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }) => orderService.updateStatus(id, status),
    onSuccess: () => {
      setError('')
      refreshBoard()
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.analyticsCards(restaurant?._id) })
    },
    onError: (requestError) => {
      setError(requestError?.response?.data?.message || 'Failed to update status')
    },
  })

  const deleteOrderMutation = useMutation({
    mutationFn: (id) => orderService.delete(id),
    onSuccess: () => {
      setError('')
      refreshBoard()
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.analyticsCards(restaurant?._id) })
    },
    onError: (requestError) => {
      setError(requestError?.response?.data?.message || 'Failed to delete order')
    },
  })

  const onStatusChange = (id, status) => {
    if (!restaurant?._id) return
    updateStatusMutation.mutate({ id, status })
  }

  const onDeleteOrder = (id) => {
    if (!restaurant?._id) return
    deleteOrderMutation.mutate(id)
  }

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-[var(--primary)]">{error}</p>}
      {(isLoading || isFetching) && (
        <p className="text-sm text-slate-500">Refreshing orders...</p>
      )}
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="space-y-3 rounded-2xl border border-red-100 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-800">Active Orders</h2>
          <div className="grid grid-cols-1 gap-4">
            {activeOrders.map((order) => (
              <OrderCard
                key={order._id || order.id}
                order={order}
                onStatusChange={onStatusChange}
                onDelete={onDeleteOrder}
                deleteLabel="Move to Recent"
              />
            ))}
            {!activeOrders.length && <p className="text-sm text-slate-500">No active orders in this view.</p>}
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-red-100 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-800">Recent Orders</h2>
          <div className="grid grid-cols-1 gap-4">
            {recentOrders.map((order) => (
              <OrderCard
                key={order._id || order.id}
                order={order}
                onStatusChange={onStatusChange}
                onDelete={onDeleteOrder}
                deleteLabel="Hide"
                showStatusActions={false}
              />
            ))}
            {!recentOrders.length && <p className="text-sm text-slate-500">No recent orders in this view.</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
