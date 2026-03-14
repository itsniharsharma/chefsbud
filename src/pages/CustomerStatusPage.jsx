import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Button from '../components/Button'
import CustomerBottomNav from '../components/CustomerBottomNav'
import { orderService } from '../services/orderService'
import { formatCurrencyINR } from '../utils/currency'
import { buildCustomerMenuUrl, buildCustomerOrderTrackingUrl } from '../utils/customerUrl'

const statusTone = {
  Pending: 'border-amber-200 bg-amber-50 text-amber-700',
  Preparing: 'border-sky-200 bg-sky-50 text-sky-700',
  Ready: 'border-violet-200 bg-violet-50 text-violet-700',
  Served: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Completed: 'border-gray-200 bg-gray-50 text-gray-600',
}

export default function CustomerStatusPage() {
  const navigate = useNavigate()
  const { restaurantSlug, tableNumber } = useParams()
  const [orders, setOrders] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const fetchOrders = () => {
      orderService
        .trackTable(restaurantSlug, tableNumber)
        .then((data) => {
          if (!active) return
          setOrders(data)
          setError('')
        })
        .catch((requestError) => {
          if (!active) return
          setError(requestError?.response?.data?.message || 'Unable to load order statuses')
        })
    }

    fetchOrders()
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchOrders()
      }
    }, 8000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [restaurantSlug, tableNumber])

  const activeOrders = useMemo(
    () => orders.filter((order) => !['Served', 'Completed'].includes(order.orderStatus)),
    [orders],
  )

  return (
    <div className="customer-shell p-4 pb-32">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <p className="customer-page-title text-xs font-semibold uppercase">Order Status Board</p>
          <h1 className="text-2xl font-bold text-gray-900">Your Orders</h1>
          <p className="text-sm royal-muted">Table {tableNumber} • Live updates every 8s</p>
        </div>
        <Button
          variant="secondary"
          className="royal-button-secondary"
          onClick={() => navigate(buildCustomerMenuUrl({ slug: restaurantSlug, tableNumber }))}
        >
          Back to Menu
        </Button>
      </header>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="customer-kpi p-3">
          <p className="text-xs uppercase tracking-wider royal-muted">Total Orders</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{orders.length}</p>
        </div>
        <div className="customer-kpi p-3">
          <p className="text-xs uppercase tracking-wider royal-muted">Active Orders</p>
          <p className="mt-1 text-2xl font-bold royal-highlight">{activeOrders.length}</p>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="lux-card p-4 text-sm royal-muted">No orders found for this table yet.</div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <div key={order._id} className="lux-card royal-reveal royal-reveal-delay-1 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Order #{order._id.slice(-6).toUpperCase()}</p>
                  <p className="text-xs royal-muted">{new Date(order.createdAt).toLocaleString()}</p>
                </div>
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    statusTone[order.orderStatus] || 'border-gray-200 bg-gray-50 text-gray-600'
                  }`}
                >
                  {order.orderStatus}
                </span>
              </div>

              <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-2 text-sm text-gray-800">
                {order.items.map((item) => (
                  <p key={`${order._id}-${item.menuItemId}`}>{item.name} x{item.quantity}</p>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between">
                <div>
                  {order.discountTotal > 0 ? (
                    <p className="text-xs text-emerald-600">
                      Saved {formatCurrencyINR(order.discountTotal)}{order.couponCode ? ` using ${order.couponCode}` : ''}
                    </p>
                  ) : null}
                  <p className="text-sm font-semibold text-gray-900">Total: {formatCurrencyINR(order.totalAmount)}</p>
                </div>
                <Button
                  variant="secondary"
                  className="royal-button-secondary"
                  onClick={() =>
                    navigate(
                      buildCustomerOrderTrackingUrl({
                        slug: restaurantSlug,
                        tableNumber,
                        orderId: order._id,
                      }),
                    )
                  }
                >
                  View Details
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CustomerBottomNav restaurantSlug={restaurantSlug} tableNumber={tableNumber} />
    </div>
  )
}