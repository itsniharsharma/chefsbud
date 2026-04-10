import { memo } from 'react'
import Button from './Button'
import { formatCurrencyINR } from '../utils/currency'

const statuses = ['Preparing', 'Served', 'Completed']

function OrderCard({
  order,
  onStatusChange,
  onPrintBill,
  onPrintKot,
  onShiftTable,
  shiftingTableKey,
  printingBillOrderId,
  printingKotOrderId,
  showStatusActions = true,
  statusActionDisabled = false,
}) {
  const orderId = order._id || order.id
  const label = order.orderStatus || order.status
  const total = order.billFinalTotalAmount ?? order.totalAmount ?? order.total ?? 0
  const floorNumber = Number(order.floorNumber || 1)
  const isKotPrinted = Boolean(order.kotPrinted)
  const isBillPrinted = Boolean(order.billPrinted)
  const isPrintingBill = String(printingBillOrderId || '') === String(orderId)
  const isPrintingKot = String(printingKotOrderId || '') === String(orderId)
  const tableKey = `${floorNumber}:${Number(order.tableNumber || 0)}`
  const isShifting = String(shiftingTableKey || '') === tableKey
  const itemText = Array.isArray(order.items)
    ? order.items
        .map((item) => {
          if (typeof item === 'string') return item
          const quantity = item.quantity || 1
          return `${item.name} x${quantity}`
        })
        .join(', ')
    : ''

  const createdTime = order.createdAt ? new Date(order.createdAt).toLocaleTimeString() : '-'

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-semibold text-slate-800">{orderId}</p>
        <span className="text-sm text-slate-500">{createdTime}</span>
      </div>
      <p className="text-sm text-slate-600">Floor: {floorNumber} | Table: {order.tableNumber}</p>
      <p className="mt-2 text-sm text-slate-600">Items: {itemText}</p>
      {order.customerNote ? <p className="mt-2 text-sm text-slate-700">Note: {order.customerNote}</p> : null}
      <p className="mt-2 font-semibold text-[var(--primary)]">{formatCurrencyINR(total)}</p>
      <div className="mt-2 flex gap-4 text-sm text-slate-600">
        <span>Payment: {order.paymentStatus}</span>
        <span>Status: {label}</span>
      </div>
      <div className="mt-3">
        <Button
          type="button"
          variant="secondary"
          className="mr-2 border border-slate-300 bg-slate-50 text-slate-700 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-100 hover:shadow-md"
          onClick={() => onShiftTable?.(order)}
          disabled={isShifting}
        >
          {isShifting ? 'Shifting...' : 'Shift Table'}
        </Button>
        <Button
          type="button"
          variant="custom"
          className={
            isBillPrinted
              ? 'mr-2 border border-emerald-300 bg-emerald-50 text-emerald-700 hover:-translate-y-0.5 hover:border-emerald-400 hover:bg-emerald-100 hover:shadow-md'
              : 'mr-2 border border-red-300 bg-red-50 text-red-700 hover:-translate-y-0.5 hover:border-red-400 hover:bg-red-100 hover:shadow-md'
          }
          onClick={() => onPrintBill?.(order)}
          disabled={isPrintingBill}
        >
          {isPrintingBill ? 'Printing Bill...' : 'Print Bill'}
        </Button>
        <Button
          type="button"
          variant="custom"
          className={
            isKotPrinted
              ? 'border border-emerald-300 bg-emerald-50 text-emerald-700 hover:-translate-y-0.5 hover:border-emerald-400 hover:bg-emerald-100 hover:shadow-md'
              : 'border border-red-300 bg-red-50 text-red-700 hover:-translate-y-0.5 hover:border-red-400 hover:bg-red-100 hover:shadow-md'
          }
          onClick={() => onPrintKot?.(order)}
          disabled={isPrintingKot}
        >
          {isPrintingKot ? 'Printing KOT...' : 'Print KOT'}
        </Button>
      </div>
      {showStatusActions ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {statuses.map((status) => (
            <Button
              key={status}
              variant={label === status ? 'primary' : 'secondary'}
              className="px-3 py-1 text-xs"
              disabled={statusActionDisabled || label === status}
              onClick={() => onStatusChange(orderId, status)}
            >
              {status}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default memo(OrderCard)
