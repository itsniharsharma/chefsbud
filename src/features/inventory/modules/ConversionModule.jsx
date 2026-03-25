import { useState } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import {
  useCreateInventoryConversion,
  useInventoryItems,
} from '../../../hooks/useInventoryPurchaseQueries'

const units = ['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet']

export default function ConversionModule() {
  const { restaurant } = useAuth()
  const restaurantId = restaurant?._id
  const { data: items = [] } = useInventoryItems({ restaurantId })
  const conversionMutation = useCreateInventoryConversion({ restaurantId })

  const [form, setForm] = useState({
    fromInventoryItemId: '',
    fromQuantity: '1',
    fromUnit: 'Kg',
    toInventoryItemId: '',
    toQuantity: '1',
    toUnit: 'Kg',
    note: '',
  })
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  async function onSubmit(event) {
    event.preventDefault()
    setStatus('')
    setError('')

    if (!String(form.fromInventoryItemId || '').trim() || !String(form.toInventoryItemId || '').trim()) {
      setError('Select both source and target items.')
      return
    }

    if (String(form.fromInventoryItemId) === String(form.toInventoryItemId)) {
      setError('Source and target items must be different.')
      return
    }

    const fromQuantity = Number(form.fromQuantity)
    const toQuantity = Number(form.toQuantity)
    if (!Number.isFinite(fromQuantity) || fromQuantity <= 0 || !Number.isFinite(toQuantity) || toQuantity <= 0) {
      setError('Both quantities must be greater than 0.')
      return
    }

    try {
      await conversionMutation.mutateAsync({
        fromInventoryItemId: form.fromInventoryItemId,
        fromQuantity,
        fromUnit: form.fromUnit,
        toInventoryItemId: form.toInventoryItemId,
        toQuantity,
        toUnit: form.toUnit,
        note: String(form.note || '').trim(),
      })
      setStatus('Conversion recorded successfully.')
      setForm((prev) => ({ ...prev, note: '' }))
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'Failed to record conversion.')
    }
  }

  return (
    <section className="rounded-2xl border border-rose-100 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.08)] md:p-6">
      <h3 className="text-xl font-bold text-slate-900">Material Conversion</h3>
      <p className="mt-1 text-sm text-slate-500">Convert one inventory item into another with ledger trace.</p>

      <form onSubmit={onSubmit} className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <h4 className="text-sm font-bold uppercase tracking-[0.08em] text-slate-500 md:col-span-2">From</h4>
        <select
          value={form.fromInventoryItemId}
          onChange={(event) => setForm((prev) => ({ ...prev, fromInventoryItemId: event.target.value }))}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">Source item</option>
          {items.map((item) => (
            <option key={item._id} value={item._id}>{item.name}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <input
            type="number"
            min="0.000001"
            step="0.001"
            value={form.fromQuantity}
            onChange={(event) => setForm((prev) => ({ ...prev, fromQuantity: event.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
          <select
            value={form.fromUnit}
            onChange={(event) => setForm((prev) => ({ ...prev, fromUnit: event.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            {units.map((unit) => (
              <option key={unit} value={unit}>{unit}</option>
            ))}
          </select>
        </div>

        <h4 className="text-sm font-bold uppercase tracking-[0.08em] text-slate-500 md:col-span-2">To</h4>
        <select
          value={form.toInventoryItemId}
          onChange={(event) => setForm((prev) => ({ ...prev, toInventoryItemId: event.target.value }))}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">Target item</option>
          {items.map((item) => (
            <option key={item._id} value={item._id}>{item.name}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <input
            type="number"
            min="0.000001"
            step="0.001"
            value={form.toQuantity}
            onChange={(event) => setForm((prev) => ({ ...prev, toQuantity: event.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
          <select
            value={form.toUnit}
            onChange={(event) => setForm((prev) => ({ ...prev, toUnit: event.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            {units.map((unit) => (
              <option key={unit} value={unit}>{unit}</option>
            ))}
          </select>
        </div>

        <textarea
          rows={3}
          value={form.note}
          onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
          placeholder="Optional conversion note"
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm md:col-span-2"
        />

        <div className="md:col-span-2 flex items-center gap-2">
          <button
            type="submit"
            disabled={conversionMutation.isPending}
            className="rounded-xl border border-rose-700 bg-rose-600 px-4 py-2 text-sm font-semibold text-white"
          >
            {conversionMutation.isPending ? 'Saving...' : 'Record Conversion'}
          </button>
          {status ? <span className="text-sm font-semibold text-emerald-700">{status}</span> : null}
          {error ? <span className="text-sm font-semibold text-rose-700">{error}</span> : null}
        </div>
      </form>
    </section>
  )
}
