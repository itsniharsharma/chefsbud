import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Button from '../components/Button'
import CustomerBottomNav from '../components/CustomerBottomNav'
import { useCustomerCart } from '../hooks/useCustomerCart'
import { queryKeys } from '../lib/queryKeys'
import { offerService } from '../services/offerService'
import { orderService } from '../services/orderService'
import { formatCurrencyINR } from '../utils/currency'
import { trackAddToCartReliable } from '../services/analyticsCaptureService'
import { createCustomerAnalyticsEventId } from '../utils/customerAnalytics'
import { buildCustomerMenuUrl, buildCustomerStatusUrl } from '../utils/customerUrl'

export default function CustomerCheckoutPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { restaurantSlug, tableNumber } = useParams()
  const [searchParams] = useSearchParams()
  const { getSession, removeItem, addItem, clearSession } = useCustomerCart()
  const [placingOrder, setPlacingOrder] = useState(false)
  const [message, setMessage] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [customerNote, setCustomerNote] = useState('')
  const [pricing, setPricing] = useState({ subtotalAmount: 0, discountTotal: 0, totalAmount: 0, appliedOffers: [] })

  const session = getSession(restaurantSlug, tableNumber)
  const cart = session.items
  const rawFloorParam = searchParams.get('floor')
  const parsedFloorNumber = Number(rawFloorParam)
  const floorNumber = Number.isFinite(parsedFloorNumber) && parsedFloorNumber >= 1
    ? Math.floor(parsedFloorNumber)
    : 1

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart])

  const idempotencyKey = useMemo(() => {
    const normalizedItems = cart
      .map((item) => `${String(item.menuItemId || '').trim()}:${Number(item.quantity || 0)}`)
      .sort()
      .join('|')
    const fingerprint = [
      restaurantSlug,
      tableNumber,
      floorNumber,
      couponCode.trim().toUpperCase(),
      customerNote.trim().slice(0, 500),
      normalizedItems,
    ].join('::')

    let hash = 2166136261
    for (let index = 0; index < fingerprint.length; index += 1) {
      hash ^= fingerprint.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }

    return `cust-order-${(hash >>> 0).toString(16)}`
  }, [cart, couponCode, customerNote, floorNumber, restaurantSlug, tableNumber])

  useEffect(() => {
    if (!cart.length) {
      setPricing({ subtotalAmount: 0, discountTotal: 0, totalAmount: 0, appliedOffers: [] })
      return
    }

    offerService
      .preview(restaurantSlug, {
        items: cart.map((item) => ({ menuItemId: item.menuItemId, quantity: item.quantity })),
        couponCode,
      })
      .then((preview) => {
        setPricing(preview)
      })
      .catch(() => {
        setPricing({ subtotalAmount: subtotal, discountTotal: 0, totalAmount: subtotal, appliedOffers: [] })
      })
  }, [cart, couponCode, restaurantSlug, subtotal])

  const seedCustomerOrderCaches = (order) => {
    if (!order?._id) return

    const tableOrdersKey = queryKeys.customer.tableOrders(restaurantSlug, tableNumber)
    const orderStatusKey = queryKeys.customer.orderStatus(restaurantSlug, tableNumber, order._id)

    queryClient.setQueryData(tableOrdersKey, (existingOrders) => {
      const normalizedOrders = Array.isArray(existingOrders) ? existingOrders : []
      const withoutCurrent = normalizedOrders.filter((entry) => String(entry?._id) !== String(order._id))
      return [order, ...withoutCurrent]
    })
    queryClient.setQueryData(orderStatusKey, order)
  }

  const placeOrder = async () => {
    if (!cart.length) return

    setPlacingOrder(true)
    setMessage('')

    try {
      const parsedTableNumber = Number(tableNumber)
      if (!Number.isFinite(parsedTableNumber) || parsedTableNumber < 1) {
        setMessage('Invalid table reference in QR/session. Please rescan the QR code and try again.')
        return
      }

      const normalizedItems = cart
        .map((item) => ({
          menuItemId: String(item?.menuItemId || '').trim(),
          quantity: Math.floor(Number(item?.quantity || 0)),
        }))
        .filter((item) => /^[a-fA-F0-9]{24}$/.test(item.menuItemId) && item.quantity >= 1)

      if (!normalizedItems.length) {
        setMessage('Your cart contains invalid items. Please go back, refresh menu, and add items again.')
        return
      }

      const order = await orderService.create({
        restaurantSlug,
        tableNumber: Math.floor(parsedTableNumber),
        floorNumber,
        couponCode,
        customerNote,
        idempotencyKey,
        items: normalizedItems,
      })

      if (order?._id) {
        seedCustomerOrderCaches(order)
      }

      clearSession(restaurantSlug, tableNumber)
      setMessage('Order placed successfully. Redirecting...')
      setTimeout(() => {
        navigate(buildCustomerStatusUrl({ slug: restaurantSlug, tableNumber, floorNumber }))
      }, 900)
    } catch (requestError) {
      const backendErrors = Array.isArray(requestError?.response?.data?.errors)
        ? requestError.response.data.errors
        : []
      const firstBackendError = backendErrors[0]
      const backendField = String(firstBackendError?.path || '').trim()
      const backendDetail = String(firstBackendError?.msg || '').trim()
      const detailedMessage = backendField && backendDetail
        ? `${backendField}: ${backendDetail}`
        : backendDetail
      const errorMessage = detailedMessage || requestError?.response?.data?.message || requestError?.message || 'Unable to place order'
      setMessage(errorMessage)
    } finally {
      setPlacingOrder(false)
    }
  }

  const trackAddToCart = (item) => {
    addItem(restaurantSlug, tableNumber, { _id: item.menuItemId, ...item })
    trackAddToCartReliable({
      restaurantSlug,
      eventId: createCustomerAnalyticsEventId({
        prefix: 'add-to-cart',
        restaurantSlug,
        tableNumber,
        menuItemId: item.menuItemId,
      }),
      menuItemId: item.menuItemId,
      quantity: 1,
    })
  }

  return (
    <div className="customer-shell p-4 pb-32">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <p className="customer-page-title text-xs font-semibold uppercase">Checkout</p>
          <h1 className="text-2xl font-bold text-gray-900">Review and Place Order</h1>
        </div>
        <Button
          variant="secondary"
          className="royal-button-secondary"
          onClick={() => navigate(buildCustomerMenuUrl({ slug: restaurantSlug, tableNumber, floorNumber }))}
        >
          Back
        </Button>
      </header>

      <div className="lux-card royal-reveal flex flex-col gap-0 p-4 md:p-5">
        <p className="text-sm royal-muted">Table {tableNumber}</p>
        <h2 className="mt-1 text-lg font-semibold text-gray-900">Your Cart</h2>

        {!cart.length ? (
          <p className="mt-3 text-sm royal-muted">Cart is empty.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {cart.map((item) => (
              <div key={item.menuItemId} className="rounded-xl border border-gray-200 bg-gray-50 p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{item.name}</p>
                    <p className="text-sm royal-muted">{formatCurrencyINR(item.price)} each</p>
                  </div>
                  <p className="font-semibold royal-highlight">{formatCurrencyINR(item.price * item.quantity)}</p>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    className="h-8 w-8 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100"
                    onClick={() => removeItem(restaurantSlug, tableNumber, item.menuItemId)}
                  >
                    -
                  </button>
                  <span className="min-w-6 text-center text-sm font-semibold text-gray-900">{item.quantity}</span>
                  <button
                    className="h-8 w-8 rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                    onClick={() => trackAddToCart(item)}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="customer-glass mt-4 rounded-xl p-3">
          <p className="text-sm royal-muted">Subtotal</p>
          <p className="text-base font-semibold text-gray-800">{formatCurrencyINR(pricing.subtotalAmount ?? subtotal)}</p>
          <p className="mt-1 text-sm royal-muted">Discount</p>
          <p className="text-base font-semibold text-emerald-600">- {formatCurrencyINR(pricing.discountTotal || 0)}</p>
          <p className="mt-1 text-sm royal-muted">Total</p>
          <p className="text-xl font-bold royal-highlight">{formatCurrencyINR(pricing.totalAmount ?? subtotal)}</p>
          <p className="mt-1 text-xs royal-muted">Includes all selected items for table {tableNumber}</p>
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-medium text-gray-800">Coupon Code (optional)</span>
          <input
            className="input bg-white/95"
            value={couponCode}
            onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
            placeholder="Enter coupon code"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-medium text-gray-800">Note for Kitchen (optional)</span>
          <textarea
            className="input min-h-[88px] bg-white/95"
            value={customerNote}
            onChange={(event) => setCustomerNote(event.target.value.slice(0, 500))}
            placeholder="Example: less spicy, no onion"
          />
          <p className="mt-1 text-xs royal-muted">{customerNote.length}/500</p>
        </label>

        {Array.isArray(pricing.appliedOffers) && pricing.appliedOffers.length ? (
          <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
            <p className="font-semibold text-gray-900">Applied Offers</p>
            {pricing.appliedOffers.map((offer) => (
              <p key={`${offer.offerId}-${offer.description}`} className="royal-muted">
                {offer.description} • Saved {formatCurrencyINR(offer.discountAmount)}
              </p>
            ))}
          </div>
        ) : null}

        {message && <p className="mt-3 text-sm royal-highlight">{message}</p>}

        <div className="mt-4 space-y-2">
          <Button
            className="royal-button-primary w-full"
            onClick={placeOrder}
            disabled={!cart.length || placingOrder}
          >
            {placingOrder ? 'Placing Order...' : 'Place Order'}
          </Button>
          <p className="pt-1 text-center text-xs royal-muted">Pay directly at the restaurant counter</p>
        </div>
      </div>

      <CustomerBottomNav restaurantSlug={restaurantSlug} tableNumber={tableNumber} floorNumber={floorNumber} />
    </div>
  )
}
