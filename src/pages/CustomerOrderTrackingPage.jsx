import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Button from '../components/Button'
import CustomerBottomNav from '../components/CustomerBottomNav'
import { orderService } from '../services/orderService'
import { formatCurrencyINR } from '../utils/currency'
import { buildCustomerStatusUrl } from '../utils/customerUrl'

const steps = ['Pending', 'Preparing', 'Ready', 'Served', 'Completed']

export default function CustomerOrderTrackingPage() {
  const navigate = useNavigate()
  const { restaurantSlug, tableNumber, orderId } = useParams()
  const [order, setOrder] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const fetchStatus = () => {
      orderService
        .track(restaurantSlug, tableNumber, orderId)
        .then((data) => {
          if (!active) return
          setOrder(data)
          setError('')
        })
        .catch((requestError) => {
          if (!active) return
          setError(requestError?.response?.data?.message || 'Unable to fetch order status')
        })
    }

    fetchStatus()
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchStatus()
      }
    }, 8000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [restaurantSlug, tableNumber, orderId])

  const currentIndex = order?.orderStatus ? Math.max(0, steps.indexOf(order.orderStatus)) : 0

  return (
    <div className="customer-shell p-4 pb-32">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <p className="customer-page-title text-xs font-semibold uppercase">Live Status</p>
          <h1 className="text-2xl font-bold text-white">Track Your Order</h1>
        </div>
        <Button
          variant="secondary"
          className="royal-button-secondary"
          onClick={() => navigate(buildCustomerStatusUrl({ slug: restaurantSlug, tableNumber }))}
        >
          Back to Status
        </Button>
      </header>

      <div className="lux-card royal-reveal p-4 md:p-5">
        <p className="text-sm royal-muted">Order ID: {orderId}</p>
        <p className="text-sm royal-muted">Table {tableNumber}</p>

        {error && <p className="mt-2 text-sm text-amber-200">{error}</p>}

        <div className="mt-4 grid gap-2">
          {steps.map((step, index) => {
            const active = index <= currentIndex
            return (
              <div
                key={step}
                className={`status-step px-3 py-2 text-sm ${active ? 'active' : ''}`}
              >
                {step}
              </div>
            )
          })}
        </div>

        {order && (
          <div className="customer-glass mt-4 rounded-xl p-3">
            <p className="text-sm royal-muted">Current Status</p>
            <p className="text-lg font-semibold royal-highlight">{order.orderStatus}</p>
            <p className="mt-1 text-sm royal-muted">Payment: {order.paymentStatus}</p>
            <p className="mt-1 text-sm royal-muted">Subtotal: {formatCurrencyINR(order.subtotalAmount || order.totalAmount)}</p>
            <p className="mt-1 text-sm text-emerald-300">Discount: - {formatCurrencyINR(order.discountTotal || 0)}</p>
            {order.couponCode ? <p className="mt-1 text-sm royal-muted">Coupon: {order.couponCode}</p> : null}
            <p className="mt-1 text-sm font-semibold text-amber-50">Total: {formatCurrencyINR(order.totalAmount)}</p>
          </div>
        )}
      </div>

      <CustomerBottomNav restaurantSlug={restaurantSlug} tableNumber={tableNumber} />
    </div>
  )
}
