import { Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import ChartWrapper from '../components/ChartWrapper'
import InsightBadge from '../components/InsightBadge'

export default function QualityPage({ data = {} }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartWrapper title="Rating vs Orders" subtitle="Performance by rating bucket.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <XAxis dataKey="rating" name="Rating" domain={[1, 5]} tickCount={5} />
                <YAxis dataKey="orders" name="Orders" />
                <Tooltip />
                <Scatter data={data?.ratingVsOrders || []} fill="#10b981" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </ChartWrapper>

        <ChartWrapper title="Highlights" subtitle="Prioritized quality-performance mismatches.">
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">High Rating, Low Orders</p>
              <p className="mt-2 text-sm text-slate-700">
                {(data?.highlights?.highRatingLowOrders || []).length
                  ? (data?.highlights?.highRatingLowOrders || []).map((entry) => `Rating ${entry.rating}: ${entry.orders} orders`).join(' | ')
                  : 'No major mismatch found.'}
              </p>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-rose-700">Low Rating, High Orders</p>
              <p className="mt-2 text-sm text-slate-700">
                {(data?.highlights?.lowRatingHighOrders || []).length
                  ? (data?.highlights?.lowRatingHighOrders || []).map((entry) => `Rating ${entry.rating}: ${entry.orders} orders`).join(' | ')
                  : 'No urgent quality risk found.'}
              </p>
            </div>
            <InsightBadge tone="amber" label="Use this to prioritize quality interventions by impact." />
          </div>
        </ChartWrapper>
      </div>

      <ChartWrapper title="Rating Trend Over Time" subtitle="Average customer rating trend in selected range.">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data?.ratingTrend || []}>
              <XAxis dataKey="label" />
              <YAxis domain={[0, 5]} />
              <Tooltip />
              <Line type="monotone" dataKey="avgRating" stroke="#0f172a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartWrapper>
    </div>
  )
}
