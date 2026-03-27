import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart, CartesianGrid } from 'recharts'
import ChartWrapper from '../components/ChartWrapper'
import DataTable from '../components/DataTable'

const COLORS = ['#0ea5e9', '#8b5cf6']

export default function BasketPage({ data = {} }) {
  const columns = [
    { key: 'pair', label: 'Frequently Bought Together' },
    { key: 'count', label: 'Orders' },
  ]

  return (
    <div className="space-y-4">
      <ChartWrapper title="Frequently Bought Together" subtitle="Top item combinations by completed orders.">
        <DataTable columns={columns} rows={data?.frequentlyBoughtTogether || []} rowKey="pair" />
      </ChartWrapper>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartWrapper title="Basket Size Distribution" subtitle="How many unique items per order.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.basketSizeDistribution || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="size" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#0f172a" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartWrapper>

        <ChartWrapper title="Order Type Split" subtitle="Single-item vs multi-item orders.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data?.orderTypeSplit || []} dataKey="value" nameKey="name" innerRadius={56} outerRadius={96}>
                  {(data?.orderTypeSplit || []).map((entry, index) => (
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
