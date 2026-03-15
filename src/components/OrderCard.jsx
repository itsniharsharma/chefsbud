import { memo } from 'react'
import Button from './Button'
import { formatCurrencyINR } from '../utils/currency'

const statuses = ['Confirmed', 'Preparing', 'Ready', 'Served', 'Completed']

function OrderCard({ order, onStatusChange, onPrintKot, printingKotOrderId, showStatusActions = true }) {
  const orderId = order._id || order.id
  const label = order.orderStatus || order.status
  const total = order.totalAmount ?? order.total ?? 0
  const floorNumber = Number(order.floorNumber || 1)
  const isKotPrinted = Boolean(order.kotPrinted)
  const isPrintingKot = String(printingKotOrderId || '') === String(orderId)
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
          variant={isKotPrinted ? 'secondary' : 'primary'}
          className={isKotPrinted ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-400' : ''}
          onClick={() => onPrintKot?.(order)}
          disabled={isPrintingKot}
        >
          {isPrintingKot ? 'Printing KOT...' : isKotPrinted ? 'KOT Printed' : 'Print KOT'}
        </Button>
      </div>
      {showStatusActions ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {statuses.map((status) => (
            <Button
              key={status}
              variant={label === status ? 'primary' : 'secondary'}
              className="px-3 py-1 text-xs"
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
