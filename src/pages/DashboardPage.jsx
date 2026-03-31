import { useMemo } from 'react'
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

  const lowStockNotifications = Array.isArray(data?.notifications?.lowStock)
    ? data.notifications.lowStock
    : []

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

      <div className="card p-4 md:p-5">
        <h2 className="text-lg font-semibold">Low Stock Notifications</h2>
        <p className="mt-1 text-sm text-slate-600">
          Alerts expire automatically after 24 hours.
        </p>

        {!lowStockNotifications.length ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            No low-stock alerts right now.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {lowStockNotifications.map((notification, index) => (
              <article
                key={String(notification?.itemId || `${notification?.itemName || 'item'}-${index}`)}
                className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                {notification?.message || 'Stock level is below threshold. Kindly refill.'}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
