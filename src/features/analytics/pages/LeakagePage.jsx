import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ChartWrapper from '../components/ChartWrapper'
import DataTable from '../components/DataTable'
import { formatPercent } from '../components/formatters'

export default function LeakagePage({ data = {} }) {
  const columns = [
    { key: 'name', label: 'Item' },
    { key: 'views', label: 'Views' },
    { key: 'addToCart', label: 'Add to Cart' },
    { key: 'orders', label: 'Orders' },
    { key: 'dropPct', label: 'Drop %', render: (row) => formatPercent(row.dropPct) },
  ]

  return (
    <div className="space-y-4">
      <ChartWrapper title="Item Leakage Table" subtitle="Sorted by highest drop percentage.">
        <DataTable columns={columns} rows={data?.itemLeakageTable || []} rowKey="itemId" />
      </ChartWrapper>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartWrapper title="Stage Drop Analysis" subtitle="Where conversion breaks hardest.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.stageDropAnalysis || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="stage" />
                <YAxis />
                <Tooltip formatter={(value) => formatPercent(value)} />
                <Bar dataKey="dropPercent" name="Drop %" fill="#dc2626" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartWrapper>

        <ChartWrapper title="Top Problem Items Trend" subtitle="Worst 5 items by drop over selected range.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.topProblemItemsTrend || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip formatter={(value) => formatPercent(value)} />
                <Legend />
                {(data?.trendItems || []).map((itemName, index) => (
                  <Line
                    key={itemName}
                    type="monotone"
                    dataKey={itemName}
                    stroke={["#dc2626", "#f97316", "#f59e0b", "#0ea5e9", "#8b5cf6"][index % 5]}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartWrapper>
      </div>
    </div>
  )
}
