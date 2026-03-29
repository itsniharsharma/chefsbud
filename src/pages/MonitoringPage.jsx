import InventoryReconciliationDashboard from '../components/InventoryReconciliationDashboard'
import { useAuth } from '../hooks/useAuth'

/**
 * Admin monitoring page for inventory reconciliation
 * Accessible only to restaurant owners/admins
 */

export const MonitoringPage = () => {
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'

  if (!isOwner) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-800 shadow-[0_12px_26px_rgba(15,23,42,0.08)]">
        <h2 className="text-xl font-bold">Owner Access Required</h2>
        <p className="mt-2 text-sm">
          Inventory monitoring controls are restricted to owner accounts.
        </p>
      </section>
    )
  }

  return (
    <section className="py-2 md:py-4">
        <InventoryReconciliationDashboard />
    </section>
  )
}

export default MonitoringPage
