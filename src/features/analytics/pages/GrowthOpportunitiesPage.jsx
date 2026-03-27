import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import ChartWrapper from '../components/ChartWrapper'
import DataTable from '../components/DataTable'
import InsightBadge from '../components/InsightBadge'
import { formatMoney, formatPercent } from '../components/formatters'

const COLORS = ['#10b981', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ef4444', '#64748b']

export default function GrowthOpportunitiesPage({ data = {} }) {
  const columns = [
    { key: 'name', label: 'Item' },
    { key: 'views', label: 'Views' },
    { key: 'conversion', label: 'Conversion', render: (row) => formatPercent(row.conversion) },
    { key: 'revenue', label: 'Current Revenue', render: (row) => formatMoney(row.revenue) },
    { key: 'incrementalRevenue', label: 'Upside', render: (row) => formatMoney(row.incrementalRevenue) },
  ]

  return (
    <div className="space-y-4">
      <ChartWrapper title="Hidden Gems Table" subtitle="High conversion, low visibility items.">
        <DataTable columns={columns} rows={data?.hiddenGems || []} rowKey="itemId" />
      </ChartWrapper>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartWrapper title="Revenue Impact if Promoted" subtitle="Projected incremental contribution by item.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data?.revenueImpact || []} dataKey="value" nameKey="name" innerRadius={56} outerRadius={95}>
                  {(data?.revenueImpact || []).map((entry, index) => (
                    <Cell key={`${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatMoney(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ChartWrapper>

        <ChartWrapper title="Projection" subtitle="Estimated uplift from increased views.">
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Projected Revenue</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{formatMoney(data?.projection?.projectedRevenue || 0)}</p>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-700">Incremental Revenue</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{formatMoney(data?.projection?.totalIncrementalRevenue || 0)}</p>
            </div>
            <InsightBadge tone="amber" label="Use this page to prioritize menu placement campaigns." />
          </div>
        </ChartWrapper>
      </div>
    </div>
  )
}
