import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { hasBillingAccess } from '../utils/billingAccess'

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

export default function Header({ title }) {
  const { user } = useAuth()
  const location = useLocation()
  const billing = user?.billing
  const showPastDueWarning = billing?.status === 'past_due' && hasBillingAccess(billing)
  const showPausedWarning = billing?.status === 'cancelled'
  const showActivationFlash = location.state?.billingFlash === 'subscription-activated'

  return (
    <div className="mb-4 space-y-3 md:mb-6">
      {showActivationFlash ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span className="font-semibold">Your subscription is active.</span> Setup, first-month billing, and autopay are all in place.
        </div>
      ) : null}

      {showPastDueWarning ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-semibold">Payment failed. Please update your payment method.</p>
            <p className="mt-1 text-amber-800">
              Access remains available during the grace period{billing?.graceEndsAt ? ` until ${formatDate(billing.graceEndsAt)}` : ''}.
            </p>
          </div>
          <Link to="/contact" className="inline-flex w-fit rounded-xl border border-amber-300 bg-white px-3 py-2 font-semibold text-amber-900">
            Contact Support
          </Link>
        </div>
      ) : null}

      {showPausedWarning ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-semibold">Your subscription has been paused due to billing issues.</p>
            <p className="mt-1 text-slate-600">Please contact support to restore access to Chef&apos;s Bud.</p>
          </div>
          <Link to="/contact" className="inline-flex w-fit rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-900">
            Contact Support
          </Link>
        </div>
      ) : null}

      <header className="owner-header-panel flex flex-col items-start justify-between gap-3 p-4 md:flex-row md:items-center md:p-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--primary)]">Owner Workspace</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 md:text-3xl">{title}</h1>
          <p className="text-xs text-slate-600 md:text-sm">Chef&apos;s Bud - Restaurant Revenue OS | Luxury operations, precise control</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {billing?.status ? (
            <span
              className={`rounded-full px-3 py-2 text-xs font-semibold md:text-sm ${
                billing.status === 'active'
                  ? 'bg-emerald-100 text-emerald-800'
                  : billing.status === 'past_due'
                    ? 'bg-amber-100 text-amber-900'
                    : billing.status === 'cancelled'
                      ? 'bg-slate-200 text-slate-800'
                      : 'bg-rose-100 text-rose-700'
              }`}
            >
              {billing.status === 'past_due' ? 'Payment Failed' : billing.status.replace('_', ' ')}
            </span>
          ) : null}
          <div className="owner-chip px-3 py-2 text-xs font-semibold md:text-sm">
            {user?.name || 'Owner'}
          </div>
        </div>
      </header>
    </div>
  )
}
