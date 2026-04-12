import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { useMemo, useState } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useInventoryRealtimeSync } from '../../../hooks/useInventoryRealtimeSync'
import { useInventoryAnalyticsOverview } from '../../../hooks/useInventoryPurchaseQueries'
import { formatCurrencyINR } from '../../../utils/currency'

const PIE_COLORS = ['#e11d48', '#f97316', '#f59e0b', '#84cc16', '#0ea5e9', '#14b8a6', '#6366f1', '#8b5cf6', '#64748b']

function chunkRows(rows = [], size = 8) {
  if (!Array.isArray(rows) || size <= 0) return []
  const chunks = []
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size))
  }
  return chunks
}

function formatQuantity(value) {
  const numeric = Number(value || 0)
  return numeric.toFixed(2).replace(/\.00$/, '')
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`
}

function InventoryMetricCard({ title, value, subtitle }) {
  return (
    <div className="rounded-2xl border border-rose-100 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-extrabold text-slate-900">{value}</p>
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
    </div>
  )
}

export default function InventoryAnalyticsModule() {
  const { restaurant } = useAuth()
  const restaurantId = restaurant?._id
  const [drilldownMetric, setDrilldownMetric] = useState(null)
  useInventoryRealtimeSync({ restaurantId, enabled: Boolean(restaurantId) })

  const { data, isLoading, isFetching, refetch } = useInventoryAnalyticsOverview({ restaurantId })

  const kpis = data?.kpis || {}
  const stock = data?.stock || {}
  const stockValueDistribution = useMemo(
    () => (Array.isArray(stock.stockValueDistribution) ? stock.stockValueDistribution : []),
    [stock.stockValueDistribution],
  )
  const stockQuantityDistribution = useMemo(
    () => (Array.isArray(stock.stockQuantityDistribution) ? stock.stockQuantityDistribution : []),
    [stock.stockQuantityDistribution],
  )
  const stockValueFullDistribution = useMemo(
    () => (Array.isArray(stock.stockValueFullDistribution) ? stock.stockValueFullDistribution : []),
    [stock.stockValueFullDistribution],
  )
  const stockQuantityFullDistribution = useMemo(
    () => (Array.isArray(stock.stockQuantityFullDistribution) ? stock.stockQuantityFullDistribution : []),
    [stock.stockQuantityFullDistribution],
  )
  const hiddenValueRows = useMemo(
    () => stockValueFullDistribution.slice(8),
    [stockValueFullDistribution],
  )
  const hiddenQuantityRows = useMemo(
    () => stockQuantityFullDistribution.slice(8),
    [stockQuantityFullDistribution],
  )
  const drilldownChunks = useMemo(() => {
    if (drilldownMetric === 'value') return chunkRows(hiddenValueRows, 8)
    if (drilldownMetric === 'quantity') return chunkRows(hiddenQuantityRows, 8)
    return []
  }, [drilldownMetric, hiddenValueRows, hiddenQuantityRows])
  const drilldownTitle = drilldownMetric === 'value'
    ? 'Stock Value Others Breakdown'
    : 'Stock Quantity Others Breakdown'

  return (
    <section className="rounded-2xl border border-rose-100 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.08)] md:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-slate-900">Inventory Analytics Overview</h3>
          <p className="mt-1 text-sm text-slate-500">
            End-to-end raw inventory view across stock, purchasing, movement, and recipe coverage.
          </p>
        </div>

        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-[var(--primary)] hover:bg-rose-50"
        >
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {isLoading ? <p className="text-sm text-slate-500">Loading inventory analytics...</p> : null}

      {!isLoading ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <InventoryMetricCard
              title="Inventory Items"
              value={formatQuantity(kpis.totalInventoryItems)}
              subtitle={`${formatQuantity(kpis.itemsWithStock)} with stock • ${formatQuantity(kpis.zeroOrNegativeStockItems)} empty/negative`}
            />
            <InventoryMetricCard
              title="Stock Availability"
              value={formatPercent(kpis.stockAvailabilityPercent)}
              subtitle="Share of inventory items currently above zero"
            />
            <InventoryMetricCard
              title="Estimated Stock Value"
              value={formatCurrencyINR(kpis.estimatedStockValue || 0)}
              subtitle={`Avg/item ${formatCurrencyINR(kpis.averageStockValuePerItem || 0)}`}
            />
            <InventoryMetricCard
              title="Recipe Coverage"
              value={formatPercent(kpis.recipeCoveragePercent)}
              subtitle={`${formatQuantity(kpis.recipeCount)} recipes mapped to ${formatQuantity(kpis.menuItemsCount)} menu items`}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-rose-100 bg-white p-4">
              <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Stock Value Distribution</h4>
              <p className="mt-1 text-sm text-slate-500">
                Metric: Estimated Value (INR)
              </p>
              <div className="mt-3 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stockValueDistribution}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={62}
                      outerRadius={95}
                      paddingAngle={1}
                      minAngle={2}
                      onClick={(entry) => {
                        if (String(entry?.itemId || '') === 'others' && hiddenValueRows.length) {
                          setDrilldownMetric('value')
                        }
                      }}
                    >
                      {stockValueDistribution.map((row, index) => (
                        <Cell key={`${row.itemId}-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip
                      formatter={(value, _name, entry) => {
                        const raw = Number(entry?.payload?.valueRaw ?? value)
                        return formatCurrencyINR(raw)
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-rose-100 bg-white p-4">
              <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Live Current Stock Distribution</h4>
              <p className="mt-1 text-sm text-slate-500">
                Metric: Current Stock Quantity (base units, real-time refresh).
              </p>
              <div className="mt-3 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stockQuantityDistribution}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={62}
                      outerRadius={95}
                      paddingAngle={1}
                      minAngle={2}
                      onClick={(entry) => {
                        if (String(entry?.itemId || '') === 'others' && hiddenQuantityRows.length) {
                          setDrilldownMetric('quantity')
                        }
                      }}
                    >
                      {stockQuantityDistribution.map((row, index) => (
                        <Cell key={`qty-${row.itemId}-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip
                      formatter={(value, _name, entry) => {
                        const raw = Number(entry?.payload?.valueRaw ?? value)
                        const unit = String(entry?.payload?.stockUnit || '')
                        return `${formatQuantity(raw)}${unit ? ` ${unit}` : ''}`
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {drilldownChunks.length ? (
            <div className="rounded-2xl border border-rose-100 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">{drilldownTitle}</h4>
                <button
                  type="button"
                  onClick={() => setDrilldownMetric(null)}
                  className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-[var(--primary)] hover:bg-rose-50"
                >
                  Close Breakdown
                </button>
              </div>
              <p className="mb-3 text-sm text-slate-500">Clicking Others opens row/column sub-pies for remaining items.</p>
              <div className="grid grid-cols-1 gap-6 md:gap-8 xl:grid-cols-2">
                {drilldownChunks.map((chunk, chunkIndex) => (
                  <div key={`drilldown-${drilldownMetric}-${chunkIndex}`} className="rounded-xl border border-rose-100 bg-rose-50/20 p-4 min-h-[500px] shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Segment {chunkIndex + 1}</p>
                    <div className="mt-2 h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={chunk} dataKey="value" nameKey="name" innerRadius={44} outerRadius={72} paddingAngle={1} minAngle={2}>
                            {chunk.map((row, index) => (
                              <Cell key={`drill-${chunkIndex}-${row.itemId}-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Legend />
                          <Tooltip
                            formatter={(value, _name, entry) => {
                              const raw = Number(entry?.payload?.valueRaw ?? value)
                              if (drilldownMetric === 'value') return formatCurrencyINR(raw)
                              const unit = String(entry?.payload?.stockUnit || '')
                              return `${formatQuantity(raw)}${unit ? ` ${unit}` : ''}`
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

        </div>
      ) : null}
    </section>
  )
}
