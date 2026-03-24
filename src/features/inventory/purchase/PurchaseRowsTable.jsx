import { Pencil, Save, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'

function toNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function formatMoney(value) {
  return toNumber(value).toFixed(2)
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('en-IN')
}

function rowKey(row) {
  return `${String(row?.purchaseId || '')}:${String(row?.itemIndex || 0)}`
}

export default function PurchaseRowsTable({
  rows = [],
  onSaveRow,
  onDeleteRow,
  isSaving = false,
  isDeleting = false,
}) {
  const [editingKey, setEditingKey] = useState('')
  const [draft, setDraft] = useState({ quantity: '0', rate: '0', unit: 'Unit', paymentType: 'Unpaid' })

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime()),
    [rows],
  )

  const startEdit = (row) => {
    setEditingKey(rowKey(row))
    setDraft({
      quantity: String(row?.quantity ?? '0'),
      rate: String(row?.rate ?? '0'),
      unit: String(row?.unit || 'Unit'),
      paymentType: String(row?.paymentType || 'Unpaid'),
    })
  }

  const cancelEdit = () => {
    setEditingKey('')
    setDraft({ quantity: '0', rate: '0', unit: 'Unit', paymentType: 'Unpaid' })
  }

  const saveEdit = async (row) => {
    if (!onSaveRow) return
    await onSaveRow({
      purchaseId: String(row?.purchaseId || ''),
      itemIndex: Number(row?.itemIndex || 0),
      payload: {
        quantity: toNumber(draft.quantity),
        rate: toNumber(draft.rate),
        unit: draft.unit,
        paymentType: draft.paymentType,
      },
    })
    setEditingKey('')
  }

  const deleteRow = async (row) => {
    if (!onDeleteRow) return
    const canDelete = window.confirm('Delete this purchase item row permanently? This will remove it from database.')
    if (!canDelete) return

    await onDeleteRow({
      purchaseId: String(row?.purchaseId || ''),
      itemIndex: Number(row?.itemIndex || 0),
    })

    if (editingKey === rowKey(row)) {
      cancelEdit()
    }
  }

  return (
    <section className="rounded-2xl border border-rose-100 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.06)] md:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-slate-600">Saved Purchase Items</h3>
        <p className="text-xs font-semibold text-slate-500">Each row is one purchased item</p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1080px] w-full border-separate border-spacing-y-2">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
              <th className="px-2 py-1">Date</th>
              <th className="px-2 py-1">Invoice</th>
              <th className="px-2 py-1">Supplier</th>
              <th className="px-2 py-1">Item</th>
              <th className="px-2 py-1">Quantity</th>
              <th className="px-2 py-1">Unit</th>
              <th className="px-2 py-1">Rate</th>
              <th className="px-2 py-1">Amount</th>
              <th className="px-2 py-1">Status</th>
              <th className="px-2 py-1">Action</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="rounded-xl bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
                  No purchase items saved yet.
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => {
                const key = rowKey(row)
                const editing = key === editingKey

                return (
                  <tr key={key} className="rounded-xl bg-slate-50/80">
                    <td className="px-2 py-2 text-sm text-slate-700">{formatDate(row.invoiceDate)}</td>
                    <td className="px-2 py-2 text-sm text-slate-700">{row.invoiceNumber || '-'}</td>
                    <td className="px-2 py-2 text-sm text-slate-700">{row.supplierName || row.sourceType || '-'}</td>
                    <td className="px-2 py-2 text-sm font-medium text-slate-800">{row.itemName || '-'}</td>

                    <td className="px-2 py-2">
                      {editing ? (
                        <input
                          type="number"
                          min="0.0001"
                          step="0.01"
                          value={draft.quantity}
                          onChange={(event) => setDraft((prev) => ({ ...prev, quantity: event.target.value }))}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                        />
                      ) : (
                        <span className="text-sm text-slate-700">{toNumber(row.quantity)}</span>
                      )}
                    </td>

                    <td className="px-2 py-2">
                      {editing ? (
                        <select
                          value={draft.unit}
                          onChange={(event) => setDraft((prev) => ({ ...prev, unit: event.target.value }))}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                        >
                          <option value="Kg">Kg</option>
                          <option value="Gram">Gram</option>
                          <option value="Litre">Litre</option>
                          <option value="Ml">Ml</option>
                          <option value="Unit">Unit</option>
                          <option value="Packet">Packet</option>
                        </select>
                      ) : (
                        <span className="text-sm text-slate-700">{row.unit || '-'}</span>
                      )}
                    </td>

                    <td className="px-2 py-2">
                      {editing ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={draft.rate}
                          onChange={(event) => setDraft((prev) => ({ ...prev, rate: event.target.value }))}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                        />
                      ) : (
                        <span className="text-sm text-slate-700">{formatMoney(row.rate)}</span>
                      )}
                    </td>

                    <td className="px-2 py-2 text-sm font-semibold text-slate-800">
                      {editing ? formatMoney(toNumber(draft.quantity) * toNumber(draft.rate)) : formatMoney(row.amount)}
                    </td>

                    <td className="px-2 py-2">
                      {editing ? (
                        <select
                          value={draft.paymentType}
                          onChange={(event) =>
                            setDraft((prev) => ({ ...prev, paymentType: event.target.value }))
                          }
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                        >
                          <option value="Unpaid">Unpaid</option>
                          <option value="Paid">Paid</option>
                        </select>
                      ) : (
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            String(row.paymentType || 'Unpaid') === 'Paid'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {row.paymentType || 'Unpaid'}
                        </span>
                      )}
                    </td>

                    <td className="px-2 py-2">
                      {editing ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => saveEdit(row)}
                            disabled={isSaving}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-600 bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            <Save size={13} />
                            {isSaving ? 'Saving' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={isDeleting}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                          >
                            <X size={13} />
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteRow(row)}
                            disabled={isSaving || isDeleting}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-600 bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            <Trash2 size={13} />
                            {isDeleting ? 'Deleting' : 'Delete'}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            disabled={isDeleting}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            <Pencil size={13} />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteRow(row)}
                            disabled={isDeleting}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-600 bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            <Trash2 size={13} />
                            {isDeleting ? 'Deleting' : 'Delete'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
