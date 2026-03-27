import { ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import CardContainer from '../CardContainer'

export default function QualityCard({ points = [], onOpen }) {
  return (
    <CardContainer title="Quality vs Performance" subtitle="Rating-to-order impact map." onClick={onOpen}>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart>
            <XAxis dataKey="rating" name="Rating" domain={[1, 5]} tickCount={5} tick={{ fontSize: 11 }} />
            <YAxis dataKey="orders" name="Orders" tick={{ fontSize: 11 }} />
            <Tooltip />
            <Scatter data={points} fill="#10b981" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </CardContainer>
  )
}
