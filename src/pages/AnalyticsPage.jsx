import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Button from '../components/Button'
import { useAuth } from '../hooks/useAuth'
import { useAnalyticsOverviewQuery } from '../hooks/useDashboardQueries'
import { formatCurrencyINR } from '../utils/currency'

const RANGE_OPTIONS = [
  { label: 'Today', value: 'today' },
  { label: '7 Days', value: '7d' },
  { label: '14 Days', value: '14d' },
  { label: '30 Days', value: '30d' },
  { label: 'This Month', value: 'this_month' },
  { label: 'Yearly', value: 'yearly' },
]

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`
}

function formatSignedPercent(value) {
  const numeric = Number(value || 0)
  const prefix = numeric > 0 ? '+' : ''
  return `${prefix}${numeric.toFixed(1)}%`
}

function formatSignedValue(value, type = 'number') {
  const numeric = Number(value || 0)
  const prefix = numeric > 0 ? '+' : ''

  if (type === 'currency') {
    return `${prefix}${formatCurrencyINR(numeric)}`
  }

  if (type === 'percent') {
    return `${prefix}${numeric.toFixed(1)}%`
  }

  return `${prefix}${numeric.toFixed(2).replace(/\.00$/, '')}`
}

function getDeltaTone(changePercent) {
  const numeric = Number(changePercent || 0)
  if (numeric > 0) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (numeric < 0) return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function KpiCard({ title, metric, type = 'number', hint }) {
  const value = Number(metric?.value || 0)
  const formattedValue =
    type === 'currency' ? formatCurrencyINR(value) : type === 'percent' ? formatPercent(value) : value.toFixed(2).replace(/\.00$/, '')

  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-extrabold text-slate-900">{formattedValue}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${getDeltaTone(metric?.changePercent)}`}>
          {formatSignedPercent(metric?.changePercent)} ({formatSignedValue(metric?.change, type === 'percent' ? 'percent' : type)})
        </div>
      </div>
      {hint ? <p className="mt-2 text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg">
      {label ? <p className="mb-2 font-semibold text-slate-900">{label}</p> : null}
      {payload.map((entry) => {
        const isCurrency = String(entry?.dataKey || '').toLowerCase().includes('revenue')
        return (
          <p key={`${entry.dataKey}-${entry.name}`} className="text-slate-600">
            <span className="font-medium" style={{ color: entry.color }}>{entry.name}:</span>{' '}
            {isCurrency ? formatCurrencyINR(entry.value) : entry.value}
          </p>
        )
      })}
    </div>
  )
}

function FunnelPanel({ funnel }) {
  const data = [
    { value: Number(funnel?.views || 0), name: 'Views', fill: '#f59e0b' },
    { value: Number(funnel?.addToCart || 0), name: 'Add To Cart', fill: '#fb7185' },
    { value: Number(funnel?.orders || 0), name: 'Orders', fill: '#111827' },
  ]

  return (
    <div className="card p-4">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-slate-900">Funnel Analytics</h2>
        <p className="text-sm text-slate-600">See where visibility turns into intent and where intent collapses.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr,1.05fr]">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <FunnelChart>
              <Tooltip content={<ChartTooltip />} />
              <Funnel dataKey="value" data={data} isAnimationActive={false}>
                <LabelList position="right" fill="#0f172a" stroke="none" dataKey="name" />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">View to Cart</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{formatPercent(funnel?.viewToCartRate)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cart to Order</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{formatPercent(funnel?.cartToOrderRate)}</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Total Drop-Off</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{formatPercent(funnel?.dropOffPercent)}</p>
            <p className="mt-2 text-sm text-amber-900">
              {Number(funnel?.views || 0) - Number(funnel?.orders || 0)} customers saw items but did not finish as completed orders.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function ItemBoard({ title, items = [], tone, emptyText }) {
  return (
    <div className="card p-4">
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <div className="mt-3 space-y-3">
        {items.length ? items.map((item) => (
          <div key={item.itemId} className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">{item.name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.views} views • {item.orders} orders • {formatCurrencyINR(item.revenue)}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
                {formatPercent(item.conversion)}
              </span>
            </div>
          </div>
        )) : <p className="text-sm text-slate-500">{emptyText}</p>}
      </div>
    </div>
  )
}

function InsightList({ insights = [] }) {
  return (
    <div className="card p-4">
      <h2 className="text-lg font-semibold text-slate-900">What You Should Fix Right Now</h2>
      <div className="mt-4 space-y-3">
        {insights.length ? insights.map((insight) => (
          <div key={insight} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {insight}
          </div>
        )) : <p className="text-sm text-slate-500">Actionable insights will appear as more analytics data accumulates.</p>}
      </div>
    </div>
  )
}

export default function AnalyticsPage() {
  const { restaurant } = useAuth()
  const [range, setRange] = useState('14d')
  const { data, isLoading, isError } = useAnalyticsOverviewQuery({
    restaurantId: restaurant?._id,
    range,
  })

  const comparisonItems = data?.items?.comparison || []
  const peakChartData = (data?.time?.ordersByHour || []).map((entry, index) => ({
    hour: entry.hour,
    orders: entry.orders,
    revenue: data?.time?.revenueByHour?.[index]?.revenue || 0,
  }))

  return (
    <section className="space-y-5">
      <div className="card overflow-hidden border border-red-100 bg-[linear-gradient(135deg,#fff7ed_0%,#ffffff_52%,#fef2f2_100%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-600">Chef&apos;s Bud Intelligence</p>
            <h1 className="mt-2 text-2xl font-extrabold text-slate-900 md:text-3xl">
              A decision system for revenue, conversion loss, item performance, and what to fix next.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 md:text-base">
              This dashboard reads Chef&apos;s Bud&apos;s aggregate analytics collections directly through the backend and turns them into revenue and behavior signals owners can act on fast.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {RANGE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant={range === option.value ? 'primary' : 'secondary'}
                onClick={() => setRange(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? <div className="card p-4 text-sm text-slate-500">Loading analytics...</div> : null}
      {isError ? <div className="card p-4 text-sm text-[var(--primary)]">Unable to load analytics right now.</div> : null}

      {!isLoading && !isError ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
            <KpiCard title="Revenue" metric={data?.kpis?.revenue} type="currency" />
            <KpiCard title="Orders" metric={data?.kpis?.orders} />
            <KpiCard title="AOV" metric={data?.kpis?.aov} type="currency" />
            <KpiCard title="Views" metric={data?.kpis?.totalViews} />
            <KpiCard title="Conversion" metric={data?.kpis?.conversionRate} type="percent" />
            <KpiCard title="Add To Cart Rate" metric={data?.kpis?.addToCartRate} type="percent" />
            <KpiCard title="Cart Abandonment" metric={data?.kpis?.cartAbandonment} type="percent" />
            <KpiCard title="Revenue Per View" metric={data?.kpis?.revenuePerView} type="currency" />
            <KpiCard title="Avg Items / Order" metric={data?.kpis?.avgItemsPerOrder} />
          </div>

          <div className="card p-4">
            <div className="mb-3">
              <h2 className="text-lg font-semibold text-slate-900">Revenue vs Orders</h2>
              <p className="text-sm text-slate-600">Trend view for the selected range using pre-aggregated daily metrics.</p>
            </div>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.trends?.combined || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis yAxisId="revenue" tickFormatter={formatCurrencyINR} />
                  <YAxis yAxisId="orders" orientation="right" />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <Line yAxisId="revenue" type="monotone" dataKey="revenue" name="Revenue" stroke="#dc2626" strokeWidth={3} dot={false} />
                  <Line yAxisId="orders" type="monotone" dataKey="orders" name="Orders" stroke="#111827" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <FunnelPanel funnel={data?.funnel} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="card p-4 xl:col-span-6">
              <div className="mb-3">
                <h2 className="text-lg font-semibold text-slate-900">Views vs Orders by Item</h2>
                <p className="text-sm text-slate-600">Spot items that attract attention but fail to convert.</p>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonItems}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Bar dataKey="views" name="Views" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="orders" name="Orders" fill="#111827" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card p-4 xl:col-span-6">
              <div className="mb-3">
                <h2 className="text-lg font-semibold text-slate-900">Peak Hours</h2>
                <p className="text-sm text-slate-600">Operational timing based on aggregated completed-order hours.</p>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={peakChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
                    <YAxis />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Bar dataKey="orders" name="Orders" fill="#111827" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Peak Hour</p>
                  <p className="mt-2 text-2xl font-bold text-slate-900">{data?.time?.peakHour || '-'}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Peak Orders</p>
                  <p className="mt-2 text-2xl font-bold text-slate-900">{Number(data?.time?.peakOrders || 0)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="xl:col-span-4">
              <ItemBoard
                title="Winners"
                items={data?.items?.winners || []}
                tone="bg-emerald-100 text-emerald-700"
                emptyText="Winners will appear once enough signal exists."
              />
            </div>
            <div className="xl:col-span-4">
              <ItemBoard
                title="Losers"
                items={data?.items?.losers || []}
                tone="bg-rose-100 text-rose-700"
                emptyText="Loss leaders and weak converters will appear here."
              />
            </div>
            <div className="xl:col-span-4">
              <ItemBoard
                title="Hidden Gems"
                items={data?.items?.hiddenGems || []}
                tone="bg-amber-100 text-amber-800"
                emptyText="Hidden gems will appear when low-visibility items convert strongly."
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="card p-4 xl:col-span-4">
              <h2 className="text-lg font-semibold text-slate-900">Revenue Contribution</h2>
              <div className="mt-4 space-y-3">
                {(data?.revenue?.topItemsByRevenue || []).length ? (
                  data.revenue.topItemsByRevenue.map((item) => (
                    <div key={item.itemId} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{item.name}</p>
                          <p className="mt-1 text-xs text-slate-500">{item.orders} orders • {formatPercent(item.conversion)} conversion</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-slate-900">{formatCurrencyINR(item.revenue)}</p>
                          <p className="mt-1 text-xs text-slate-500">{formatPercent(item.revenueContribution)} of revenue</p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">Revenue-leading items will appear as completed-order data grows.</p>
                )}
              </div>
            </div>

            <div className="card p-4 xl:col-span-4">
              <h2 className="text-lg font-semibold text-slate-900">Drop-Off Alerts</h2>
              <div className="mt-4 grid gap-3">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Viewed But Not Ordered</p>
                  <p className="mt-2 text-2xl font-bold text-slate-900">{Number(data?.dropoff?.usersViewedButNotOrdered || 0)}</p>
                </div>
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Cart Drop</p>
                  <p className="mt-2 text-2xl font-bold text-slate-900">{Number(data?.dropoff?.cartDrop || 0)}</p>
                </div>
              </div>
            </div>

            <div className="xl:col-span-4">
              <InsightList insights={data?.insights || []} />
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
