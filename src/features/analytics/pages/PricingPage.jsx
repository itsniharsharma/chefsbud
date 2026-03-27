import { Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import ChartWrapper from '../components/ChartWrapper'
import DataTable from '../components/DataTable'
import { formatPercent } from '../components/formatters'

export default function PricingPage({ data = {} }) {
  const flaggedColumns = [
    { key: 'name', label: 'Item' },
    { key: 'price', label: 'Price' },
    { key: 'conversion', label: 'Conversion', render: (row) => formatPercent(row.conversion) },
    { key: 'orders', label: 'Orders' },
  ]

  return (
    <div className="space-y-4">
      <ChartWrapper title="Price vs Conversion" subtitle="Find pricing-performance imbalance quickly.">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart>
              <XAxis dataKey="price" name="Price" />
              <YAxis dataKey="conversion" name="Conversion" />
              <Tooltip formatter={(value, name) => (name === 'Conversion' ? formatPercent(value) : value)} />
              <Scatter data={data?.scatter || []} fill="#ef4444" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </ChartWrapper>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartWrapper title="Overpriced Items" subtitle="High price, low conversion.">
          <DataTable columns={flaggedColumns} rows={data?.overpricedItems || []} rowKey="itemId" />
        </ChartWrapper>

        <ChartWrapper title="Underpriced Items" subtitle="Low price, high conversion.">
          <DataTable columns={flaggedColumns} rows={data?.underpricedItems || []} rowKey="itemId" />
        </ChartWrapper>
      </div>

      <ChartWrapper title="Price vs Orders Trend" subtitle="Orders and conversion by price band.">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data?.priceOrdersTrend || []}>
              <XAxis dataKey="band" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip formatter={(value, name) => (name === 'conversion' ? formatPercent(value) : value)} />
              <Line yAxisId="left" dataKey="orders" name="orders" stroke="#0f172a" strokeWidth={2} dot={false} />
              <Line yAxisId="right" dataKey="conversion" name="conversion" stroke="#dc2626" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartWrapper>
    </div>
  )
}
