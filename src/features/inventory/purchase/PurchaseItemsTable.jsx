import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

function toNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function formatAmount(value) {
  return toNumber(value).toFixed(2)
}

export default function PurchaseItemsTable({
  items = [],
  itemOptions = [],
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  onCreateCatalogItem,
  isCreatingCatalogItem = false,
}) {
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [targetRowIndex, setTargetRowIndex] = useState(null)
  const [newItemName, setNewItemName] = useState('')
  const [newItemUnit, setNewItemUnit] = useState('Unit')

  const openCreator = (rowIndex = null) => {
    setCreatorOpen(true)
    setTargetRowIndex(Number.isInteger(rowIndex) ? rowIndex : null)
  }

  const submitCatalogItem = async () => {
    const name = String(newItemName || '').trim()
    if (!name || !onCreateCatalogItem) return

    const created = await onCreateCatalogItem({
      name,
      defaultUnit: newItemUnit,
      targetRowIndex,
    })

    if (created?._id) {
      setNewItemName('')
      setNewItemUnit('Unit')
      setCreatorOpen(false)
      setTargetRowIndex(null)
    }
  }

  return (
    <section className="rounded-2xl border border-rose-100 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.06)] md:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-slate-600">Purchase Items</h3>
        <button
          type="button"
          onClick={onAddRow}
          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
        >
          <Plus size={14} />
          Add Item
        </button>
      </div>

      {creatorOpen ? (
        <div className="mb-3 rounded-xl border border-rose-100 bg-rose-50/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">Add Item Name</p>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_140px_auto]">
            <input
              type="text"
              value={newItemName}
              onChange={(event) => setNewItemName(event.target.value)}
              placeholder="Enter item name"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100"
            />
            <select
              value={newItemUnit}
              onChange={(event) => setNewItemUnit(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100"
            >
              <option value="Kg">Kg</option>
              <option value="Gram">Gram</option>
              <option value="Litre">Litre</option>
              <option value="Ml">Ml</option>
              <option value="Unit">Unit</option>
              <option value="Packet">Packet</option>
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitCatalogItem}
                disabled={isCreatingCatalogItem || !String(newItemName || '').trim()}
                className="rounded-xl border border-rose-700 bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isCreatingCatalogItem ? 'Saving...' : 'Save Item'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatorOpen(false)
                  setTargetRowIndex(null)
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-[920px] w-full border-separate border-spacing-y-2">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
              <th className="px-2 py-1">Item Name</th>
              <th className="px-2 py-1">Quantity</th>
              <th className="px-2 py-1">Unit</th>
              <th className="px-2 py-1">Rate</th>
              <th className="px-2 py-1">Amount</th>
              <th className="px-2 py-1">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row, index) => {
              const quantity = toNumber(row.quantity)
              const rate = toNumber(row.rate)
              const amount = quantity * rate

              return (
                <tr key={row.id} className="rounded-xl bg-slate-50/80">
                  <td className="px-2 py-2">
                    <select
                      value={row.itemId}
                      onChange={(event) => {
                        const nextValue = event.target.value
                        if (nextValue === '__add_new__') {
                          openCreator(index)
                          return
                        }
                        onUpdateRow(index, 'itemId', nextValue)
                      }}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100"
                    >
                      <option value="">Select item</option>
                      {itemOptions.map((item) => (
                        <option key={item._id} value={item._id}>
                          {item.name}
                        </option>
                      ))}
                      <option value="__add_new__">+ Add new item</option>
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.quantity}
                      onChange={(event) => onUpdateRow(index, 'quantity', event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={row.unit}
                      onChange={(event) => onUpdateRow(index, 'unit', event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100"
                    >
                      <option value="Kg">Kg</option>
                      <option value="Gram">Gram</option>
                      <option value="Litre">Litre</option>
                      <option value="Unit">Unit</option>
                      <option value="Packet">Packet</option>
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.rate}
                      onChange={(event) => onUpdateRow(index, 'rate', event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="text"
                      value={formatAmount(amount)}
                      disabled
                      className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => onRemoveRow(index)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-rose-200 bg-white text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={items.length <= 1}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
