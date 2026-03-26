import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import BillPrintModal from '../components/BillPrintModal'
import OrderCard from '../components/OrderCard'
import Button from '../components/Button'
import KotReprintModal from '../components/KotReprintModal'
import { orderService } from '../services/orderService'
import { useAuth } from '../hooks/useAuth'
import { useOrdersBoardQuery, useTablesQuery } from '../hooks/useDashboardQueries'
import { buildBillHtml, buildKotHtml, closePrintWindow, openPrintWindow, printIntoWindow } from '../utils/orderPrint'
import { buildBillPrintPayload, buildReprintOrderForBill } from '../utils/billPrintFlow'

const statusFilters = ['All', 'Confirmed', 'Preparing', 'Ready', 'Served']

export default function OrdersPage() {
  const { restaurant } = useAuth()
  const [statusFilter, setStatusFilter] = useState('All')
  const [scope, setScope] = useState('All')
  const [floorSearch, setFloorSearch] = useState('')
  const [appliedFloor, setAppliedFloor] = useState('')
  const [error, setError] = useState('')
  const [shiftTargetOrder, setShiftTargetOrder] = useState(null)
  const [shiftFloorNumber, setShiftFloorNumber] = useState('')
  const [shiftTableNumber, setShiftTableNumber] = useState('')
  const [shiftingTableKey, setShiftingTableKey] = useState('')
  const [printingBillOrderId, setPrintingBillOrderId] = useState('')
  const [printingKotOrderId, setPrintingKotOrderId] = useState('')
  const [billTargetOrder, setBillTargetOrder] = useState(null)
  const [reprintTargetOrder, setReprintTargetOrder] = useState(null)
  const queryClient = useQueryClient()

  const { data } = useOrdersBoardQuery({
    restaurantId: restaurant?._id,
    statusFilter,
    scope,
    floorNumber: appliedFloor,
  })

  const activeOrders = useMemo(() => data?.activeOrders || [], [data])
  const { data: tables = [] } = useTablesQuery({ restaurantId: restaurant?._id })
  const boardQueryKey = ['dashboard', 'orders-board', restaurant?._id]

  const restorePreviousBoards = (previousBoards = []) => {
    for (const [key, value] of previousBoards) {
      queryClient.setQueryData(key, value)
    }
  }

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

  const applyUpdatedOrderToBoard = (boardData, updatedOrder) => {
    if (!boardData || !updatedOrder) return boardData

    const orderId = String(updatedOrder._id || updatedOrder.id || '')
    const active = (boardData.activeOrders || []).map((order) => ({ ...order }))
    const activeIndex = active.findIndex((order) => String(order._id || order.id) === orderId)

    if (activeIndex >= 0) {
      active[activeIndex] = {
        ...active[activeIndex],
        ...updatedOrder,
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
      await queryClient.cancelQueries({ queryKey: boardQueryKey })
      const previousBoards = queryClient.getQueriesData({ queryKey: boardQueryKey })

      queryClient.setQueriesData({ queryKey: boardQueryKey }, (boardData) =>
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
        restorePreviousBoards(context.previousBoards)
      }
      setError(requestError?.response?.data?.message || 'Failed to update status')
    },
  })

  const markKotPrintedMutation = useMutation({
    mutationFn: ({ id, payload }) => orderService.markKotPrinted(id, payload),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: boardQueryKey })
      const previousBoards = queryClient.getQueriesData({ queryKey: boardQueryKey })

      queryClient.setQueriesData({ queryKey: boardQueryKey }, (boardData) =>
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
        restorePreviousBoards(context.previousBoards)
      }
      setError(requestError?.response?.data?.message || 'Failed to update KOT status')
    },
  })

  const markBillPrintedMutation = useMutation({
    mutationFn: ({ id, payload }) => orderService.markBillPrinted(id, payload),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: boardQueryKey })
      const previousBoards = queryClient.getQueriesData({ queryKey: boardQueryKey })

      queryClient.setQueriesData({ queryKey: boardQueryKey }, (boardData) =>
        applyUpdatedOrderToBoard(boardData, {
          _id: id,
          billPrinted: true,
          billPrintedAt: new Date().toISOString(),
        }),
      )

      return { previousBoards }
    },
    onSuccess: (updatedOrder) => {
      setError('')
      queryClient.setQueriesData({ queryKey: boardQueryKey }, (boardData) =>
        applyUpdatedOrderToBoard(boardData, updatedOrder),
      )
      refreshBoard()
    },
    onError: (requestError, _variables, context) => {
      if (context?.previousBoards) {
        restorePreviousBoards(context.previousBoards)
      }
      setError(requestError?.response?.data?.message || 'Failed to update bill print status')
    },
  })

  const shiftTableMutation = useMutation({
    mutationFn: (payload) => orderService.shiftTable(payload),
    onSuccess: () => {
      setError('')
      setShiftTargetOrder(null)
      setShiftFloorNumber('')
      setShiftTableNumber('')
      setShiftingTableKey('')
      refreshBoard()
    },
    onError: (requestError) => {
      setShiftingTableKey('')
      setError(requestError?.response?.data?.message || 'Failed to shift table')
    },
  })

  const onStatusChange = (id, status) => {
    if (!restaurant?._id) return
    updateStatusMutation.mutate({ id, status })
  }

  const onOpenShiftTable = (order) => {
    const sourceFloor = Number(order?.floorNumber || 1)
    setShiftTargetOrder(order)
    setShiftFloorNumber(String(sourceFloor))
    setShiftTableNumber('')
    setError('')
  }

  const onConfirmShiftTable = () => {
    if (!shiftTargetOrder) return

    const sourceFloorNumber = Number(shiftTargetOrder?.floorNumber || 1)
    const sourceTableNumber = Number(shiftTargetOrder?.tableNumber)
    const targetFloorNumber = Number(shiftFloorNumber)
    const targetTableNumber = Number(shiftTableNumber)

    if (!Number.isInteger(targetFloorNumber) || targetFloorNumber < 1 || !Number.isInteger(targetTableNumber) || targetTableNumber < 1) {
      setError('Enter a valid target floor and table number')
      return
    }

    if (sourceFloorNumber === targetFloorNumber && sourceTableNumber === targetTableNumber) {
      setError('Source and target table cannot be same')
      return
    }

    const targetExistsAndActive = tables.some((table) =>
      Number(table.floorNumber || 1) === targetFloorNumber &&
      Number(table.tableNumber) === targetTableNumber &&
      Boolean(table.active),
    )

    if (!targetExistsAndActive) {
      setError('Target table does not exist or is inactive')
      return
    }

    const key = `${sourceFloorNumber}:${sourceTableNumber}`
    setShiftingTableKey(key)
    setError('')
    shiftTableMutation.mutate({
      sourceFloorNumber,
      sourceTableNumber,
      targetFloorNumber,
      targetTableNumber,
    })
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

  return (
    <div className="space-y-5">
      {shiftTargetOrder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Shift Table Session</h3>
            <p className="mt-1 text-sm text-slate-600">
              Move all active orders from Floor {Number(shiftTargetOrder.floorNumber || 1)}, Table {Number(shiftTargetOrder.tableNumber)}.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span className="font-medium">Target Floor</span>
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={shiftFloorNumber}
                  onChange={(event) => setShiftFloorNumber(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span className="font-medium">Target Table</span>
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={shiftTableNumber}
                  onChange={(event) => setShiftTableNumber(event.target.value)}
                />
              </label>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShiftTargetOrder(null)
                  setShiftingTableKey('')
                }}
                disabled={shiftTableMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="button" onClick={onConfirmShiftTable} disabled={shiftTableMutation.isPending}>
                {shiftTableMutation.isPending ? 'Shifting...' : 'Confirm Shift'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
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
                onShiftTable={onOpenShiftTable}
                shiftingTableKey={shiftingTableKey}
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
