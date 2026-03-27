import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import CardContainer from '../CardContainer'
import { formatMoney } from '../formatters'

const COLORS = ['#dc2626', '#f97316', '#f59e0b', '#14b8a6', '#0ea5e9', '#8b5cf6', '#64748b']

export default function RevenueDriversCard({ split = [], onOpen }) {
  return (
    <CardContainer title="Revenue Drivers" subtitle="Top contributors and concentration risk." onClick={onOpen}>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={split} dataKey="value" nameKey="name" innerRadius={44} outerRadius={78} paddingAngle={2}>
              {split.map((entry, index) => (
                <Cell key={`${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => formatMoney(value)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </CardContainer>
  )
}
