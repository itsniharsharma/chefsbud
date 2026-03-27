import { Bar, BarChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import CardContainer from '../CardContainer'
import { formatPercent } from '../formatters'

export default function LeakageCard({ data = [], onOpen }) {
  return (
    <CardContainer title="Money Leakage" subtitle="Track visibility-to-order leakage over time." onClick={onOpen}>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="left" />
            <YAxis yAxisId="right" orientation="right" tickFormatter={(value) => `${value}%`} />
            <Tooltip formatter={(value, name) => (name === 'Conversion %' ? formatPercent(value) : value)} />
            <Bar yAxisId="left" dataKey="views" name="Views" fill="#fb923c" radius={[6, 6, 0, 0]} />
            <Bar yAxisId="left" dataKey="orders" name="Orders" fill="#111827" radius={[6, 6, 0, 0]} />
            <Line yAxisId="right" dataKey="conversion" name="Conversion %" stroke="#e11d48" strokeWidth={2} dot={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </CardContainer>
  )
}
