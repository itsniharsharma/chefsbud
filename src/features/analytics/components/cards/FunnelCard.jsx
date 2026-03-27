import { Funnel, FunnelChart, LabelList, ResponsiveContainer, Tooltip } from 'recharts'
import CardContainer from '../CardContainer'

export default function FunnelCard({ steps = [], onOpen }) {
  return (
    <CardContainer title="Funnel" subtitle="Views to cart to completed orders." onClick={onOpen}>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <FunnelChart>
            <Tooltip />
            <Funnel data={steps} dataKey="value" isAnimationActive={false}>
              <LabelList position="right" fill="#0f172a" stroke="none" dataKey="name" />
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </div>
    </CardContainer>
  )
}
