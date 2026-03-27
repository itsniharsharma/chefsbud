import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ChartWrapper from '../components/ChartWrapper'
import { formatMoney, formatPercent } from '../components/formatters'

const COLORS = ['#dc2626', '#f97316', '#f59e0b', '#0ea5e9', '#8b5cf6', '#64748b']

export default function RevenueStructurePage({ data = {} }) {
  return (
    <div className="space-y-4">
      <ChartWrapper title="Item Contribution" subtitle="Top items driving revenue.">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data?.itemContribution || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={56} />
              <YAxis />
              <Tooltip formatter={(value) => formatMoney(value)} />
              <Bar dataKey="revenue" name="Revenue" fill="#111827" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartWrapper>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartWrapper title="Category Contribution" subtitle="Revenue share by category.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data?.categoryContribution || []} dataKey="revenue" nameKey="categoryName" innerRadius={56} outerRadius={96}>
                  {(data?.categoryContribution || []).map((entry, index) => (
                    <Cell key={`${entry.categoryName}-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatMoney(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ChartWrapper>

        <ChartWrapper title="Dependency Insight" subtitle="Revenue concentration risk indicator.">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-700">Top 3 Item Dependency</p>
            <p className="mt-2 text-3xl font-extrabold text-slate-900">{formatPercent(data?.dependency?.top3RevenueShare || 0)}</p>
            <p className="mt-2 text-sm text-slate-700">If this is high, diversify demand to reduce single-item risk exposure.</p>
          </div>
        </ChartWrapper>
      </div>
    </div>
  )
}
