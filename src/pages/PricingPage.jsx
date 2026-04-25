import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import MarketingHeader from '../components/MarketingHeader'
import { useAuth } from '../hooks/useAuth'
import { paymentService } from '../services/paymentService'
import { hasBillingAccess } from '../utils/billingAccess'

const BILLING_PLAN_CODE_CORE = 'core'
const BILLING_PLAN_CODE_PRO = 'pro'
const BILLING_CYCLE_MONTHLY = 'monthly'
const BILLING_CYCLE_YEARLY = 'yearly'
const ONE_TIME_SETUP_PAISE = 1299900
const planCatalog = [
  {
    code: BILLING_PLAN_CODE_CORE,
    title: 'Growth Plan',
    monthlyAmountPaise: 69900,
    yearlyAmountPaise: 713000,
    yearlyDiscountPercent: 15,
    badge: 'Best Value Start',
    features: [
      'Complete owner dashboard with menu, orders, tables, and billing controls',
      'QR-based customer ordering with real-time operations and order visibility',
      'AI-powered menu import and offer controls',
      'Monthly autopay with billing lifecycle tracking and grace safeguards',
    ],
  },
  {
    code: BILLING_PLAN_CODE_PRO,
    title: 'Scale Plan',
    monthlyAmountPaise: 129900,
    yearlyAmountPaise: 1247000,
    yearlyDiscountPercent: 20,
    badge: 'Includes Advanced Modules',
    features: [
      'Everything in Growth Plan',
      'Advanced Analytics module access',
      'Inventory module access',
      'Monthly autopay with billing lifecycle tracking and grace safeguards',
    ],
  },
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
  const [billingCycle, setBillingCycle] = useState(BILLING_CYCLE_MONTHLY)
  const [error, setError] = useState('')
  const [successState, setSuccessState] = useState(null)
  const [planSummary, setPlanSummary] = useState({
    setupAmountPaise: ONE_TIME_SETUP_PAISE,
    firstMonthAmountPaise: 69900,
    totalDueTodayPaise: ONE_TIME_SETUP_PAISE + 69900,
    recurringAmountPaise: 69900,
    recurringIntervalLabel: 'month',
    billingCycle: BILLING_CYCLE_MONTHLY,
    discountPercent: 0,
    savedAmountPaise: 0,
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

  const activateHybrid = useCallback(async ({ planCode = BILLING_PLAN_CODE_CORE, cycle = BILLING_CYCLE_MONTHLY, autoStarted = false } = {}) => {
    if (!isAuthenticated) {
      navigate('/register', {
        state: {
          source: 'pricing',
        },
      })
      return
    }

    if (activePlan === `${planCode}:${cycle}`) {
      return
    }

    setError('')
    setSuccessState(null)
    setActivePlan(`${planCode}:${cycle}`)

    try {
      await loadRazorpayCheckoutScript()

      const subscriptionCheckout = await paymentService.createHybridSubscription(planCode, cycle)
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
          planCode,
          billingCycle: cycle,
        },
        theme: { color: '#e50914' },
      })

      const verification = await paymentService.verifyHybridSubscription(subscriptionResponse, planCode, cycle)
      const refreshed = await refreshSession()
      const nextBilling = verification?.billing || refreshed?.user?.billing || billing

      setSuccessState({
        title: 'Your subscription is active',
        body: `You now have full access to Chef's Bud. ${formatPaise(checkoutSummary.totalDueTodayPaise)} was authorized today, and ${formatPaise(checkoutSummary.recurringAmountPaise)} will auto-debit every ${checkoutSummary.recurringIntervalLabel || 'month'}.`,
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
            Choose the monthly plan that fits your restaurant. Pay setup and first month together once, then autopay renews monthly.
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
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {planSummary.recurringIntervalLabel === 'year' ? 'Yearly Autopay' : 'Monthly Autopay'}
                </p>
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
          <section className="space-y-4">
            <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  billingCycle === BILLING_CYCLE_MONTHLY ? 'bg-rose-600 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
                onClick={() => setBillingCycle(BILLING_CYCLE_MONTHLY)}
              >
                Monthly Billing
              </button>
              <button
                type="button"
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  billingCycle === BILLING_CYCLE_YEARLY ? 'bg-rose-600 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
                onClick={() => setBillingCycle(BILLING_CYCLE_YEARLY)}
              >
                Yearly Billing
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {planCatalog.map((plan) => {
                const recurringAmountPaise = billingCycle === BILLING_CYCLE_YEARLY ? plan.yearlyAmountPaise : plan.monthlyAmountPaise
                const planTotalToday = ONE_TIME_SETUP_PAISE + recurringAmountPaise
                const isCurrentPlanLoading = activePlan === `${plan.code}:${billingCycle}`
                const yearlyMonthlyEquivalentPaise = plan.monthlyAmountPaise * 12
                const yearlySavedPaise = Math.max(0, yearlyMonthlyEquivalentPaise - plan.yearlyAmountPaise)
                return (
                  <article key={plan.code} className="card relative flex h-full flex-col border-rose-200 p-6">
                    <span className="absolute right-4 top-4 rounded-full bg-rose-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-rose-700">
                      {plan.badge}
                    </span>

                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{plan.title}</p>
                    <h2 className="mt-2 text-3xl font-bold text-slate-900">{formatPaise(planTotalToday)} today</h2>
                    <p className="mt-2 text-sm text-slate-600">
                      Includes {formatPaise(ONE_TIME_SETUP_PAISE)} one-time setup and {formatPaise(recurringAmountPaise)} for the first {billingCycle === BILLING_CYCLE_YEARLY ? 'year' : 'month'}.
                      After activation, {formatPaise(recurringAmountPaise)} auto-debits every {billingCycle === BILLING_CYCLE_YEARLY ? 'year' : 'month'}.
                    </p>

                    <div className="mt-5 grid gap-3">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Setup Fee</p>
                        <p className="mt-2 text-xl font-bold text-slate-900">{formatPaise(ONE_TIME_SETUP_PAISE)}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{billingCycle === BILLING_CYCLE_YEARLY ? 'Yearly' : 'Monthly'}</p>
                        <p className="mt-2 text-xl font-bold text-slate-900">
                          {formatPaise(recurringAmountPaise)}/{billingCycle === BILLING_CYCLE_YEARLY ? 'yr' : 'mo'}
                        </p>
                      </div>
                      {billingCycle === BILLING_CYCLE_YEARLY ? (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Yearly Offer</p>
                          <p className="mt-1 text-sm font-semibold text-emerald-800">
                            {plan.yearlyDiscountPercent}% off - you save {formatPaise(yearlySavedPaise)}
                          </p>
                        </div>
                      ) : null}
                    </div>

                    <ul className="mt-5 space-y-2 text-sm text-slate-700">
                      {plan.features.map((feature) => (
                        <li key={`${plan.code}-${feature}`} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
                          {feature}
                        </li>
                      ))}
                    </ul>

                    <div className="mt-6 flex flex-wrap gap-3">
                      {billingAllowsAccess ? (
                        <Button onClick={() => navigate('/dashboard')}>Open Dashboard</Button>
                      ) : shouldShowActivateCta ? (
                        <Button disabled={ctaDisabled} onClick={() => activateHybrid({ planCode: plan.code, cycle: billingCycle })}>
                          {isCurrentPlanLoading ? 'Opening secure checkout...' : `Pay ${formatPaise(planTotalToday)} and Activate`}
                        </Button>
                      ) : !isAuthenticated ? (
                        <Button onClick={() => navigate('/register', { state: { source: 'pricing' } })}>Create account to continue</Button>
                      ) : (
                        <Link to={billingDetails.primaryCta?.to || '/contact'}>
                          <Button>{billingDetails.primaryCta?.label || 'Contact Support'}</Button>
                        </Link>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>

            {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-[var(--primary)]">{error}</p> : null}

            <div className="flex flex-wrap gap-3">
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
                  <p className="mt-1 text-sm text-slate-600">
                    Authorize {formatPaise(planSummary.totalDueTodayPaise)} in a single checkout for setup plus first {planSummary.recurringIntervalLabel || 'month'}.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">3. Stay active automatically</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Razorpay handles recurring autopay, while Chef&apos;s Bud manages reminders, grace, and access state.
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  )
}
