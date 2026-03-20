import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import OrderCard from '../components/OrderCard'
import Button from '../components/Button'
import { orderService } from '../services/orderService'
import { useAuth } from '../hooks/useAuth'
import { useOrdersBoardQuery } from '../hooks/useDashboardQueries'
import { buildBillHtml, buildKotHtml, printHtmlDocument } from '../utils/orderPrint'

const statusFilters = ['All', 'Confirmed', 'Preparing', 'Ready', 'Served']

export default function OrdersPage() {
  const { restaurant } = useAuth()
  const [statusFilter, setStatusFilter] = useState('All')
  const [scope, setScope] = useState('All')
  const [floorSearch, setFloorSearch] = useState('')
  const [appliedFloor, setAppliedFloor] = useState('')
  const [error, setError] = useState('')
  const [printingBillOrderId, setPrintingBillOrderId] = useState('')
  const [printingKotOrderId, setPrintingKotOrderId] = useState('')
  const queryClient = useQueryClient()

  const { data } = useOrdersBoardQuery({
    restaurantId: restaurant?._id,
    statusFilter,
    scope,
    floorNumber: appliedFloor,
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

  const applyFloorSearch = (event) => {
    event.preventDefault()

    const nextValue = String(floorSearch || '').trim()
    if (!nextValue) {
      setAppliedFloor('')
      setError('')
      return
    }

    const parsedFloor = Number(nextValue)
    if (!Number.isInteger(parsedFloor) || parsedFloor < 1) {
      setError('Enter a valid floor number')
      return
    }

    setAppliedFloor(String(parsedFloor))
    setError('')
  }

  const clearFloorSearch = () => {
    setFloorSearch('')
    setAppliedFloor('')
    setError('')
  }

  const printBillForOrder = async (order) => {
    const orderId = String(order?._id || order?.id || '')
    if (!orderId || !restaurant?._id) return

    setPrintingBillOrderId(orderId)
    setError('')

    try {
      await markBillPrintedMutation.mutateAsync({ id: orderId })
      printHtmlDocument({
        html: buildBillHtml({ order, restaurantName: restaurant?.name }),
        title: 'bill',
        features: 'width=860,height=700',
      })
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
      printHtmlDocument({
        html: buildKotHtml({ order }),
        title: 'KOT',
        features: 'width=380,height=640',
      })
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

      <form className="card flex flex-col gap-3 p-4 md:flex-row md:items-end" onSubmit={applyFloorSearch}>
        <label className="flex flex-1 flex-col gap-1 text-sm text-slate-700">
          <span className="font-medium">Search by floor</span>
          <input
            className="input"
            type="number"
            min="1"
            inputMode="numeric"
            placeholder="Enter floor number"
            value={floorSearch}
            onChange={(event) => setFloorSearch(event.target.value)}
          />
        </label>
        <Button type="submit">Search Floor</Button>
        <Button type="button" variant="secondary" onClick={clearFloorSearch} disabled={!floorSearch && !appliedFloor}>
          Clear
        </Button>
      </form>

      <div className="grid grid-cols-1 gap-4">
        <section className="space-y-3 rounded-2xl border border-red-100 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-800">
            {appliedFloor ? `Active Orders - Floor ${appliedFloor}` : 'Active Orders'}
          </h2>
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
