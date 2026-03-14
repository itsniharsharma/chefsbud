import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Button from '../components/Button'
import CustomerBottomNav from '../components/CustomerBottomNav'
import { useCustomerCart } from '../hooks/useCustomerCart'
import { orderService } from '../services/orderService'
import { offerService } from '../services/offerService'
import { formatCurrencyINR } from '../utils/currency'
import { buildCustomerMenuUrl, buildCustomerStatusUrl } from '../utils/customerUrl'

export default function CustomerCheckoutPage() {
  const navigate = useNavigate()
  const { restaurantSlug, tableNumber } = useParams()
  const { getSession, removeItem, addItem, setPaid, clearSession } = useCustomerCart()
  const [placing, setPlacing] = useState(false)
  const [message, setMessage] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [pricing, setPricing] = useState({ subtotalAmount: 0, discountTotal: 0, totalAmount: 0, appliedOffers: [] })

  const session = getSession(restaurantSlug, tableNumber)
  const cart = session.items
  const paid = session.paid

  const subtotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  }, [cart])

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

  const payWithDummy = () => {
    setMessage('Opening payment gateway...')
    setTimeout(() => {
      setPaid(restaurantSlug, tableNumber, true)
      setMessage('Payment successful')
    }, 700)
  }

  const placeOrder = async () => {
    if (!cart.length || !paid) return
    setPlacing(true)
    setMessage('')

    try {
      await orderService.create({
        restaurantSlug,
        tableNumber: Number(tableNumber),
        paymentStatus: 'Paid',
        couponCode,
        items: cart.map((item) => ({ menuItemId: item.menuItemId, quantity: item.quantity })),
      })

      clearSession(restaurantSlug, tableNumber)
      setMessage('Order placed successfully')
      setTimeout(() => {
        navigate(buildCustomerStatusUrl({ slug: restaurantSlug, tableNumber }))
      }, 900)
    } catch (requestError) {
      setMessage(requestError?.response?.data?.message || 'Failed to place order')
    } finally {
      setPlacing(false)
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
          onClick={() => navigate(buildCustomerMenuUrl({ slug: restaurantSlug, tableNumber }))}
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
          <Button className="royal-button-primary w-full" onClick={payWithDummy} disabled={!cart.length || paid}>
            {paid ? 'Payment Completed' : 'Pay Now'}
          </Button>
          <Button className="royal-button-secondary w-full" onClick={placeOrder} disabled={!cart.length || !paid || placing}>
            {placing ? 'Placing Order...' : 'Place Order'}
          </Button>
          <p className="pt-1 text-center text-xs royal-muted">Demo checkout enabled</p>
        </div>
      </div>

      <CustomerBottomNav restaurantSlug={restaurantSlug} tableNumber={tableNumber} />
    </div>
  )
}
