import { useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import BillPrintModal from '../components/BillPrintModal'
import OrderCard from '../components/OrderCard'
import Button from '../components/Button'
import KotReprintModal from '../components/KotReprintModal'
import ManualOrderPanel from '../components/ManualOrderPanel'
import { orderService } from '../services/orderService'
import { playOrderAlertSound } from '../services/orderAlertAudio'
import { useAuth } from '../hooks/useAuth'
import { useOrdersBoardQuery, useTablesQuery, useMenuQuery } from '../hooks/useDashboardQueries'
import { queryKeys } from '../lib/queryKeys'
import { buildCombinedBillKotHtml, closePrintWindow, openPrintWindow, printIntoWindow } from '../utils/orderPrint'
import { applyBillDiscountToOrder, buildBillPrintPayload, buildReprintOrderForBill } from '../utils/billPrintFlow'

export default function OrdersPage() {
  const { restaurant } = useAuth()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState('')
  const [shiftTargetOrder, setShiftTargetOrder] = useState(null)
  const [shiftFloorNumber, setShiftFloorNumber] = useState('')
  const [shiftTableNumber, setShiftTableNumber] = useState('')
  const [shiftingTableKey, setShiftingTableKey] = useState('')
  const [printingCombinedOrderId, setPrintingCombinedOrderId] = useState('')
  const [statusActionBusy, setStatusActionBusy] = useState(false)
  const [manualRefreshPending, setManualRefreshPending] = useState(false)
  const [billTargetOrder, setBillTargetOrder] = useState(null)
  const [reprintTargetOrder, setReprintTargetOrder] = useState(null)
  const [pendingCombinedPrint, setPendingCombinedPrint] = useState(null)
  const statusMutationLockRef = useRef(false)
  const queryClient = useQueryClient()

  const { data, isFetching: isBoardRefreshing } = useOrdersBoardQuery({
    restaurantId: restaurant?._id,
    statusFilter: 'All',
    scope: 'All',
  })

  const activeOrders = useMemo(() => data?.activeOrders || [], [data])
  const { data: tables = [] } = useTablesQuery({ restaurantId: restaurant?._id })
  const { data: menu } = useMenuQuery({ restaurantId: restaurant?._id })
  const boardQueryKey = ['dashboard', 'orders-board', restaurant?._id]
  const sidebarCategoryId = String(searchParams.get('category') || '').trim()

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

  const forceRefreshOrders = async () => {
    if (!restaurant?._id) return

    setManualRefreshPending(true)
    try {
      const [activeOrders, recentOrders] = await Promise.all([
        orderService.listBoard(restaurant._id, { status: 'All', scope: 'all', refresh: '1' }),
        orderService.list(restaurant._id, { view: 'completed', scope: 'all', limit: 200, refresh: '1' }),
      ])

      queryClient.setQueryData(
        queryKeys.dashboard.ordersBoard(restaurant._id, 'All', 'All'),
        activeOrders,
      )
      queryClient.setQueryData(
        queryKeys.dashboard.recentOrders(restaurant._id, 'All'),
        Array.isArray(recentOrders) ? recentOrders : [],
      )
    } finally {
      setManualRefreshPending(false)
    }
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
    onSettled: () => {
      statusMutationLockRef.current = false
      setStatusActionBusy(false)
    },
  })

  const markPrintBundleMutation = useMutation({
    mutationFn: ({ id, payload }) => orderService.markPrintBundle(id, payload),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: boardQueryKey })
      const previousBoards = queryClient.getQueriesData({ queryKey: boardQueryKey })

      queryClient.setQueriesData({ queryKey: boardQueryKey }, (boardData) =>
        applyUpdatedOrderToBoard(boardData, {
          _id: id,
          billPrinted: true,
          billPrintedAt: new Date().toISOString(),
          kotPrinted: true,
          kotPrintedAt: new Date().toISOString(),
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
      setError(requestError?.response?.data?.message || 'Failed to update print status')
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
    if (statusMutationLockRef.current || updateStatusMutation.isPending) return

    statusMutationLockRef.current = true
    setStatusActionBusy(true)
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

  const onManualOrderCreated = async () => {
    await playOrderAlertSound()
    await refreshBoard()
  }

  const printCombinedForOrder = async (order, options = {}) => {
    const orderId = String(order?._id || order?.id || '')
    if (!orderId || !restaurant?._id) return
    if (printingCombinedOrderId && printingCombinedOrderId === orderId) return

    const confirmed = Boolean(options?.confirmed)
    const billPayload = buildBillPrintPayload(options)
    const kotPayload = options?.reprintPasskey
      ? {
          reprintPasskey: String(options.reprintPasskey || ''),
          reprintReason: String(options.reprintReason || ''),
        }
      : {}

    if (!confirmed) {
      setBillTargetOrder(order)
      return
    }

    if (order?.kotPrinted && !kotPayload.reprintPasskey) {
      setPendingCombinedPrint({
        order,
        billPayload,
      })
      setReprintTargetOrder(order)
      return
    }

    let printWindow = null
    setPrintingCombinedOrderId(orderId)
    setError('')

    try {
      printWindow = openPrintWindow({
        title: 'Bill + KOT',
        features: 'width=900,height=800',
      })

      let orderForPrint
      const bundlePayload = order?.billPrinted
        ? kotPayload
        : { ...billPayload, ...kotPayload }

      if (order?.billPrinted) {
        orderForPrint = buildReprintOrderForBill({
          order,
          billAdjustments: billPayload.billAdjustments,
          billDiscountPercent: billPayload.billDiscountPercent,
        })
      } else {
        const savedOrder = await markPrintBundleMutation.mutateAsync({ id: orderId, payload: bundlePayload })
        orderForPrint = applyBillDiscountToOrder({
          order: savedOrder,
          billDiscountPercent: billPayload.billDiscountPercent,
        })
      }

      if (order?.billPrinted) {
        await markPrintBundleMutation.mutateAsync({ id: orderId, payload: bundlePayload })
      }
      printIntoWindow(printWindow, buildCombinedBillKotHtml({ order: orderForPrint, restaurant }))
      setBillTargetOrder(null)
      setReprintTargetOrder(null)
      setPendingCombinedPrint(null)
    } catch (requestError) {
      closePrintWindow(printWindow)
      setError(requestError?.message || requestError?.response?.data?.message || 'Unable to print bill and KOT')
    } finally {
      setPrintingCombinedOrderId('')
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
        printing={Boolean(printingCombinedOrderId)}
        onClose={() => {
          setBillTargetOrder(null)
          setPendingCombinedPrint(null)
        }}
        onSimplePrint={(payload) => printCombinedForOrder(billTargetOrder, { confirmed: true, ...(payload || {}) })}
        onPrintWithAdjustments={(payload) => printCombinedForOrder(billTargetOrder, { confirmed: true, ...payload })}
      />
      <KotReprintModal
        open={Boolean(reprintTargetOrder)}
        order={reprintTargetOrder}
        hasPasskey={Boolean(restaurant?.hasKotReprintPasskey)}
        loading={Boolean(printingCombinedOrderId)}
        onClose={() => {
          setReprintTargetOrder(null)
          setPendingCombinedPrint(null)
        }}
        onConfirm={(payload) => {
          if (!pendingCombinedPrint?.order) return
          printCombinedForOrder(pendingCombinedPrint.order, {
            confirmed: true,
            ...pendingCombinedPrint.billPayload,
            ...(payload || {}),
          })
        }}
      />
      {error && <p className="text-sm text-[var(--primary)]">{error}</p>}
      <div className="h-[calc(100vh-150px)] min-h-[780px]">
        <ManualOrderPanel
          restaurantId={restaurant?._id}
          restaurantSlug={restaurant?.slug}
          menu={menu}
          tables={tables}
          onOrderCreated={onManualOrderCreated}
          onRefreshOrders={forceRefreshOrders}
          refreshingOrders={isBoardRefreshing || manualRefreshPending}
          externalActiveCategory={sidebarCategoryId}
          qrOrdersPanel={
            activeOrders.length ? (
              <div className="grid grid-cols-1 gap-3">
                {activeOrders.map((order) => (
                  <OrderCard
                    key={order._id || order.id}
                    order={order}
                    onStatusChange={onStatusChange}
                    onShiftTable={onOpenShiftTable}
                    shiftingTableKey={shiftingTableKey}
                    onPrintCombined={printCombinedForOrder}
                    printingCombinedOrderId={printingCombinedOrderId}
                    statusActionDisabled={statusActionBusy || updateStatusMutation.isPending}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500"> All orders will appear here.</p>
            )
          }
        />
      </div>
    </div>
  )
}
