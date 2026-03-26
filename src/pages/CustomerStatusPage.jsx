import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Button from '../components/Button'
import CustomerBottomNav from '../components/CustomerBottomNav'
import { useCustomerTableOrdersQuery } from '../hooks/useCustomerOrderQueries'
import { formatCurrencyINR } from '../utils/currency'
import { buildCustomerMenuUrl, buildCustomerOrderTrackingUrl } from '../utils/customerUrl'
import { orderService } from '../services/orderService'

const statusTone = {
  Pending: 'border-amber-200 bg-amber-50 text-amber-700',
  Confirmed: 'border-rose-200 bg-rose-50 text-rose-700',
  Preparing: 'border-sky-200 bg-sky-50 text-sky-700',
  Ready: 'border-violet-200 bg-violet-50 text-violet-700',
  Served: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Completed: 'border-gray-200 bg-gray-50 text-gray-600',
}

function hasSubmittedRating(order) {
  const rating = Number(order?.customerRating)
  return Number.isInteger(rating) && rating >= 1 && rating <= 5
}

export default function CustomerStatusPage() {
  const navigate = useNavigate()
  const { restaurantSlug, tableNumber } = useParams()
  const [searchParams] = useSearchParams()
  const floorNumber = Number(searchParams.get('floor') || 1)
  const {
    data: orders = [],
    error,
    isLoading,
    isFetching,
    refetch,
  } = useCustomerTableOrdersQuery({ restaurantSlug, tableNumber })
  const [ratingInFlightOrderId, setRatingInFlightOrderId] = useState('')
  const [ratingFeedback, setRatingFeedback] = useState('')

  const activeOrders = useMemo(
    () => orders.filter((order) => !['Served', 'Completed'].includes(order.orderStatus)),
    [orders],
  )

  const errorMessage = error?.response?.data?.message || error?.message || ''

  const submitRating = async (orderId, rating) => {
    try {
      setRatingFeedback('')
      setRatingInFlightOrderId(String(orderId))
      await orderService.ratePublicOrder({
        restaurantSlug,
        tableNumber,
        orderId,
        rating,
      })
      await refetch()
      setRatingFeedback('Thanks for your feedback!')
    } catch (requestError) {
      setRatingFeedback(requestError?.response?.data?.message || 'Unable to submit rating right now')
    } finally {
      setRatingInFlightOrderId('')
    }
  }

  if (isLoading && !orders.length) {
    return <div className="customer-shell p-4 pb-32 text-sm royal-muted">Loading your orders...</div>
  }

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
          onClick={() => navigate(buildCustomerMenuUrl({ slug: restaurantSlug, tableNumber, floorNumber }))}
        >
          Back to Menu
        </Button>
      </header>

      {isFetching ? <p className="mb-3 text-xs royal-muted">Refreshing order status...</p> : null}
      {errorMessage ? <p className="mb-3 text-sm text-red-500">{errorMessage}</p> : null}
      {ratingFeedback ? <p className="mb-3 text-sm text-emerald-700">{ratingFeedback}</p> : null}

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
                        floorNumber,
                      }),
                    )
                  }
                >
                  View Details
                </Button>
              </div>

              {order.orderStatus === 'Completed' ? (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Order Feedback</p>
                  {hasSubmittedRating(order) ? (
                    <p className="mt-1 text-sm font-medium text-slate-700">Rated: {Number(order.customerRating)}/5</p>
                  ) : order.customerCanRate ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <button
                          key={`${order._id}-rating-${rating}`}
                          type="button"
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-100"
                          onClick={() => submitRating(order._id, rating)}
                          disabled={String(ratingInFlightOrderId || '') === String(order._id)}
                        >
                          {rating}★
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-slate-600">Feedback window closed.</p>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <CustomerBottomNav restaurantSlug={restaurantSlug} tableNumber={tableNumber} floorNumber={floorNumber} />
    </div>
  )
}