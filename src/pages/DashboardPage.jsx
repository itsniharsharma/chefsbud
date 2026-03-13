import { useMemo } from 'react'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Card from '../components/Card'
import { useAuth } from '../hooks/useAuth'
import { formatCurrencyINR } from '../utils/currency'
import { useDashboardAnalyticsCardsQuery } from '../hooks/useDashboardQueries'

export default function DashboardPage() {
  const { restaurant } = useAuth()
  const { data } = useDashboardAnalyticsCardsQuery({
    restaurantId: restaurant?._id,
  })

  const cards = useMemo(() => {
    if (!data?.cards) {
      return [
        { title: "Today's Revenue", value: formatCurrencyINR(0) },
        { title: 'Total Orders Today', value: '0' },
        { title: 'Average Order Value', value: formatCurrencyINR(0) },
        { title: 'Active Tables', value: '0' },
      ]
    }

    return [
      { title: "Today's Revenue", value: formatCurrencyINR(data.cards.todayRevenue) },
      { title: 'Total Orders Today', value: String(data.cards.totalOrdersToday || 0) },
      { title: 'Average Order Value', value: formatCurrencyINR(data.cards.averageOrderValue) },
      { title: 'Active Tables', value: String(data.cards.activeTables || 0) },
    ]
  }, [data])

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((stat) => (
          <Card key={stat.title} title={stat.title} value={stat.value} accent />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="card p-4 xl:col-span-3">
          <h2 className="text-lg font-semibold">Dashboard Snapshot</h2>
          <p className="mt-2 text-sm text-slate-600">
            Revenue trend helps you track how daily sales move over time.
          </p>
        </div>
      </div>

      <div className="card h-64 p-4 md:h-72">
        <h2 className="mb-3 text-lg font-semibold">Revenue Trend</h2>
        <ResponsiveContainer width="100%" height="90%">
          <LineChart data={data?.revenueTrend || []}>
            <XAxis
              dataKey="day"
              label={{ value: 'X-Axis: Day', position: 'insideBottom', offset: -4 }}
            />
            <YAxis
              tickFormatter={(value) => formatCurrencyINR(value)}
              label={{ value: 'Y-Axis: Revenue (INR)', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip />
            <Line type="monotone" dataKey="revenue" stroke="#E50914" strokeWidth={3} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
