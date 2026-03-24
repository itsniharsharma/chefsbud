import { Link } from 'react-router-dom'
import Button from '../components/Button'
import MarketingHeader from '../components/MarketingHeader'

const modules = [
  {
    title: 'Service Control Surface',
    text: 'A live owner cockpit for menu, orders, tables, billing, and analytics with clean role boundaries.',
    tag: 'Command',
  },
  {
    title: 'Guest Ordering Journey',
    text: 'Table QR flow optimized for speed, clarity, and confidence from browse to order tracking.',
    tag: 'Experience',
  },
  {
    title: 'Offer Intelligence Studio',
    text: 'Design high-conversion promotions with protected constraints and guided validation.',
    tag: 'Revenue',
  },
  {
    title: 'Data and Reliability Core',
    text: 'Performance-minded APIs, caching, and billing-state enforcement to keep operations stable.',
    tag: 'Reliability',
  },
]

export default function PlatformPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_10%_-10%,rgba(229,9,20,0.14),transparent_34%),radial-gradient(circle_at_100%_0%,rgba(2,6,23,0.12),transparent_32%),#f5f7fb] text-slate-900">
      <MarketingHeader />

      <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-12">
        <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-[#0f172a] p-6 text-white shadow-[0_30px_60px_rgba(2,6,23,0.35)] md:p-10">
          <div className="absolute -right-24 top-8 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(229,9,20,0.44),transparent_70%)]" />
          <div className="absolute -left-20 bottom-0 h-52 w-52 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.2),transparent_70%)]" />
          <p className="text-xs uppercase tracking-[0.28em] text-red-200">Platform Architecture</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight md:text-5xl">One premium system for front-of-house speed and back-of-house precision</h1>
          <p className="mt-4 max-w-3xl text-sm text-slate-200 md:text-base">
            Chef&apos;s Bud is designed as a connected stack, not scattered tools. Every feature contributes to service consistency,
            margin control, and better guest memory.
          </p>
        </section>

        <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          {modules.map((module) => (
            <article key={module.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.08)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--primary)]">{module.tag}</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">{module.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{module.text}</p>
            </article>
          ))}
        </section>

        <section className="mt-8 rounded-3xl border border-red-100 bg-white p-6 shadow-[0_16px_34px_rgba(229,9,20,0.09)] md:p-8">
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--primary)]">Next Step</p>
          <h3 className="mt-2 text-3xl font-bold text-slate-900">Run this stack in your restaurant</h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">Start with setup payment and monthly autopay authorization to unlock the full operating system.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to="/plans">
              <Button className="px-7 py-3">Go to Pricing</Button>
            </Link>
            <Link to="/demo">
              <Button variant="secondary" className="px-7 py-3">Book Demo</Button>
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}
