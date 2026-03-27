import { useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useAnalyticsDecisionQuery } from '../hooks/useDashboardQueries'
import AnalyticsLayout from '../features/analytics/components/AnalyticsLayout'
import { DashboardLoadingSkeleton } from '../features/analytics/components/LoadingSkeleton'
import BasketPage from '../features/analytics/pages/BasketPage'
import ControlRoomPage from '../features/analytics/pages/ControlRoomPage'
import FunnelPage from '../features/analytics/pages/FunnelPage'
import GrowthOpportunitiesPage from '../features/analytics/pages/GrowthOpportunitiesPage'
import LeakagePage from '../features/analytics/pages/LeakagePage'
import PricingPage from '../features/analytics/pages/PricingPage'
import QualityPage from '../features/analytics/pages/QualityPage'
import RevenueStructurePage from '../features/analytics/pages/RevenueStructurePage'

const DRILLDOWN_LINKS = [
  { to: '/dashboard/analytics', label: 'Control Room', end: true },
  { to: '/dashboard/analytics/leakage', label: 'Leakage' },
  { to: '/dashboard/analytics/growth-opportunities', label: 'Growth' },
  { to: '/dashboard/analytics/revenue-structure', label: 'Revenue' },
  { to: '/dashboard/analytics/funnel', label: 'Funnel' },
  { to: '/dashboard/analytics/pricing', label: 'Pricing' },
  { to: '/dashboard/analytics/basket', label: 'Basket' },
  { to: '/dashboard/analytics/quality', label: 'Quality' },
]

function DrilldownNav() {
  return (
    <div className="card p-3">
      <div className="flex flex-wrap gap-2">
        {DRILLDOWN_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={Boolean(link.end)}
            className={({ isActive }) =>
              `rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition ${
                isActive
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800'
              }`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </div>
    </div>
  )
}

export default function AnalyticsPage() {
  const { restaurant } = useAuth()
  const [range, setRange] = useState('14d')
  const restaurantId = restaurant?._id

  const { data, isLoading, isError, refetch, isFetching } = useAnalyticsDecisionQuery({
    restaurantId,
    range,
  })

  const kpis = useMemo(() => data?.kpis || {}, [data])

  return (
    <AnalyticsLayout range={range} onRangeChange={setRange} kpis={kpis}>
      <DrilldownNav />

      {isLoading ? <DashboardLoadingSkeleton /> : null}
      {!isLoading && isError ? (
        <div className="card p-4">
          <p className="text-sm text-red-700">Unable to load analytics right now.</p>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
          >
            {isFetching ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      ) : null}

      {!isLoading && !isError ? (
        <Routes>
          <Route index element={<ControlRoomPage cards={data?.dashboardCards} />} />
          <Route path="leakage" element={<LeakagePage data={data?.drilldowns?.leakage} />} />
          <Route
            path="growth-opportunities"
            element={<GrowthOpportunitiesPage data={data?.drilldowns?.growthOpportunities} />}
          />
          <Route
            path="revenue-structure"
            element={<RevenueStructurePage data={data?.drilldowns?.revenueStructure} />}
          />
          <Route path="funnel" element={<FunnelPage data={data?.drilldowns?.funnel} />} />
          <Route path="pricing" element={<PricingPage data={data?.drilldowns?.pricing} />} />
          <Route path="basket" element={<BasketPage data={data?.drilldowns?.basket} />} />
          <Route path="quality" element={<QualityPage data={data?.drilldowns?.quality} />} />
          <Route path="*" element={<Navigate to="/dashboard/analytics" replace />} />
        </Routes>
      ) : null}
    </AnalyticsLayout>
  )
}
