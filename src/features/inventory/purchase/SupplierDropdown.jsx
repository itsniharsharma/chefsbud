import { motion } from 'framer-motion'
import { ChevronDown, Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

export default function SupplierDropdown({
  suppliers = [],
  value = '',
  onChange,
  onCreateSupplier,
  isCreating = false,
}) {
  const MotionContainer = motion.div
  const rootRef = useRef(null)
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const selected = suppliers.find((supplier) => String(supplier._id || supplier.id) === String(value)) || null

  const filteredSuppliers = useMemo(() => {
    const normalized = String(searchTerm || '').trim().toLowerCase()
    if (!normalized) return suppliers

    return suppliers.filter((supplier) =>
      String(supplier.name || '').toLowerCase().includes(normalized),
    )
  }, [searchTerm, suppliers])

  useEffect(() => {
    const onOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [])

  const addSupplierFromSearch = () => {
    const nextName = String(searchTerm || '').trim()
    if (!nextName) return

    const created = onCreateSupplier?.(nextName)
    if (created && typeof created.then === 'function') {
      created.then((result) => {
        const createdId = String(result?._id || result?.id || '')
        if (!createdId) return
        onChange?.(createdId)
        setSearchTerm('')
        setIsOpen(false)
      })
      return
    }

    const createdId = String(created?._id || created?.id || '')
    if (createdId) {
      onChange?.(createdId)
      setSearchTerm('')
      setIsOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
        Supplier *
      </label>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm text-slate-700 shadow-sm transition hover:border-rose-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-rose-100"
      >
        <span className={selected ? 'text-slate-800' : 'text-slate-400'}>
          {selected ? selected.name : 'Select / Add Supplier'}
        </span>
        <ChevronDown size={16} className="text-slate-500" />
      </button>

      {isOpen ? (
        <MotionContainer
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="absolute left-0 right-0 z-20 mt-2 rounded-xl border border-rose-100 bg-white p-3 shadow-[0_16px_32px_rgba(15,23,42,0.16)]"
        >
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search supplier"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-100"
            />
          </div>

          <div className="mt-3 max-h-44 space-y-1 overflow-y-auto pr-1">
            {filteredSuppliers.length > 0 ? (
              filteredSuppliers.map((supplier) => (
                <button
                  key={supplier._id || supplier.id}
                  type="button"
                  onClick={() => {
                    onChange?.(String(supplier._id || supplier.id))
                    setIsOpen(false)
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-rose-50"
                >
                  {supplier.name}
                </button>
              ))
            ) : (
              <p className="px-1 py-2 text-sm text-slate-500">No supplier found</p>
            )}
          </div>

          <button
            type="button"
            onClick={addSupplierFromSearch}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isCreating || !String(searchTerm || '').trim()}
          >
            <Plus size={13} />
            {isCreating ? 'Adding Supplier...' : 'Add New Supplier'}
          </button>
        </MotionContainer>
      ) : null}
    </div>
  )
}
