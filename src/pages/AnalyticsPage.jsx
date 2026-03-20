import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Button from '../components/Button'
import Card from '../components/Card'
import { useAuth } from '../hooks/useAuth'
import { useAnalyticsOverviewQuery } from '../hooks/useDashboardQueries'
import { formatCurrencyINR } from '../utils/currency'

const RANGE_OPTIONS = [7, 14, 30]

function formatPercent(value) {
  const numeric = Number(value || 0)
  const prefix = numeric > 0 ? '+' : ''
  return `${prefix}${numeric.toFixed(1)}%`
}

function formatDelta(value, type = 'number') {
  const numeric = Number(value || 0)
  const prefix = numeric > 0 ? '+' : ''
  if (type === 'currency') {
    return `${prefix}${formatCurrencyINR(numeric)}`
  }
  if (type === 'percent') {
    return `${prefix}${numeric.toFixed(1)}%`
  }
  return `${prefix}${numeric}`
}

function TrendDelta({ growth, type = 'number' }) {
  const rate = Number(growth?.growthRate || 0)
  const tone =
    rate > 0
      ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
      : rate < 0
        ? 'text-rose-700 bg-rose-50 border-rose-200'
        : 'text-slate-700 bg-slate-50 border-slate-200'

  return (
    <div className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {formatPercent(rate)} ({formatDelta(growth?.absoluteChange || 0, type)})
    </div>
  )
}

function MetricCard({ title, value, growth, valueType = 'number' }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-extrabold text-slate-900">
        {valueType === 'currency' ? formatCurrencyINR(value) : valueType === 'percent' ? `${Number(value || 0).toFixed(1)}%` : value}
      </p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <TrendDelta growth={growth} type={valueType} />
        <p className="text-xs text-slate-500">
          Prev {valueType === 'currency' ? formatCurrencyINR(growth?.previous || 0) : valueType === 'percent' ? `${Number(growth?.previous || 0).toFixed(1)}%` : growth?.previous || 0}
        </p>
      </div>
    </div>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg">
      {label ? <p className="mb-2 font-semibold text-slate-900">{label}</p> : null}
      {payload.map((entry) => (
        <p key={`${entry.dataKey}-${entry.name}`} className="text-slate-600">
          <span className="font-medium" style={{ color: entry.color }}>{entry.name}:</span>{' '}
          {String(entry.dataKey).toLowerCase().includes('revenue') ? formatCurrencyINR(entry.value) : entry.value}
        </p>
      ))}
    </div>
  )
}

function ItemList({ title, items = [], emptyText }) {
  return (
    <div className="card p-4">
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <div className="mt-3 space-y-3">
        {items.length ? items.map((item, index) => (
          <div key={item.menuItemId} className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">{index + 1}. {item.name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.views} views • {item.orders} orders • {formatCurrencyINR(item.revenue)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <TrendDelta growth={item.revenueGrowth} type="currency" />
                <TrendDelta growth={item.orderGrowth} type="number" />
              </div>
            </div>
          </div>
        )) : <p className="text-sm text-slate-500">{emptyText}</p>}
      </div>
    </div>
  )
}

export default function AnalyticsPage() {
  const { restaurant } = useAuth()
  const [rangeDays, setRangeDays] = useState(14)
  const { data, isLoading, isError } = useAnalyticsOverviewQuery({
    restaurantId: restaurant?._id,
    rangeDays,
  })

  return (
    <section className="space-y-5">
      <div className="card overflow-hidden border border-red-100 bg-[linear-gradient(135deg,#fff7ed_0%,#ffffff_52%,#fef2f2_100%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-600">Chef's Bud Analytics</p>
            <h1 className="mt-2 text-2xl font-extrabold text-slate-900 md:text-3xl">
              Revenue, growth, conversion, and item performance in one owner-friendly dashboard.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 md:text-base">
              Track what is selling, what is slipping, where customers drop off, and how performance changes
              versus the previous period.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {RANGE_OPTIONS.map((days) => (
              <Button
                key={days}
                variant={rangeDays === days ? 'primary' : 'secondary'}
                onClick={() => setRangeDays(days)}
              >
                {days} Days
              </Button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? <div className="card p-4 text-sm text-slate-500">Loading analytics...</div> : null}
      {isError ? <div className="card p-4 text-sm text-[var(--primary)]">Unable to load analytics right now.</div> : null}

      {!isLoading && !isError ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Revenue"
              value={data?.overview?.totalRevenue || 0}
              growth={data?.summary?.revenue}
              valueType="currency"
            />
            <MetricCard
              title="Orders"
              value={data?.overview?.totalOrders || 0}
              growth={data?.summary?.orders}
            />
            <MetricCard
              title="AOV"
              value={data?.overview?.aov || 0}
              growth={data?.summary?.aov}
              valueType="currency"
            />
            <MetricCard
              title="Conversion"
              value={data?.overview?.conversionRate || 0}
              growth={data?.summary?.conversionRate}
              valueType="percent"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="card p-4 xl:col-span-7">
              <div className="mb-3">
                <h2 className="text-lg font-semibold text-slate-900">Revenue & Orders Overview</h2>
                <p className="text-sm text-slate-600">Revenue trend for the selected range, backed by daily summaries.</p>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data?.charts?.revenueTrend || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis yAxisId="revenue" tickFormatter={formatCurrencyINR} />
                    <YAxis yAxisId="orders" orientation="right" />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Line yAxisId="revenue" type="monotone" dataKey="revenue" name="Revenue" stroke="#dc2626" strokeWidth={3} />
                    <Line yAxisId="orders" type="monotone" dataKey="orders" name="Orders" stroke="#0f172a" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card p-4 xl:col-span-5">
              <div className="mb-3">
                <h2 className="text-lg font-semibold text-slate-900">Peak Hours</h2>
                <p className="text-sm text-slate-600">See when order traffic is highest during the selected range.</p>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.charts?.peakHours || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
                    <YAxis />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="orders" name="Orders" fill="#111827" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-semibold text-slate-900">
                  Peak hour: {data?.peakHours?.current?.hour || '-'} ({data?.peakHours?.current?.orders || 0} orders)
                </p>
                <div className="mt-2">
                  <TrendDelta growth={data?.peakHours?.growth} />
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="card p-4 xl:col-span-6">
              <div className="mb-3">
                <h2 className="text-lg font-semibold text-slate-900">Views vs Orders</h2>
                <p className="text-sm text-slate-600">Track menu attention against actual completed orders.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Views</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">{data?.overview?.totalViews || 0}</p>
                  <div className="mt-2"><TrendDelta growth={data?.viewsVsOrders?.views} /></div>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Orders</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">{data?.overview?.totalOrders || 0}</p>
                  <div className="mt-2"><TrendDelta growth={data?.viewsVsOrders?.orders} /></div>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Conversion</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">{Number(data?.overview?.conversionRate || 0).toFixed(1)}%</p>
                  <div className="mt-2"><TrendDelta growth={data?.viewsVsOrders?.conversionRate} type="percent" /></div>
                </div>
              </div>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.viewsVsOrders?.comparison || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Bar dataKey="views" name="Views" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="orders" name="Orders" fill="#0f172a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card p-4 xl:col-span-6">
              <h2 className="text-lg font-semibold text-slate-900">Customer Insight</h2>
              <p className="mt-1 text-sm text-slate-600">
                Clear drop-off signal from attention to purchase.
              </p>
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">{data?.dropoffInsight?.message || 'No drop-off data yet.'}</p>
                <div className="mt-3">
                  <TrendDelta growth={data?.dropoffInsight?.lostUsers} />
                </div>
                <p className="mt-2 text-xs text-amber-900/80">
                  Lost users are calculated as total views minus completed orders for the selected period.
                </p>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Previous Range</p>
                  <p className="mt-1 text-lg font-bold text-slate-900">{data?.period?.previous?.startDate ? new Date(data.period.previous.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'} to {data?.period?.previous?.endDate ? new Date(data.period.previous.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current Range</p>
                  <p className="mt-1 text-lg font-bold text-slate-900">{data?.period?.current?.startDate ? new Date(data.period.current.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'} to {data?.period?.current?.endDate ? new Date(data.period.current.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="xl:col-span-6">
              <ItemList
                title="Top 5 Items"
                items={data?.items?.top || []}
                emptyText="Top items will appear as orders and revenue accumulate."
              />
            </div>
            <div className="xl:col-span-6">
              <ItemList
                title="Bottom 5 Items"
                items={data?.items?.bottom || []}
                emptyText="Bottom items will appear once enough menu activity exists."
              />
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
