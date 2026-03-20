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
import Card from '../components/Card'
import Button from '../components/Button'
import { useAuth } from '../hooks/useAuth'
import { useAnalyticsOverviewQuery } from '../hooks/useDashboardQueries'
import { formatCurrencyINR } from '../utils/currency'

const RANGE_OPTIONS = [7, 14, 30]

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`
}

export default function AnalyticsPage() {
  const { restaurant } = useAuth()
  const [rangeDays, setRangeDays] = useState(14)
  const { data, isLoading, isError } = useAnalyticsOverviewQuery({
    restaurantId: restaurant?._id,
    rangeDays,
  })

  const cards = [
    { title: 'Views', value: String(data?.cards?.totalViews || 0) },
    { title: 'Add To Cart', value: String(data?.cards?.totalAddToCart || 0) },
    { title: 'Completed Orders', value: String(data?.cards?.totalOrders || 0) },
    { title: 'Revenue', value: formatCurrencyINR(data?.cards?.totalRevenue || 0) },
  ]

  const funnelCards = [
    { title: 'View to Cart', value: formatPercent(data?.cards?.viewToCartRate || 0) },
    { title: 'Cart to Order', value: formatPercent(data?.cards?.cartToOrderRate || 0) },
    { title: 'View to Order', value: formatPercent(data?.cards?.viewToOrderRate || 0) },
  ]

  return (
    <section className="space-y-5">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Menu Funnel Analytics</h2>
          <p className="text-sm text-slate-600">
            Track how menu exposure turns into cart intent, completed orders, and revenue.
          </p>
        </div>
        <div className="flex gap-2">
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

      {isLoading ? <div className="card p-4 text-sm text-slate-500">Loading analytics...</div> : null}
      {isError ? (
        <div className="card p-4 text-sm text-[var(--primary)]">
          Unable to load analytics right now.
        </div>
      ) : null}

      {!isLoading && !isError ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => (
              <Card key={card.title} title={card.title} value={card.value} accent />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {funnelCards.map((card) => (
              <Card key={card.title} title={card.title} value={card.value} />
            ))}
          </div>

          <div className="card h-80 p-4">
            <div className="mb-3">
              <h3 className="text-lg font-semibold text-slate-900">Daily Trend</h3>
              <p className="text-sm text-slate-600">
                Views, cart actions, completed orders, and revenue across the selected range.
              </p>
            </div>
            <ResponsiveContainer width="100%" height="86%">
              <LineChart data={data?.trends || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis yAxisId="count" />
                <YAxis yAxisId="revenue" orientation="right" tickFormatter={formatCurrencyINR} />
                <Tooltip formatter={(value, name) => (name === 'revenue' ? formatCurrencyINR(value) : value)} />
                <Legend />
                <Bar yAxisId="count" dataKey="views" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="count" dataKey="addToCart" fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Line yAxisId="count" type="monotone" dataKey="orders" stroke="#0f172a" strokeWidth={3} />
                <Line yAxisId="revenue" type="monotone" dataKey="revenue" stroke="#16a34a" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="card h-80 p-4">
              <h3 className="mb-3 text-lg font-semibold text-slate-900">Top Viewed vs Ordered</h3>
              <ResponsiveContainer width="100%" height="86%">
                <BarChart data={data?.topItems?.byViews || []} layout="vertical" margin={{ left: 16, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={120} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="views" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="orders" fill="#0f172a" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card h-80 p-4">
              <h3 className="mb-3 text-lg font-semibold text-slate-900">Top Revenue Items</h3>
              <ResponsiveContainer width="100%" height="86%">
                <BarChart data={data?.topItems?.byRevenue || []} layout="vertical" margin={{ left: 16, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={formatCurrencyINR} />
                  <YAxis type="category" dataKey="name" width={120} />
                  <Tooltip formatter={(value) => formatCurrencyINR(value)} />
                  <Bar dataKey="revenue" fill="#16a34a" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="card p-4">
              <h3 className="text-lg font-semibold text-slate-900">Item Funnel</h3>
              <p className="mb-3 text-sm text-slate-600">
                High-signal menu items ranked by revenue contribution.
              </p>
              <div className="space-y-3">
                {(data?.itemFunnel || []).map((item) => (
                  <div key={item.menuItemId} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-slate-900">{item.name}</p>
                      <p className="text-sm font-semibold text-emerald-700">{formatCurrencyINR(item.revenue)}</p>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600 md:grid-cols-4">
                      <span>Views: {item.views}</span>
                      <span>Cart: {item.addToCart}</span>
                      <span>Orders: {item.orders}</span>
                      <span>Qty Sold: {item.quantitySold}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <span className="rounded bg-amber-50 px-2 py-1 text-amber-800">
                        V-C {formatPercent(item.viewToCartRate)}
                      </span>
                      <span className="rounded bg-rose-50 px-2 py-1 text-rose-800">
                        C-O {formatPercent(item.cartToOrderRate)}
                      </span>
                      <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-800">
                        V-O {formatPercent(item.viewToOrderRate)}
                      </span>
                    </div>
                  </div>
                ))}
                {!data?.itemFunnel?.length ? (
                  <p className="text-sm text-slate-500">Not enough analytics data yet.</p>
                ) : null}
              </div>
            </div>

            <div className="card p-4">
              <h3 className="text-lg font-semibold text-slate-900">Opportunity Items</h3>
              <p className="mb-3 text-sm text-slate-600">
                Items getting visibility but converting weakly into completed orders.
              </p>
              <div className="space-y-3">
                {(data?.topItems?.opportunities || []).map((item) => (
                  <div key={item.menuItemId} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-slate-900">{item.name}</p>
                      <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">
                        {formatPercent(item.viewToOrderRate)} view-order
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
                      <span>Views: {item.views}</span>
                      <span>Cart: {item.addToCart}</span>
                      <span>Orders: {item.orders}</span>
                      <span>Revenue: {formatCurrencyINR(item.revenue)}</span>
                    </div>
                  </div>
                ))}
                {!data?.topItems?.opportunities?.length ? (
                  <p className="text-sm text-slate-500">Opportunity insights will appear as usage grows.</p>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
