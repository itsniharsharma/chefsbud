import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../services/api'

/**
 * Admin dashboard for inventory reconciliation monitoring
 * Displays:
 * - Circuit breaker status
 * - Inventory violations analytics
 * - Orders with inconsistencies
 * - Manual reconciliation actions
 */

export const InventoryReconciliationDashboard = () => {
  const [loading, setLoading] = useState(true)
  const [circuitBreakers, setCircuitBreakers] = useState({})
  const [violations, setViolations] = useState({ violationsByType: [], severitySummary: [], totalUnresolved: 0 })
  const [inconsistentOrders, setInconsistentOrders] = useState([])
  const [error, setError] = useState('')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [clearingOrder, setClearingOrder] = useState(null)

  const breakerList = useMemo(() => Object.entries(circuitBreakers || {}), [circuitBreakers])

  const formatDateTime = (value) => {
    if (!value) return 'N/A'
    const dt = new Date(value)
    if (Number.isNaN(dt.getTime())) return 'N/A'
    return dt.toLocaleString([], {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const requestErrorMessage = (requestError, fallback) => {
    return requestError?.response?.data?.error || requestError?.message || fallback
  }

  const normalizeOrders = (orders = []) => {
    return orders.map((order) => {
      const inconsistencies = Array.isArray(order.inventoryInconsistencies) ? order.inventoryInconsistencies : []
      const latestInconsistency = inconsistencies.length > 0 ? inconsistencies[inconsistencies.length - 1] : null
      return {
        ...order,
        inconsistencyCount: inconsistencies.length,
        latestInconsistency,
      }
    })
  }

  const fetchDashboardData = useCallback(async () => {
    setLoading(true)
    try {
      const [breakersRes, violationsRes, ordersRes] = await Promise.all([
        api.get('/inventory/monitoring/circuit-breakers'),
        api.get('/inventory/reconciliation/violations-analytics', { params: { daysBack: 30 } }),
        api.get('/inventory/reconciliation/orders', { params: { limit: 50 } }),
      ])

      setCircuitBreakers(breakersRes?.data?.breakers || {})
      setViolations(violationsRes?.data || { violationsByType: [], severitySummary: [], totalUnresolved: 0 })
      setInconsistentOrders(normalizeOrders(ordersRes?.data?.orders || []))
      setError('')
    } catch (requestError) {
      setError(requestErrorMessage(requestError, 'Failed to load monitoring data'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDashboardData()
    const interval = window.setInterval(fetchDashboardData, 60000)

    return () => window.clearInterval(interval)
  }, [fetchDashboardData])

  const handleClearInconsistencies = async (orderId) => {
    try {
      setClearingOrder(orderId)
      await api.post(`/inventory/reconciliation/orders/${orderId}/clear`)
      setInconsistentOrders((prev) => prev.filter((o) => o._id !== orderId))
      setSelectedOrder(null)
      setError('')
    } catch (requestError) {
      setError(requestErrorMessage(requestError, 'Failed to clear inconsistencies'))
    } finally {
      setClearingOrder(null)
    }
  }

  const resetCircuitBreaker = async (breakerName) => {
    try {
      await api.post(`/inventory/monitoring/circuit-breakers/${breakerName}/reset`)
      await fetchDashboardData()
    } catch (requestError) {
      setError(requestErrorMessage(requestError, 'Failed to reset circuit breaker'))
    }
  }

  const getStateClasses = (state) => {
    switch (state) {
      case 'CLOSED':
        return 'border-emerald-200 bg-emerald-50 text-emerald-700'
      case 'OPEN':
        return 'border-red-200 bg-red-50 text-red-700'
      case 'HALF_OPEN':
        return 'border-amber-200 bg-amber-50 text-amber-700'
      default:
        return 'border-slate-200 bg-slate-50 text-slate-700'
    }
  }

  const severityChipClasses = (isCritical) => {
    return isCritical
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-amber-200 bg-amber-50 text-amber-700'
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-rose-100 bg-white p-6 shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
        <p className="text-sm font-semibold text-slate-600">Loading inventory monitoring...</p>
      </div>
    )
  }

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-rose-100 bg-[linear-gradient(145deg,#fff,#fff7f7)] p-5 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--primary)]">Production Health</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-900">Inventory Reconciliation Monitoring</h2>
        <p className="mt-2 text-sm text-slate-500">
          Live visibility into circuit breakers, violation trends, and inconsistent orders.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      <section className="rounded-2xl border border-rose-100 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.08)] md:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-base font-bold text-slate-900">Circuit Breakers</h3>
          <button
            type="button"
            onClick={fetchDashboardData}
            className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-[var(--primary)] hover:bg-rose-50"
          >
            Refresh
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {breakerList.length === 0 ? (
            <p className="text-sm text-slate-500">No circuit breaker instances registered yet.</p>
          ) : null}
          {breakerList.map(([name, status]) => (
            <article key={name} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">{name}</p>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${getStateClasses(status.state)}`}>
                  {status.state}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Failures: {status.failureCount || 0} | Successes: {status.successCount || 0}
              </p>
              {status.lastError ? (
                <p className="mt-2 text-xs text-red-600">Last error: {status.lastError}</p>
              ) : null}
              {status.state === 'OPEN' ? (
                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-500">Retry at: {formatDateTime(status.nextAttempt)}</p>
                  <button
                    type="button"
                    onClick={() => resetCircuitBreaker(name)}
                    className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                  >
                    Reset
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-rose-100 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.07)] md:p-5">
          <h3 className="text-base font-bold text-slate-900">Violations by Type (30 days)</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[380px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.14em] text-slate-500">
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-2 py-2 text-right">Critical</th>
                </tr>
              </thead>
              <tbody>
                {violations.violationsByType?.length ? (
                  violations.violationsByType.map((item) => (
                    <tr key={item._id} className="border-b border-slate-100">
                      <td className="px-2 py-2 text-slate-700">{item._id}</td>
                      <td className="px-2 py-2 text-right font-semibold text-slate-800">{item.count}</td>
                      <td className="px-2 py-2 text-right">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${severityChipClasses(Number(item.criticalCount || 0) > 0)}`}
                        >
                          {item.criticalCount || 0}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-2 py-3 text-center text-sm text-slate-500">
                      No violations recorded in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="rounded-2xl border border-rose-100 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.07)] md:p-5">
          <h3 className="text-base font-bold text-slate-900">Severity Summary</h3>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-sm font-semibold text-slate-600">Total Unresolved</p>
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${severityChipClasses(Number(violations.totalUnresolved || 0) > 0)}`}
              >
                {violations.totalUnresolved || 0}
              </span>
            </div>
            {violations.severitySummary?.map((item) => (
              <div key={item._id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                <p className="text-sm font-medium capitalize text-slate-700">{item._id}</p>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${severityChipClasses(item._id === 'critical')}`}
                >
                  {item.unresolved || 0}
                </span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-rose-100 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.08)] md:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-base font-bold text-slate-900">
            Orders with Inconsistencies ({inconsistentOrders.length})
          </h3>
          <p className="text-xs font-medium text-slate-500">Auto-refresh every 60s</p>
        </div>

        {inconsistentOrders.length === 0 ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
            No orders with unresolved inconsistencies.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.14em] text-slate-500">
                  <th className="px-2 py-2">Order</th>
                  <th className="px-2 py-2">Table</th>
                  <th className="px-2 py-2">Violations</th>
                  <th className="px-2 py-2">Last Error</th>
                  <th className="px-2 py-2">Completed At</th>
                  <th className="px-2 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {inconsistentOrders.map((order) => (
                  <tr key={order._id} className="border-b border-slate-100">
                    <td className="px-2 py-2 font-mono text-xs text-slate-700">{String(order._id).slice(0, 10)}...</td>
                    <td className="px-2 py-2 text-slate-700">F{order.floorNumber} / T{order.tableNumber}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${severityChipClasses((order.inconsistencyCount || 0) > 3)}`}
                      >
                        {order.inconsistencyCount || 0}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-600">
                      {order.latestInconsistency?.error || 'N/A'}
                    </td>
                    <td className="px-2 py-2 text-slate-600">{formatDateTime(order.completedAt)}</td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedOrder(order)}
                        className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-[var(--primary)] hover:bg-rose-50"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedOrder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-rose-100 bg-white p-5 shadow-[0_20px_44px_rgba(15,23,42,0.24)]">
            <h4 className="text-lg font-bold text-slate-900">Order Inconsistency Details</h4>
            <div className="mt-4 space-y-2 text-sm text-slate-700">
              <p><span className="font-semibold">Order ID:</span> {String(selectedOrder._id)}</p>
              <p><span className="font-semibold">Location:</span> Floor {selectedOrder.floorNumber}, Table {selectedOrder.tableNumber}</p>
              <p><span className="font-semibold">Violations:</span> {selectedOrder.inconsistencyCount || 0}</p>
              <p><span className="font-semibold">Latest Error:</span> {selectedOrder.latestInconsistency?.error || 'N/A'}</p>
              <p><span className="font-semibold">Latest Timestamp:</span> {formatDateTime(selectedOrder.latestInconsistency?.timestamp)}</p>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setSelectedOrder(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="rounded-lg border border-red-200 bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
                onClick={() => handleClearInconsistencies(selectedOrder._id)}
                disabled={clearingOrder === selectedOrder._id}
              >
                {clearingOrder === selectedOrder._id ? 'Clearing...' : 'Clear Inconsistencies'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default InventoryReconciliationDashboard
