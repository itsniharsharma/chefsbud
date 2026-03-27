import TimeFilter from './TimeFilter'
import { formatKpiNumber, formatMoney, formatPercent, formatSigned, getDeltaTone } from './formatters'

function KpiCard({ title, metric, type = 'number' }) {
  const value = Number(metric?.value || 0)
  const displayValue = type === 'currency' ? formatMoney(value) : type === 'percent' ? formatPercent(value) : formatKpiNumber(value)

  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-extrabold text-slate-900">{displayValue}</p>
      <div className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getDeltaTone(metric?.changePercent)}`}>
        {formatSigned(metric?.changePercent, true)} ({formatSigned(metric?.change)})
      </div>
    </div>
  )
}

export default function AnalyticsLayout({ range, onRangeChange, kpis, children }) {
  return (
    <section className="space-y-5">
      <div className="card overflow-hidden border border-red-100 bg-[linear-gradient(135deg,#fff7ed_0%,#ffffff_52%,#fef2f2_100%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-600">Chef's Bud Decision Engine</p>
            <h1 className="mt-2 text-2xl font-extrabold text-slate-900 md:text-3xl">
              Operational intelligence designed for action, not dashboard vanity.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 md:text-base">
              Detect leakage, discover growth opportunities, and optimize pricing, funnel, basket, and quality from one control room.
            </p>
          </div>
          <TimeFilter range={range} onChange={onRangeChange} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <KpiCard title="Revenue" metric={kpis?.revenue} type="currency" />
        <KpiCard title="Orders" metric={kpis?.orders} />
        <KpiCard title="AOV" metric={kpis?.aov} type="currency" />
        <KpiCard title="Views" metric={kpis?.totalViews} />
        <KpiCard title="Conversion" metric={kpis?.conversionRate} type="percent" />
        <KpiCard title="Add To Cart Rate" metric={kpis?.addToCartRate} type="percent" />
        <KpiCard title="Cart Abandonment" metric={kpis?.cartAbandonment} type="percent" />
        <KpiCard title="Revenue Per View" metric={kpis?.revenuePerView} type="currency" />
        <KpiCard title="Avg Items / Order" metric={kpis?.avgItemsPerOrder} />
      </div>

      {children}
    </section>
  )
}
