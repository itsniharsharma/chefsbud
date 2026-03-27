import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import CardContainer from '../CardContainer'

export default function BasketCard({ trend = [], onOpen }) {
  return (
    <CardContainer title="Customer Behavior" subtitle="Average items per order trend." onClick={onOpen}>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trend}>
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="avgItemsPerOrder" name="Avg Items / Order" stroke="#0f172a" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </CardContainer>
  )
}
