import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../components/Button'
import MarketingHeader from '../components/MarketingHeader'
import { demoService } from '../services/demoService'

const demoPolicyPoints = [
  'Demo is a guided product walkthrough for restaurant operations and growth use-cases.',
  'We contact only for product follow-up and onboarding support.',
  'Submitted details are used for demo scheduling and support communication only.',
  'No hidden charges for demo booking.',
]

const policyStats = [
  { value: '15-30 min', label: 'Typical Demo Slot' },
  { value: '<24 hrs', label: 'Response Window' },
  { value: '1:1', label: 'Guided Session' },
]

export default function TrustPage() {
  const [form, setForm] = useState({
    fullName: '',
    phoneNumber: '',
    restaurantName: '',
    state: '',
    city: '',
    email: '',
    note: '',
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const validateForm = () => {
    const fullName = String(form.fullName || '').trim()
    const phoneNumber = String(form.phoneNumber || '').trim()
    const restaurantName = String(form.restaurantName || '').trim()
    const state = String(form.state || '').trim()
    const city = String(form.city || '').trim()
    const email = String(form.email || '').trim()

    if (fullName.length < 2) return 'Please enter a valid full name.'
    if (!/^[+]?[0-9\s()-]{8,20}$/.test(phoneNumber)) return 'Please enter a valid phone number.'
    if (restaurantName.length < 2) return 'Please enter a valid restaurant name.'
    if (state.length < 2) return 'Please enter a valid state.'
    if (city.length < 2) return 'Please enter a valid city.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Please enter a valid email address.'
    return ''
  }

  const onSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    setSubmitting(true)
    try {
      await demoService.book({
        fullName: String(form.fullName || '').trim(),
        phoneNumber: String(form.phoneNumber || '').trim(),
        restaurantName: String(form.restaurantName || '').trim(),
        state: String(form.state || '').trim(),
        city: String(form.city || '').trim(),
        email: String(form.email || '').trim(),
        note: String(form.note || '').trim(),
      })

      setSuccess('Demo booked successfully. Our team will contact you shortly.')
      setForm({
        fullName: '',
        phoneNumber: '',
        restaurantName: '',
        state: '',
        city: '',
        email: '',
        note: '',
      })
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'Unable to book demo right now. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const fieldClass =
    'w-full rounded-xl border border-white/25 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-300 focus:border-red-300 focus:outline-none focus:ring-2 focus:ring-red-400/40'

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_90%_-12%,rgba(229,9,20,0.14),transparent_36%),radial-gradient(circle_at_0%_100%,rgba(15,23,42,0.09),transparent_30%),#f5f7fc] text-slate-900">
      <MarketingHeader />

      <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-12">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_20px_40px_rgba(15,23,42,0.08)] md:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--primary)]">Demo</p>
          <h1 className="mt-2 text-4xl font-bold leading-tight text-slate-900 md:text-5xl">Book a Product Demo for Your Restaurant</h1>
          <p className="mt-4 max-w-3xl text-sm text-slate-600 md:text-base">
            See how Chef&apos;s Bud improves table ordering, kitchen coordination, offers, and revenue visibility for your operations.
          </p>

          <div className="mt-7 grid grid-cols-1 gap-3 md:grid-cols-3">
            {policyStats.map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-red-100 bg-red-50/60 px-4 py-4">
                <p className="text-3xl font-extrabold text-[var(--primary)]">{stat.value}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.07)] lg:col-span-5 md:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--primary)]">Demo Policy</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">Clear, simple, and transparent</h2>

            <div className="mt-5 space-y-3">
              {demoPolicyPoints.map((item, index) => (
                <article key={item} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Point {index + 1}</p>
                  <p className="mt-1 text-sm text-slate-700">{item}</p>
                </article>
              ))}
            </div>

            <p className="mt-5 text-xs leading-6 text-slate-500">
              By submitting this form, you agree to be contacted for demo scheduling and onboarding assistance.
            </p>
          </article>

          <section className="rounded-3xl border border-slate-800 bg-gradient-to-br from-[#020817] via-[#071336] to-[#0a1f4f] p-6 text-white shadow-[0_24px_48px_rgba(2,6,23,0.35)] lg:col-span-7 md:p-8">
            <h2 className="text-3xl font-bold">Book Demo</h2>
            <p className="mt-2 text-sm text-slate-200">
              Share your details and our team will reach out to schedule your guided session.
            </p>

            <form className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={onSubmit}>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200">Full Name</span>
                <input
                  className={fieldClass}
                  value={form.fullName}
                  onChange={(event) => updateField('fullName', event.target.value)}
                  maxLength={120}
                  placeholder="Enter full name"
                  required
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200">Phone Number</span>
                <input
                  className={fieldClass}
                  value={form.phoneNumber}
                  onChange={(event) => updateField('phoneNumber', event.target.value)}
                  maxLength={20}
                  placeholder="Enter phone number"
                  required
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200">Restaurant Name</span>
                <input
                  className={fieldClass}
                  value={form.restaurantName}
                  onChange={(event) => updateField('restaurantName', event.target.value)}
                  maxLength={160}
                  placeholder="Enter restaurant name"
                  required
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200">State</span>
                <input
                  className={fieldClass}
                  value={form.state}
                  onChange={(event) => updateField('state', event.target.value)}
                  maxLength={120}
                  placeholder="Enter state"
                  required
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200">City</span>
                <input
                  className={fieldClass}
                  value={form.city}
                  onChange={(event) => updateField('city', event.target.value)}
                  maxLength={120}
                  placeholder="Enter city"
                  required
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200">Email</span>
                <input
                  className={fieldClass}
                  type="email"
                  value={form.email}
                  onChange={(event) => updateField('email', event.target.value)}
                  maxLength={160}
                  placeholder="Enter email address"
                  required
                />
              </label>

              <label className="space-y-1.5 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200">Note</span>
                <textarea
                  className={`${fieldClass} min-h-[112px]`}
                  value={form.note}
                  onChange={(event) => updateField('note', event.target.value)}
                  maxLength={800}
                  placeholder="Any special requirement or preferred time window"
                />
              </label>

              {error ? <p className="md:col-span-2 rounded-xl border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
              {success ? <p className="md:col-span-2 rounded-xl border border-emerald-300/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{success}</p> : null}

              <div className="md:col-span-2 flex flex-wrap gap-3 pt-1">
                <Button type="submit" className="px-7 py-3" disabled={submitting}>
                  {submitting ? 'Booking...' : 'Book Demo'}
                </Button>
                <Link to="/contact">
                  <Button type="button" variant="secondary" className="px-7 py-3">Talk to Team</Button>
                </Link>
              </div>
            </form>
          </section>
        </section>
      </main>
    </div>
  )
}
