import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import MarketingHeader from '../components/MarketingHeader'
import { useAuth } from '../hooks/useAuth'
import { paymentService } from '../services/paymentService'
import { hasBillingAccess } from '../utils/billingAccess'

const features = [
  'Complete owner dashboard with menu, orders, tables, analytics, and billing controls',
  'QR-based customer ordering with real-time operations and order visibility',
  'AI-powered menu import, offer controls, and revenue-focused analytics',
  'Monthly autopay with billing lifecycle tracking and grace-period safeguards',
]

const moneyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

function formatPaise(value) {
  return moneyFormatter.format((Number(value) || 0) / 100)
}

function formatDate(value) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

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
      reject(new Error(event?.error?.description || 'Payment failed'))
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

function getBillingStateDetails(billing) {
  const graceEndsAt = formatDate(billing?.graceEndsAt)
  const graceExpired = billing?.status === 'past_due' && !hasBillingAccess(billing)

  switch (billing?.status) {
    case 'active':
      return {
        tone: 'emerald',
        badge: 'Subscription Active',
        title: 'Your Chef\'s Bud subscription is live',
        body: 'You already have full workspace access. Open the dashboard to manage your restaurant.',
        primaryCta: { label: 'Open Dashboard', to: '/dashboard' },
      }
    case 'past_due':
      return {
        tone: graceExpired ? 'slate' : 'amber',
        badge: graceExpired ? 'Subscription Paused' : 'Payment Failed',
        title: graceExpired ? 'Your workspace has been paused' : 'Autopay needs your attention',
        body: graceExpired
          ? 'Your subscription has been paused due to a failed payment after the grace period. Please contact support to continue using Chef\'s Bud.'
          : graceEndsAt
            ? `Your latest subscription payment failed. Access stays available until ${graceEndsAt}. Please contact support to update your payment method.`
            : 'Your latest subscription payment failed. Please contact support to restore uninterrupted access.',
        primaryCta: { label: 'Contact Support', to: '/contact' },
      }
    case 'cancelled':
      return {
        tone: 'slate',
        badge: 'Subscription Paused',
        title: 'Your workspace is currently paused',
        body: 'This subscription is no longer active. Contact support to restart billing and regain access.',
        primaryCta: { label: 'Contact Support', to: '/contact' },
      }
    default:
      return {
        tone: 'rose',
        badge: 'Activation Required',
        title: 'Complete payment to unlock your workspace',
        body: 'Pay the setup amount and first month together once, then monthly autopay keeps the account active.',
        primaryCta: null,
      }
  }
}

export default function PricingPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, restaurant, isAuthenticated, refreshSession } = useAuth()
  const [activePlan, setActivePlan] = useState('')
  const [error, setError] = useState('')
  const [successState, setSuccessState] = useState(null)
  const [planSummary, setPlanSummary] = useState({
    setupAmountPaise: 1299900,
    firstMonthAmountPaise: 99900,
    totalDueTodayPaise: 1399800,
    recurringAmountPaise: 99900,
  })
  const autoLaunchAttemptedRef = useRef(false)

  const billing = user?.billing
  const billingDetails = getBillingStateDetails(billing)
  const billingAllowsAccess = hasBillingAccess(billing)
  const shouldShowActivateCta = isAuthenticated && ['pending', 'failed', 'setup_paid', undefined].includes(billing?.status)

  const prefill = useMemo(
    () => ({
      name: user?.name || '',
      email: user?.email || '',
      contact: restaurant?.phone || '',
    }),
    [restaurant?.phone, user?.email, user?.name],
  )

  const activateHybrid = useCallback(async ({ autoStarted = false } = {}) => {
    if (!isAuthenticated) {
      navigate('/register', {
        state: {
          source: 'pricing',
        },
      })
      return
    }

    if (activePlan === 'hybrid') {
      return
    }

    setError('')
    setSuccessState(null)
    setActivePlan('hybrid')

    try {
      await loadRazorpayCheckoutScript()

      const subscriptionCheckout = await paymentService.createHybridSubscription()
      const checkoutSummary = subscriptionCheckout?.planSummary || planSummary
      if (subscriptionCheckout?.planSummary) {
        setPlanSummary(subscriptionCheckout.planSummary)
      }

      const subscriptionResponse = await openRazorpay({
        key: subscriptionCheckout.keyId,
        subscription_id: subscriptionCheckout.subscriptionId,
        name: "Chef's Bud",
        description: `Pay ${formatPaise(checkoutSummary.totalDueTodayPaise)} today, then ${formatPaise(checkoutSummary.recurringAmountPaise)} every month`,
        prefill,
        retry: {
          enabled: true,
        },
        notes: {
          plan: 'hybrid',
        },
        theme: { color: '#e50914' },
      })

      const verification = await paymentService.verifyHybridSubscription(subscriptionResponse)
      const refreshed = await refreshSession()
      const nextBilling = verification?.billing || refreshed?.user?.billing || billing

      setSuccessState({
        title: 'Your subscription is active',
        body: `You now have full access to Chef's Bud. ${formatPaise(checkoutSummary.totalDueTodayPaise)} was authorized today, and ${formatPaise(checkoutSummary.recurringAmountPaise)} will auto-debit every month.`,
        billing: nextBilling,
      })
    } catch (requestError) {
      const message = requestError?.response?.data?.message || requestError?.message || 'Unable to activate your subscription right now'
      if (message === 'Checkout cancelled') {
        setError(
          autoStarted
            ? 'Payment window was closed before completion. Tap the button below to continue activation.'
            : 'Checkout was closed before completion. Please finish the payment to activate your workspace.',
        )
      } else {
        setError(message)
      }
    } finally {
      setActivePlan('')
    }
  }, [activePlan, billing, isAuthenticated, navigate, planSummary, prefill, refreshSession])

  useEffect(() => {
    if (!location.state?.autoStartPlan || autoLaunchAttemptedRef.current || !isAuthenticated || billingAllowsAccess || billing?.status === 'cancelled') {
      return
    }

    autoLaunchAttemptedRef.current = true
    void activateHybrid({ autoStarted: true })
  }, [activateHybrid, billing?.status, billingAllowsAccess, isAuthenticated, location.state?.autoStartPlan])

  const ctaDisabled = activePlan !== '' || !isAuthenticated || billing?.status === 'cancelled'

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-rose-50">
      <MarketingHeader />

      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-600">Chef&apos;s Bud Billing</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900 md:text-4xl">A single payment flow that activates your workspace</h1>
          <p className="mx-auto mt-3 max-w-3xl text-sm text-slate-600 md:text-base">
            Pay setup and the first month together once. After activation, your monthly subscription renews automatically and the platform manages billing status for you.
          </p>
        </div>

        {successState ? (
          <section className="mx-auto mb-8 max-w-3xl rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-7 shadow-[0_24px_44px_rgba(16,185,129,0.16)]">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">Subscription Activated</p>
            <h2 className="mt-2 text-3xl font-bold text-slate-900">{successState.title} 🎉</h2>
            <p className="mt-3 text-sm text-slate-700 md:text-base">{successState.body}</p>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-emerald-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Paid Today</p>
                <p className="mt-2 text-xl font-bold text-slate-900">{formatPaise(planSummary.totalDueTodayPaise)}</p>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Monthly Autopay</p>
                <p className="mt-2 text-xl font-bold text-slate-900">{formatPaise(planSummary.recurringAmountPaise)}</p>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Status</p>
                <p className="mt-2 text-xl font-bold capitalize text-slate-900">{successState.billing?.status || 'active'}</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => navigate('/dashboard', { replace: true, state: { billingFlash: 'subscription-activated' } })}>
                Enter Dashboard
              </Button>
              <Link to="/contact">
                <Button variant="secondary">Contact Support</Button>
              </Link>
            </div>
          </section>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
          <section className="card relative flex flex-col border-rose-200 p-6">
            <span className="absolute right-4 top-4 rounded-full bg-rose-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-rose-700">
              Subscription Autopay
            </span>

            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Business Plan</p>
            <h2 className="mt-2 text-3xl font-bold text-slate-900">{formatPaise(planSummary.totalDueTodayPaise)} today</h2>
            <p className="mt-2 text-sm text-slate-600">
              Includes {formatPaise(planSummary.setupAmountPaise)} one-time setup and {formatPaise(planSummary.firstMonthAmountPaise)} for your first month. After activation, {formatPaise(planSummary.recurringAmountPaise)} auto-debits every month.
            </p>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Setup Fee</p>
                <p className="mt-2 text-xl font-bold text-slate-900">{formatPaise(planSummary.setupAmountPaise)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">First Month</p>
                <p className="mt-2 text-xl font-bold text-slate-900">{formatPaise(planSummary.firstMonthAmountPaise)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Recurring</p>
                <p className="mt-2 text-xl font-bold text-slate-900">{formatPaise(planSummary.recurringAmountPaise)}/mo</p>
              </div>
            </div>

            <ul className="mt-5 space-y-2 text-sm text-slate-700">
              {features.map((feature) => (
                <li key={feature} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
                  {feature}
                </li>
              ))}
            </ul>

            {error ? <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-[var(--primary)]">{error}</p> : null}

            <div className="mt-6 flex flex-wrap gap-3">
              {billingAllowsAccess ? (
                <Button onClick={() => navigate('/dashboard')}>
                  Open Dashboard
                </Button>
              ) : shouldShowActivateCta ? (
                <Button disabled={ctaDisabled} onClick={() => activateHybrid()}>
                  {activePlan === 'hybrid' ? 'Opening secure checkout...' : `Pay ${formatPaise(planSummary.totalDueTodayPaise)} and Activate`}
                </Button>
              ) : !isAuthenticated ? (
                <Button onClick={() => navigate('/register', { state: { source: 'pricing' } })}>Create account to continue</Button>
              ) : (
                <Link to={billingDetails.primaryCta?.to || '/contact'}>
                  <Button>{billingDetails.primaryCta?.label || 'Contact Support'}</Button>
                </Link>
              )}

              <Link to="/contact">
                <Button variant="secondary">Talk to Support</Button>
              </Link>
            </div>
          </section>

          <aside className="space-y-4">
            <section
              className={`rounded-3xl border p-5 shadow-[0_16px_30px_rgba(15,23,42,0.08)] ${
                billingDetails.tone === 'emerald'
                  ? 'border-emerald-200 bg-emerald-50/70'
                  : billingDetails.tone === 'amber'
                    ? 'border-amber-200 bg-amber-50/80'
                    : billingDetails.tone === 'slate'
                      ? 'border-slate-200 bg-slate-50'
                      : 'border-rose-200 bg-rose-50/70'
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-600">{billingDetails.badge}</p>
              <h3 className="mt-2 text-2xl font-bold text-slate-900">{billingDetails.title}</h3>
              <p className="mt-3 text-sm text-slate-700">{billingDetails.body}</p>

              {isAuthenticated ? (
                <div className="mt-4 rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm text-slate-700">
                  <p className="font-semibold text-slate-900">{user?.email}</p>
                  <p className="mt-1">
                    Billing state: <span className="font-semibold capitalize">{billing?.status || 'pending'}</span>
                  </p>
                  {billing?.graceEndsAt ? <p className="mt-1">Grace ends on {formatDate(billing.graceEndsAt)}</p> : null}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm text-slate-700">
                  Register first, then you will be redirected into secure payment automatically.
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_16px_30px_rgba(15,23,42,0.06)]">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">How It Works</p>
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">1. Register and verify</p>
                  <p className="mt-1 text-sm text-slate-600">Create your owner account and confirm your email.</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">2. Pay once today</p>
                  <p className="mt-1 text-sm text-slate-600">Authorize {formatPaise(planSummary.totalDueTodayPaise)} in a single checkout for setup plus month one.</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">3. Stay active automatically</p>
                  <p className="mt-1 text-sm text-slate-600">Razorpay handles monthly autopay, while Chef&apos;s Bud manages reminders, grace, and access state.</p>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  )
}
