import { ArrowLeft, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getInventoryModuleByKey } from '../features/inventory/inventoryModules'

export default function InventoryModulePage({ moduleKey }) {
  const moduleItem = getInventoryModuleByKey(moduleKey)

  if (!moduleItem) {
    return (
      <section className="rounded-2xl border border-rose-100 bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
        <h2 className="text-xl font-bold text-slate-900">Inventory Module Not Found</h2>
        <p className="mt-2 text-sm text-slate-500">The requested module is unavailable right now.</p>
        <Link to="/inventory" className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-[var(--primary)] hover:bg-rose-50">
          <ArrowLeft size={16} />
          Back to Inventory Dashboard
        </Link>
      </section>
    )
  }

  const Icon = moduleItem.icon

  return (
    <section className="rounded-2xl border border-rose-100 bg-[linear-gradient(160deg,#ffffff_0%,#fff8f9_72%,#fffefe_100%)] p-6 shadow-[0_16px_34px_rgba(15,23,42,0.08)] md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--primary)]">Inventory Module</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-900">{moduleItem.title}</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">{moduleItem.description}</p>
        </div>
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-rose-100 bg-white text-[var(--primary)]">
          <Icon size={22} />
        </span>
      </div>

      <div className="mt-6 rounded-2xl border border-dashed border-rose-200 bg-white/80 p-5 md:p-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-rose-100 bg-rose-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--primary)]">
          <Sparkles size={14} />
          Coming Soon
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          This screen is route-ready and designed for future inventory analytics, workflows, and operational actions.
          Existing dashboard functionality remains unchanged.
        </p>

        {moduleItem.key === 'purchase' ? (
          <Link
            to="/inventory/purchase/add"
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-700 bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_18px_rgba(220,38,38,0.25)] transition hover:bg-rose-700"
          >
            Open Add Purchase
          </Link>
        ) : null}
      </div>

      <Link to="/inventory" className="mt-6 inline-flex items-center gap-2 rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-[var(--primary)] hover:bg-rose-50">
        <ArrowLeft size={16} />
        Back to Inventory Dashboard
      </Link>
    </section>
  )
}
