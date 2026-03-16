import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import MarketingHeader from '../components/MarketingHeader'
import { useAuth } from '../hooks/useAuth'
import { paymentService } from '../services/paymentService'

const features = [
  'Complete owner dashboard (menu, orders, tables, analytics)',
  'QR-based customer ordering and checkout flow',
  'AI-powered menu parsing and import support',
  'Offers, billing, and real-time order tracking',
  'Multi-tenant data separation and JWT auth',
]

function loadRazorpayCheckoutScript() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve(window.Razorpay)
      return
    }

    const existing = document.querySelector('script[data-razorpay-checkout="true"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Razorpay), { once: true })
      existing.addEventListener('error', () => reject(new Error('Failed to load Razorpay SDK')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.dataset.razorpayCheckout = 'true'
    script.onload = () => resolve(window.Razorpay)
    script.onerror = () => reject(new Error('Failed to load Razorpay SDK'))
    document.body.appendChild(script)
  })
}

function openRazorpay(options) {
  return new Promise((resolve, reject) => {
    let settled = false

    const checkout = new window.Razorpay({
      ...options,
      modal: {
        ondismiss: () => {
          if (settled) return
          settled = true
          reject(new Error('Checkout cancelled'))
        },
      },
      handler: (response) => {
        if (settled) return
        settled = true
        resolve(response)
      },
    })

    checkout.on('payment.failed', (event) => {
      if (settled) return
      settled = true
      const reason = event?.error?.description || 'Payment failed'
      reject(new Error(reason))
    })

    try {
      checkout.open()
    } catch (error) {
      if (settled) return
      settled = true
      reject(error)
    }
  })
}

export default function PricingPage() {
  const navigate = useNavigate()
  const { user, restaurant, isAuthenticated, logout } = useAuth()
  const [activePlan, setActivePlan] = useState('')
  const [error, setError] = useState('')

  const prefill = useMemo(
    () => ({
      name: user?.name || '',
      email: user?.email || '',
      contact: restaurant?.phone || '',
    }),
    [user?.email, user?.name, restaurant?.phone],
  )

  const redirectToLoginAfterPayment = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const hasSetupPaid = user?.billing?.planType === 'hybrid' && user?.billing?.status === 'setup_paid'

  const activateHybrid = async () => {
    if (!isAuthenticated) {
      navigate('/register')
      return
    }

    setError('')
    setActivePlan('hybrid')

    try {
      await loadRazorpayCheckoutScript()

      // If setup has already been paid, resume directly from autopay authorization.
      if (!hasSetupPaid) {
        const setupCheckout = await paymentService.createCheckout('hybrid')
        const setupResponse = await openRazorpay({
          key: setupCheckout.keyId,
          amount: setupCheckout.amount,
          currency: setupCheckout.currency,
          name: "Chef's Bud",
          description: 'Business plan setup amount',
          order_id: setupCheckout.orderId,
          prefill,
          theme: { color: '#e50914' },
        })

        await paymentService.verifyCheckout({
          plan: 'hybrid',
          ...setupResponse,
        })
      }

      const subscriptionCheckout = await paymentService.createHybridSubscription()
      const subscriptionResponse = await openRazorpay({
        key: subscriptionCheckout.keyId,
        subscription_id: subscriptionCheckout.subscriptionId,
        name: "Chef's Bud",
        description: 'Business plan - Rs 999 monthly auto-payment',
        prefill,
        retry: {
          enabled: true,
        },
        theme: { color: '#e50914' },
      })

      await paymentService.verifyHybridSubscription(subscriptionResponse)
      redirectToLoginAfterPayment()
    } catch (requestError) {
      const message = requestError?.response?.data?.message || requestError.message || 'Unable to activate hybrid plan'
      if (message === 'Checkout cancelled') {
        setError('Checkout was closed before completion. Please finish both steps: setup payment and monthly autopay authorization.')
      } else {
        setError(message)
      }
    } finally {
      setActivePlan('')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-rose-50">
      <MarketingHeader />

      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-600">Choose Your Plan</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900 md:text-4xl">Unlock Chef&apos;s Bud for your business</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-600 md:text-base">
            Complete your payment to start using all features. Both plans include the same product access and support.
          </p>
          {!isAuthenticated ? (
            <p className="mt-2 text-sm text-slate-600">Create an owner account first, then choose your plan.</p>
          ) : null}
          {error ? <p className="mt-3 text-sm font-medium text-[var(--primary)]">{error}</p> : null}
        </div>

        <div className="grid grid-cols-1 gap-5">
          <section className="card relative mx-auto flex h-full w-full max-w-2xl flex-col border-rose-200 p-6">
            <span className="absolute right-4 top-4 rounded-full bg-rose-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-rose-700">
              Required Auto-Pay
            </span>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Business Plan</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">Rs 12,999 + Rs 999/month</h2>
            <p className="mt-1 text-sm text-slate-600">
              Step 1: pay Rs 12,999 setup. Step 2: approve Rs 999 monthly autopay. Access is enabled only after both steps.
            </p>

            <ul className="mt-5 space-y-2 text-sm text-slate-700">
              {features.map((feature) => (
                <li key={`hybrid-${feature}`} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                  {feature}
                </li>
              ))}
            </ul>

            <Button className="mt-6 w-full" disabled={activePlan !== ''} onClick={activateHybrid}>
              {activePlan === 'hybrid'
                ? 'Processing...'
                : hasSetupPaid
                  ? 'Continue Rs 999/month Autopay Setup'
                  : 'Pay Rs 12,999 and Enable Rs 999/month Autopay'}
            </Button>
          </section>
        </div>
      </div>
    </div>
  )
}
