import { useState } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import {
  useCreateInventoryWastage,
  useInventoryItems,
} from '../../../hooks/useInventoryPurchaseQueries'

const units = ['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet']

export default function WastageModule() {
  const { restaurant } = useAuth()
  const restaurantId = restaurant?._id
  const { data: items = [] } = useInventoryItems({ restaurantId })
  const wastageMutation = useCreateInventoryWastage({ restaurantId })

  const [form, setForm] = useState({
    inventoryItemId: '',
    quantity: '1',
    unit: 'Kg',
    reason: '',
  })
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  async function onSubmit(event) {
    event.preventDefault()
    setStatus('')
    setError('')

    if (!String(form.inventoryItemId || '').trim()) {
      setError('Please select an inventory item.')
      return
    }

    const quantity = Number(form.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Quantity must be greater than 0.')
      return
    }

    try {
      await wastageMutation.mutateAsync({
        inventoryItemId: form.inventoryItemId,
        quantity,
        unit: form.unit,
        reason: String(form.reason || '').trim(),
      })
      setStatus('Wastage recorded successfully.')
      setForm((prev) => ({ ...prev, quantity: '1', reason: '' }))
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'Failed to record wastage.')
    }
  }

  return (
    <section className="rounded-2xl border border-rose-100 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.08)] md:p-6">
      <h3 className="text-xl font-bold text-slate-900">Wastage Entry</h3>
      <p className="mt-1 text-sm text-slate-500">Create negative stock movement for spoilage or kitchen loss.</p>

      <form onSubmit={onSubmit} className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Item</span>
          <select
            value={form.inventoryItemId}
            onChange={(event) => setForm((prev) => ({ ...prev, inventoryItemId: event.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Select item</option>
            {items.map((item) => (
              <option key={item._id} value={item._id}>{item.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Quantity</span>
          <input
            type="number"
            min="0.000001"
            step="0.001"
            value={form.quantity}
            onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Unit</span>
          <select
            value={form.unit}
            onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            {units.map((unit) => (
              <option key={unit} value={unit}>{unit}</option>
            ))}
          </select>
        </label>

        <label className="block md:col-span-2">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Reason</span>
          <textarea
            rows={3}
            value={form.reason}
            onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="Spoilage, burn, expiry, accidental damage..."
          />
        </label>

        <div className="md:col-span-2 flex items-center gap-2">
          <button
            type="submit"
            disabled={wastageMutation.isPending}
            className="rounded-xl border border-rose-700 bg-rose-600 px-4 py-2 text-sm font-semibold text-white"
          >
            {wastageMutation.isPending ? 'Saving...' : 'Record Wastage'}
          </button>
          {status ? <span className="text-sm font-semibold text-emerald-700">{status}</span> : null}
          {error ? <span className="text-sm font-semibold text-rose-700">{error}</span> : null}
        </div>
      </form>
    </section>
  )
}
