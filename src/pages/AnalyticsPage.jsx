import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import Button from '../components/Button'
import Card from '../components/Card'
import { useAuth } from '../hooks/useAuth'
import { useAnalyticsOverviewQuery } from '../hooks/useDashboardQueries'
import { formatCurrencyINR } from '../utils/currency'

const RANGE_OPTIONS = [7, 14, 30]
const BAND_META = {
  attention_leak: {
    label: 'High Views, Low Orders',
    tone: 'border-rose-200 bg-rose-50 text-rose-700',
    color: '#e11d48',
  },
  star: {
    label: 'Star Performer',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    color: '#16a34a',
  },
  hidden_gem: {
    label: 'Hidden Gem',
    tone: 'border-sky-200 bg-sky-50 text-sky-700',
    color: '#0284c7',
  },
  steady: {
    label: 'Balanced',
    tone: 'border-amber-200 bg-amber-50 text-amber-700',
    color: '#d97706',
  },
  low_signal: {
    label: 'Low Signal',
    tone: 'border-slate-200 bg-slate-50 text-slate-700',
    color: '#64748b',
  },
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`
}

function bandLabel(value) {
  return BAND_META[value]?.label || BAND_META.low_signal.label
}

function bandTone(value) {
  return BAND_META[value]?.tone || BAND_META.low_signal.tone
}

function bandColor(value) {
  return BAND_META[value]?.color || BAND_META.low_signal.color
}

function TooltipValue({ active, payload, label }) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg">
      {label ? <p className="mb-2 font-semibold text-slate-900">{label}</p> : null}
      <div className="space-y-1">
        {payload.map((entry) => (
          <p key={`${entry.name}-${entry.dataKey}`} className="text-slate-600">
            <span className="font-medium" style={{ color: entry.color }}>{entry.name}:</span>{' '}
            {entry.dataKey?.toLowerCase().includes('revenue') ? formatCurrencyINR(entry.value) : entry.value}
          </p>
        ))}
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

  const cards = useMemo(
    () => [
      { title: 'Views', value: String(data?.cards?.totalViews || 0) },
      { title: 'Add To Cart', value: String(data?.cards?.totalAddToCart || 0) },
      { title: 'Completed Orders', value: String(data?.cards?.totalOrders || 0) },
      { title: 'Revenue', value: formatCurrencyINR(data?.cards?.totalRevenue || 0) },
    ],
    [data],
  )

  const signalCards = useMemo(
    () => [
      { title: 'View to Cart', value: formatPercent(data?.cards?.viewToCartRate || 0) },
      { title: 'Cart to Order', value: formatPercent(data?.cards?.cartToOrderRate || 0) },
      { title: 'Top 3 Revenue Share', value: formatPercent(data?.cards?.topRevenueConcentration || 0) },
      {
        title: 'Peak Demand Hour',
        value: data?.cards?.peakHourLabel
          ? `${data.cards.peakHourLabel} (${data.cards.peakHourOrders || 0})`
          : '-',
      },
    ],
    [data],
  )

  const funnelStages = data?.funnel?.stages?.map((stage) => ({
    ...stage,
    fill:
      stage.key === 'views'
        ? '#f59e0b'
        : stage.key === 'add_to_cart'
          ? '#ef4444'
          : '#0f172a',
  })) || []

  const heatmapData = (data?.heatmap || []).map((item) => ({
    ...item,
    x: item.views,
    y: item.orders,
    z: Math.max(120, Number(item.revenue || 0) / 2),
  }))

  return (
    <section className="space-y-5">
      <div className="card overflow-hidden border border-red-100 bg-[linear-gradient(135deg,#fff7ed_0%,#ffffff_52%,#fef2f2_100%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-600">Revenue Intelligence</p>
            <h1 className="mt-2 text-2xl font-extrabold text-slate-900 md:text-3xl">
              Analytics that show what gets attention, what converts, and what actually makes money.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 md:text-base">
              This dashboard compares menu exposure, cart intent, completed orders, and revenue in one grid so
              owners can spot weak items, hidden winners, and peak demand periods fast.
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
      {isError ? (
        <div className="card p-4 text-sm text-[var(--primary)]">Unable to load analytics right now.</div>
      ) : null}

      {!isLoading && !isError ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => (
              <Card key={card.title} title={card.title} value={card.value} accent />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {signalCards.map((card) => (
              <Card key={card.title} title={card.title} value={card.value} />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="card p-4 xl:col-span-4">
              <div className="mb-3">
                <h2 className="text-lg font-semibold text-slate-900">Conversion Funnel</h2>
                <p className="text-sm text-slate-600">See where customers drop between visibility, intent, and purchase.</p>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <FunnelChart>
                    <Tooltip content={<TooltipValue />} />
                    <Funnel dataKey="value" data={funnelStages} isAnimationActive>
                      {funnelStages.map((entry) => (
                        <Cell key={entry.key} fill={entry.fill} />
                      ))}
                    </Funnel>
                  </FunnelChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">View to Cart Drop</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {data?.funnel?.dropoffs?.viewToCart?.count || 0} users lost
                  </p>
                  <p className="text-xs text-slate-600">
                    {formatPercent(data?.funnel?.dropoffs?.viewToCart?.rate || 0)} drop-off
                  </p>
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Cart to Order Drop</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {data?.funnel?.dropoffs?.cartToOrder?.count || 0} carts lost
                  </p>
                  <p className="text-xs text-slate-600">
                    {formatPercent(data?.funnel?.dropoffs?.cartToOrder?.rate || 0)} drop-off
                  </p>
                </div>
              </div>
            </div>

            <div className="card p-4 xl:col-span-8">
              <div className="mb-3">
                <h2 className="text-lg font-semibold text-slate-900">Views vs Orders</h2>
                <p className="text-sm text-slate-600">
                  Items with high attention but weak order conversion appear immediately.
                </p>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.comparisons?.viewsVsOrders || []} margin={{ left: 10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-18} textAnchor="end" height={70} />
                    <YAxis />
                    <Tooltip content={<TooltipValue />} />
                    <Legend />
                    <Bar dataKey="views" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="orders" fill="#0f172a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="card p-4 xl:col-span-3">
              <h2 className="text-lg font-semibold text-slate-900">Most Viewed</h2>
              <p className="mb-3 text-sm text-slate-600">Items attracting the most customer attention.</p>
              <div className="space-y-3">
                {(data?.topItems?.byViews || []).map((item, index) => (
                  <div key={item.menuItemId} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">
                        {index + 1}. {item.name}
                      </p>
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                        {item.views} views
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{item.orders} orders • {formatPercent(item.viewToOrderRate)} V-O</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-4 xl:col-span-3">
              <h2 className="text-lg font-semibold text-slate-900">Most Ordered</h2>
              <p className="mb-3 text-sm text-slate-600">Items customers actually complete purchases for.</p>
              <div className="space-y-3">
                {(data?.topItems?.byOrders || []).map((item, index) => (
                  <div key={item.menuItemId} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">
                        {index + 1}. {item.name}
                      </p>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                        {item.orders} orders
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{item.views} views • {formatCurrencyINR(item.revenue)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-4 xl:col-span-6">
              <div className="mb-3">
                <h2 className="text-lg font-semibold text-slate-900">Revenue Contribution by Item</h2>
                <p className="text-sm text-slate-600">
                  See whether a small group of items is carrying the business.
                </p>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.revenueContribution || []} layout="vertical" margin={{ left: 18, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={formatCurrencyINR} />
                    <YAxis type="category" dataKey="name" width={120} />
                    <Tooltip content={<TooltipValue />} />
                    <Legend />
                    <Bar dataKey="revenue" fill="#16a34a" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(data?.revenueContribution || []).map((item) => (
                  <span key={item.menuItemId} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
                    {item.name}: {formatPercent(item.revenueShare)}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="card p-4 xl:col-span-7">
              <div className="mb-3">
                <h2 className="text-lg font-semibold text-slate-900">Demand Over Time</h2>
                <p className="text-sm text-slate-600">Spot peak demand windows and when revenue is strongest.</p>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data?.orderDemand?.hourlyTrend || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={1} />
                    <YAxis yAxisId="count" />
                    <YAxis yAxisId="revenue" orientation="right" tickFormatter={formatCurrencyINR} />
                    <Tooltip content={<TooltipValue />} />
                    <Legend />
                    <Bar yAxisId="count" dataKey="orders" fill="#0f172a" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="revenue" type="monotone" dataKey="revenue" stroke="#16a34a" strokeWidth={3} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card p-4 xl:col-span-5">
              <div className="mb-3">
                <h2 className="text-lg font-semibold text-slate-900">Performance Heatmap</h2>
                <p className="text-sm text-slate-600">Weak converters, steady items, hidden gems, and stars in one view.</p>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 12, right: 12, bottom: 12, left: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" dataKey="x" name="Views" />
                    <YAxis type="number" dataKey="y" name="Orders" />
                    <ZAxis type="number" dataKey="z" range={[80, 560]} />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      content={({ active, payload }) => {
                        const item = active && payload?.[0]?.payload ? payload[0].payload : null
                        if (!item) return null
                        return (
                          <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg">
                            <p className="font-semibold text-slate-900">{item.name}</p>
                            <p className="mt-1 text-slate-600">{bandLabel(item.performanceBand)}</p>
                            <p className="mt-2 text-slate-600">Views: {item.views}</p>
                            <p className="text-slate-600">Orders: {item.orders}</p>
                            <p className="text-slate-600">Revenue: {formatCurrencyINR(item.revenue)}</p>
                          </div>
                        )
                      }}
                    />
                    <Scatter data={heatmapData}>
                      {heatmapData.map((entry) => (
                        <Cell key={entry.menuItemId} fill={bandColor(entry.performanceBand)} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(BAND_META).map(([key, meta]) => (
                  <span key={key} className={`rounded-full border px-3 py-1 text-xs font-medium ${meta.tone}`}>
                    {meta.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="card p-4 xl:col-span-6">
              <h2 className="text-lg font-semibold text-slate-900">Item Opportunity Board</h2>
              <p className="mb-3 text-sm text-slate-600">
                Items with strong visibility but weak purchase conversion deserve immediate attention.
              </p>
              <div className="space-y-3">
                {(data?.topItems?.opportunities || []).map((item) => (
                  <div key={item.menuItemId} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-slate-900">{item.name}</p>
                      <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${bandTone(item.performanceBand)}`}>
                        {bandLabel(item.performanceBand)}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600 md:grid-cols-4">
                      <span>{item.views} views</span>
                      <span>{item.addToCart} carts</span>
                      <span>{item.orders} orders</span>
                      <span>{formatCurrencyINR(item.revenue)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded bg-amber-50 px-2 py-1 text-amber-800">
                        V-C {formatPercent(item.viewToCartRate)}
                      </span>
                      <span className="rounded bg-rose-50 px-2 py-1 text-rose-800">
                        C-O {formatPercent(item.cartToOrderRate)}
                      </span>
                      <span className="rounded bg-slate-100 px-2 py-1 text-slate-700">
                        V-O {formatPercent(item.viewToOrderRate)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-4 xl:col-span-6">
              <h2 className="text-lg font-semibold text-slate-900">Revenue-First Item Grid</h2>
              <p className="mb-3 text-sm text-slate-600">
                The most commercially important items, ranked by revenue impact and funnel strength.
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {(data?.itemFunnel || []).slice(0, 8).map((item) => (
                  <div key={item.menuItemId} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{item.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{bandLabel(item.performanceBand)}</p>
                      </div>
                      <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${bandTone(item.performanceBand)}`}>
                        {formatCurrencyINR(item.revenue)}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <span>Views: {item.views}</span>
                      <span>Cart: {item.addToCart}</span>
                      <span>Orders: {item.orders}</span>
                      <span>Qty: {item.quantitySold}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                      <span className="rounded bg-amber-50 px-2 py-1 text-center text-amber-800">
                        {formatPercent(item.viewToCartRate)}
                      </span>
                      <span className="rounded bg-rose-50 px-2 py-1 text-center text-rose-800">
                        {formatPercent(item.cartToOrderRate)}
                      </span>
                      <span className="rounded bg-emerald-50 px-2 py-1 text-center text-emerald-800">
                        {formatPercent(item.viewToOrderRate)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
