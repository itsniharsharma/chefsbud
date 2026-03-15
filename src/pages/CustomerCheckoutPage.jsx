import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Button from '../components/Button'
import CustomerBottomNav from '../components/CustomerBottomNav'
import { useCustomerCart } from '../hooks/useCustomerCart'
import { queryKeys } from '../lib/queryKeys'
import { offerService } from '../services/offerService'
import { paymentService } from '../services/paymentService'
import { formatCurrencyINR } from '../utils/currency'
import { buildCustomerMenuUrl, buildCustomerStatusUrl } from '../utils/customerUrl'

export default function CustomerCheckoutPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { restaurantSlug, tableNumber } = useParams()
  const [searchParams] = useSearchParams()
  const { getSession, removeItem, addItem, clearSession } = useCustomerCart()
  const [processingPayment, setProcessingPayment] = useState(false)
  const [confirmingPayment, setConfirmingPayment] = useState(false)
  const [message, setMessage] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [pendingCheckoutToken, setPendingCheckoutToken] = useState('')
  const [pendingPaymentUrl, setPendingPaymentUrl] = useState('')
  const [pricing, setPricing] = useState({ subtotalAmount: 0, discountTotal: 0, totalAmount: 0, appliedOffers: [] })

  const session = getSession(restaurantSlug, tableNumber)
  const cart = session.items
  const floorNumber = Number(searchParams.get('floor') || 1)

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart])

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

  const confirmPayment = async (tokenFromParam) => {
    const token = String(tokenFromParam || pendingCheckoutToken || '').trim()
    if (!token) {
      setMessage('Payment session expired. Please start checkout again.')
      return
    }

    setConfirmingPayment(true)
    setMessage('Confirming your payment...')

    try {
      const confirmation = await paymentService.confirmRazorpayMePayment({ checkoutToken: token })

      if (confirmation?.order) {
        seedCustomerOrderCaches(confirmation.order)
      }

      clearSession(restaurantSlug, tableNumber)
      setPendingCheckoutToken('')
      setMessage('Payment confirmed. Redirecting to your order...')
      setTimeout(() => {
        navigate(buildCustomerStatusUrl({ slug: restaurantSlug, tableNumber, floorNumber }))
      }, 900)
    } catch (requestError) {
      const errorMessage = requestError?.response?.data?.message || requestError?.message || 'Unable to confirm payment'
      setMessage(errorMessage)
    } finally {
      setConfirmingPayment(false)
    }
  }

  const payAndPlaceOrder = async () => {
    if (!cart.length) return

    setProcessingPayment(true)
    setMessage('')
    setPendingPaymentUrl('')

    // Pre-open a tab in direct click context to avoid popup blockers.
    const checkoutWindow = window.open('', '_blank', 'noopener,noreferrer')

    try {
      const intent = await paymentService.createRazorpayMeIntent({
        restaurantSlug,
        tableNumber: Number(tableNumber),
        floorNumber,
        couponCode,
        items: cart.map((item) => ({ menuItemId: item.menuItemId, quantity: item.quantity })),
      })

      if (!intent?.paymentUrl || !intent?.checkoutToken) {
        throw new Error('Unable to start payment session')
      }

      if (checkoutWindow && !checkoutWindow.closed) {
        checkoutWindow.location.href = intent.paymentUrl
      } else {
        setPendingPaymentUrl(intent.paymentUrl)
      }

      setPendingCheckoutToken(intent.checkoutToken)
      setMessage(
        checkoutWindow && !checkoutWindow.closed
          ? 'Payment page opened in a new tab. Complete payment, then click Confirm Payment below.'
          : 'Payment link is ready. Click Open Payment Link, complete payment, then click Confirm Payment below.',
      )
    } catch (requestError) {
      if (checkoutWindow && !checkoutWindow.closed) {
        checkoutWindow.close()
      }
      const errorMessage = requestError?.response?.data?.message || requestError?.message || 'Payment failed'
      setMessage(errorMessage)
    } finally {
      setProcessingPayment(false)
    }
  }

  return (
    <div className="customer-shell p-4 pb-32">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <p className="customer-page-title text-xs font-semibold uppercase">Secure Checkout</p>
          <h1 className="text-2xl font-bold text-gray-900">Complete Your Order</h1>
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
                    onClick={() => addItem(restaurantSlug, tableNumber, { _id: item.menuItemId, ...item })}
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
            onClick={payAndPlaceOrder}
            disabled={!cart.length || processingPayment || confirmingPayment}
          >
            {processingPayment ? 'Opening Payment Link...' : 'Pay & Place Order'}
          </Button>
          {pendingCheckoutToken ? (
            <Button
              className="w-full"
              variant="secondary"
              onClick={() => confirmPayment()}
              disabled={confirmingPayment || processingPayment}
            >
              {confirmingPayment ? 'Confirming Payment...' : 'I Have Paid, Confirm Now'}
            </Button>
          ) : null}
          {pendingPaymentUrl ? (
            <Button
              className="w-full"
              type="button"
              variant="secondary"
              onClick={() => window.open(pendingPaymentUrl, '_blank', 'noopener,noreferrer')}
              disabled={processingPayment || confirmingPayment}
            >
              Open Payment Link
            </Button>
          ) : null}
          <p className="pt-1 text-center text-xs royal-muted">Secure Razorpay checkout for this restaurant</p>
        </div>
      </div>

      <CustomerBottomNav restaurantSlug={restaurantSlug} tableNumber={tableNumber} floorNumber={floorNumber} />
    </div>
  )
}
