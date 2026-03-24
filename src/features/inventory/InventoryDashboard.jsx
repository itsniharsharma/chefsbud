import { motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import InventoryCard from './InventoryCard'
import { inventoryModules } from './inventoryModules'

function InventorySkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading inventory modules">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={`inventory-skeleton-${index}`}
          className="h-44 animate-pulse rounded-xl border border-rose-100 bg-gradient-to-br from-white to-rose-50/50"
        />
      ))}
    </div>
  )
}

function InventoryEmptyState() {
  return (
    <div className="rounded-2xl border border-rose-100 bg-white px-6 py-10 text-center shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
      <p className="text-base font-semibold text-slate-800">No inventory modules found</p>
      <p className="mt-2 text-sm text-slate-500">Modules will appear here once inventory features are configured.</p>
    </div>
  )
}

export default function InventoryDashboard() {
  const [isLoading, setIsLoading] = useState(true)
  const MotionList = motion.ul

  useEffect(() => {
    const timer = window.setTimeout(() => setIsLoading(false), 320)
    return () => window.clearTimeout(timer)
  }, [])

  const modules = useMemo(() => inventoryModules, [])

  return (
    <section className="rounded-2xl border border-rose-100/80 bg-[linear-gradient(170deg,#ffffff_0%,#fff9f9_70%,#fffefe_100%)] p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)] md:p-7">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--primary)]">Inventory Operations</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-900 md:text-3xl">Inventory Control Center</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-500 md:text-base">
          Centralized modules for stock planning, procurement, and wastage control built for high-volume kitchen operations.
        </p>
      </div>

      {isLoading ? <InventorySkeletonGrid /> : null}

      {!isLoading && modules.length === 0 ? <InventoryEmptyState /> : null}

      {!isLoading && modules.length > 0 ? (
        <MotionList
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {modules.map((moduleItem, index) => (
            <InventoryCard key={moduleItem.route} moduleItem={moduleItem} index={index} />
          ))}
        </MotionList>
      ) : null}
    </section>
  )
}
