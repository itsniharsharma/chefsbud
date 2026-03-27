import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ChartWrapper from '../components/ChartWrapper'
import DataTable from '../components/DataTable'
import { formatPercent } from '../components/formatters'

const COLORS = ['#f97316', '#dc2626']

export default function FunnelPage({ data = {} }) {
  const columns = [
    { key: 'name', label: 'Item' },
    { key: 'views', label: 'Views' },
    { key: 'addToCart', label: 'Cart' },
    { key: 'orders', label: 'Orders' },
    { key: 'conversion', label: 'Conversion %', render: (row) => formatPercent(row.conversion) },
  ]

  return (
    <div className="space-y-4">
      <ChartWrapper title="Item-wise Funnel Table" subtitle="Per-item stage performance.">
        <DataTable columns={columns} rows={data?.itemFunnelTable || []} rowKey="itemId" />
      </ChartWrapper>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartWrapper title="Stage Drop Comparison" subtitle="Identify the stage failing per item.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.stageDropComparison || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis />
                <Tooltip formatter={(value) => formatPercent(value)} />
                <Bar dataKey="viewToCartDropPct" name="View -> Cart Drop" fill="#f97316" radius={[6, 6, 0, 0]} />
                <Bar dataKey="cartToOrderDropPct" name="Cart -> Order Drop" fill="#dc2626" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartWrapper>

        <ChartWrapper title="Drop Distribution" subtitle="Share of leakage by stage.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data?.dropDistribution || []} dataKey="value" nameKey="name" innerRadius={56} outerRadius={95}>
                  {(data?.dropDistribution || []).map((entry, index) => (
                    <Cell key={`${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ChartWrapper>
      </div>
    </div>
  )
}
