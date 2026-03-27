import { ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import CardContainer from '../CardContainer'
import { formatPercent } from '../formatters'

export default function PricingCard({ points = [], onOpen }) {
  return (
    <CardContainer title="Pricing Intelligence" subtitle="Price-to-conversion signal map." onClick={onOpen}>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart>
            <XAxis dataKey="price" name="Price" tick={{ fontSize: 11 }} />
            <YAxis dataKey="conversion" name="Conversion" tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value, name) => (name === 'Conversion' ? formatPercent(value) : value)} />
            <Scatter data={points} fill="#ef4444" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </CardContainer>
  )
}
