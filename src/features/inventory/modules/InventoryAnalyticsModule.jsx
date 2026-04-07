import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useMemo } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useInventoryRealtimeSync } from '../../../hooks/useInventoryRealtimeSync'
import { useInventoryAnalyticsOverview } from '../../../hooks/useInventoryPurchaseQueries'
import { formatCurrencyINR } from '../../../utils/currency'

const PIE_COLORS = ['#e11d48', '#f97316', '#f59e0b', '#84cc16', '#0ea5e9', '#14b8a6', '#6366f1', '#8b5cf6', '#64748b']

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

function ChartTooltip({ active, payload, label }) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg">
      {label ? <p className="mb-2 font-semibold text-slate-900">{label}</p> : null}
      {payload.map((entry) => {
        const isMoney = String(entry?.dataKey || '').toLowerCase().includes('spend')
        return (
          <p key={`${entry.dataKey}-${entry.name}`} className="text-slate-600">
            <span className="font-medium" style={{ color: entry.color }}>{entry.name}:</span>{' '}
            {isMoney ? formatCurrencyINR(entry.value) : formatQuantity(entry.value)}
          </p>
        )
      })}
    </div>
  )
}

export default function InventoryAnalyticsModule() {
  const { restaurant } = useAuth()
  const restaurantId = restaurant?._id
  useInventoryRealtimeSync({ restaurantId, enabled: Boolean(restaurantId) })

  const { data, isLoading, isFetching, refetch } = useInventoryAnalyticsOverview({ restaurantId })

  const kpis = data?.kpis || {}
  const stock = data?.stock || {}
  const purchasing = data?.purchasing || {}
  const movement = data?.movement || {}

  const sourceMixChart = useMemo(
    () =>
      (Array.isArray(purchasing.sourceMix) ? purchasing.sourceMix : []).map((row) => ({
        name: row.sourceType,
        invoices: Number(row.invoices || 0),
        spend: Number(row.spend || 0),
      })),
    [purchasing.sourceMix],
  )

  const movementTrend = useMemo(() => (Array.isArray(movement.trend14d) ? movement.trend14d : []), [movement.trend14d])
  const movementByType = useMemo(() => (Array.isArray(movement.byType) ? movement.byType : []), [movement.byType])
  const stockValueDistribution = useMemo(
    () => (Array.isArray(stock.stockValueDistribution) ? stock.stockValueDistribution : []),
    [stock.stockValueDistribution],
  )
  const stockQuantityDistribution = useMemo(
    () => (Array.isArray(stock.stockQuantityDistribution) ? stock.stockQuantityDistribution : []),
    [stock.stockQuantityDistribution],
  )
  const topItemsByValue = useMemo(
    () => (Array.isArray(stock.topItemsByEstimatedValue) ? stock.topItemsByEstimatedValue : []),
    [stock.topItemsByEstimatedValue],
  )
  const topWastageItems = useMemo(
    () => (Array.isArray(movement.topWastageItems) ? movement.topWastageItems : []),
    [movement.topWastageItems],
  )

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
                    <Pie data={stockValueDistribution} dataKey="value" nameKey="name" innerRadius={62} outerRadius={95} paddingAngle={1} minAngle={2}>
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
                    <Pie data={stockQuantityDistribution} dataKey="value" nameKey="name" innerRadius={62} outerRadius={95} paddingAngle={1} minAngle={2}>
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

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-rose-100 bg-white p-4">
              <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Purchasing Source Mix (30d)</h4>
              <p className="mt-1 text-sm text-slate-500">
                {formatQuantity(purchasing.invoiceCount)} invoices • {formatCurrencyINR(purchasing.totalSpend || 0)} spend
              </p>
              <div className="mt-3 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sourceMixChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="invoices" name="Invoices" fill="#e11d48" radius={[8, 8, 0, 0]} />
                    <Bar yAxisId="right" dataKey="spend" name="Spend" fill="#0f172a" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-rose-100 bg-white p-4">
              <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Movement Trend (14d)</h4>
              <p className="mt-1 text-sm text-slate-500">Signed quantity movement by ledger type in base units.</p>
              <div className="mt-3 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={movementTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Line type="monotone" dataKey="purchase" name="Purchase" stroke="#16a34a" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="consumption" name="Consumption" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="wastage" name="Wastage" stroke="#dc2626" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="adjustment" name="Adjustment" stroke="#a16207" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="conversionIn" name="Conversion In" stroke="#4f46e5" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="conversionOut" name="Conversion Out" stroke="#7c3aed" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-rose-100 bg-white p-4">
              <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Inventory Movement Mix (30d)</h4>
              <p className="mt-1 text-sm text-slate-500">Absolute and net quantity by movement type.</p>
              <div className="mt-3 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={movementByType}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="type" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Bar dataKey="absoluteQuantity" name="Absolute Qty" fill="#fb7185" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="netQuantity" name="Net Qty" fill="#0f172a" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-rose-100 bg-white p-4">
              <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Top Inventory by Estimated Value</h4>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full divide-y divide-rose-100 text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">Stock</th>
                      <th className="px-3 py-2">Avg Rate</th>
                      <th className="px-3 py-2">Estimated Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rose-50">
                    {topItemsByValue.slice(0, 10).map((row) => (
                      <tr key={row.itemId}>
                        <td className="px-3 py-2 font-semibold text-slate-800">{row.name}</td>
                        <td className="px-3 py-2 text-slate-700">{formatQuantity(row.stockQuantity)} {row.stockUnit}</td>
                        <td className="px-3 py-2 text-slate-700">{formatCurrencyINR(row.avgPurchaseRatePerBaseUnit || 0)} / {row.stockUnit}</td>
                        <td className="px-3 py-2 font-semibold text-slate-900">{formatCurrencyINR(row.estimatedStockValue || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-rose-100 bg-white p-4">
              <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Top Wastage Items (30d)</h4>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full divide-y divide-rose-100 text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">Wastage Qty</th>
                      <th className="px-3 py-2">Unit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rose-50">
                    {topWastageItems.length ? topWastageItems.map((row) => (
                      <tr key={`${row.itemId}-${row.unit}`}>
                        <td className="px-3 py-2 font-semibold text-slate-800">{row.name}</td>
                        <td className="px-3 py-2 text-slate-700">{formatQuantity(row.quantity)}</td>
                        <td className="px-3 py-2 text-slate-700">{row.unit}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td className="px-3 py-4 text-sm text-slate-500" colSpan={3}>No wastage records in this window.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
