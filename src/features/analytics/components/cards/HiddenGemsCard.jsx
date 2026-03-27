import { ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import CardContainer from '../CardContainer'
import { formatMoney, formatPercent } from '../formatters'

export default function HiddenGemsCard({ points = [], onOpen }) {
  return (
    <CardContainer title="Hidden Gems" subtitle="Low-view, high-conversion opportunities." onClick={onOpen}>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart>
            <XAxis dataKey="views" name="Views" tick={{ fontSize: 11 }} />
            <YAxis dataKey="conversion" name="Conversion" tick={{ fontSize: 11 }} />
            <ZAxis dataKey="revenue" range={[70, 600]} />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              formatter={(value, name) => {
                if (name === 'Conversion') return formatPercent(value)
                if (name === 'revenue') return formatMoney(value)
                return value
              }}
            />
            <Scatter name="Item" data={points} fill="#0ea5e9" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </CardContainer>
  )
}
