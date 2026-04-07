import { useMemo, useState } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import {
  useBootstrapInventoryStock,
  useInventoryItems,
  useUpdateInventoryItemDefaultUnit,
} from '../../../hooks/useInventoryPurchaseQueries'

const allowedUnits = ['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet']

function toStockText(item) {
  const quantity = Number(item?.currentStock || 0)
  const unit = String(item?.currentStockUnit || 'unit')
  return `${quantity.toFixed(3)} ${unit}`
}

export default function CurrentStockModule() {
  const { restaurant } = useAuth()
  const restaurantId = restaurant?._id
  const bootstrapMutation = useBootstrapInventoryStock({ restaurantId })
  const updateDefaultUnitMutation = useUpdateInventoryItemDefaultUnit({ restaurantId })
  const { data: items = [], isLoading, refetch, isFetching } = useInventoryItems({ restaurantId })
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [editingUnits, setEditingUnits] = useState({})
  const [syncingItemId, setSyncingItemId] = useState('')

  const sorted = useMemo(
    () => [...items].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''))),
    [items],
  )

  async function handleBootstrap() {
    setStatus('')
    setError('')
    try {
      const response = await bootstrapMutation.mutateAsync({ batchSize: 250 })
      const summary = response?.summary || {}
      const bootstrap = summary?.bootstrap || summary
      const reconcile = summary?.reconcile || null
      const inserted = Number(bootstrap?.insertedLedgerRows || 0)
      const scanned = Number(bootstrap?.scannedPurchases || 0)
      const adjusted = Number(reconcile?.adjustedItems || 0)

      if (reconcile) {
        setStatus(
          `Stock sync complete. Purchases scanned: ${scanned}, ledger inserted: ${inserted}, reconciled items: ${adjusted}.`,
        )
      } else {
        setStatus(`Stock sync complete. Purchases scanned: ${scanned}, ledger rows inserted: ${inserted}.`)
      }
      await refetch()
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'Stock sync failed. Please retry.')
    }
  }

  async function handleSyncItemFromPurchases(item) {
    const inventoryItemId = String(item?._id || '').trim()
    if (!inventoryItemId) return

    setStatus('')
    setError('')
    setSyncingItemId(inventoryItemId)
    try {
      const response = await bootstrapMutation.mutateAsync({
        batchSize: 250,
        inventoryItemId,
        mode: 'bootstrap_and_reconcile',
      })
      const summary = response?.summary || {}
      const bootstrap = summary?.bootstrap || summary
      const reconcile = summary?.reconcile || null
      const inserted = Number(bootstrap?.insertedLedgerRows || 0)
      const scanned = Number(bootstrap?.scannedPurchases || 0)
      const adjusted = Number(reconcile?.adjustedItems || 0)

      setStatus(
        `Sync complete for ${String(item?.name || 'item')}. Purchases scanned: ${scanned}, ledger inserted: ${inserted}, reconciled items: ${adjusted}.`,
      )
      await refetch()
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'Item sync failed. Please retry.')
    } finally {
      setSyncingItemId('')
    }
  }

  function getRowUnit(item) {
    const key = String(item?._id || '')
    return String(editingUnits[key] || item?.defaultUnit || 'Unit')
  }

  function isRowUnitUnchanged(item) {
    return String(item?.defaultUnit || 'Unit') === getRowUnit(item)
  }

  async function handleSaveDefaultUnit(item) {
    const inventoryItemId = String(item?._id || '')
    const nextUnit = getRowUnit(item)
    if (!inventoryItemId || !nextUnit) return
    if (String(item?.defaultUnit || 'Unit') === nextUnit) return

    setStatus('')
    setError('')
    try {
      await updateDefaultUnitMutation.mutateAsync({
        inventoryItemId,
        payload: { defaultUnit: nextUnit },
      })
      setStatus(`Default unit updated for ${String(item?.name || 'item')}.`)
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'Failed to update default unit.')
    }
  }

  return (
    <section className="rounded-2xl border border-rose-100 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.08)] md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-slate-900">Current Stock</h3>
          <p className="mt-1 text-sm text-slate-500">Live derived stock from ledger-backed writes.</p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-[var(--primary)] hover:bg-rose-50"
        >
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
        <button
          type="button"
          onClick={handleBootstrap}
          disabled={bootstrapMutation.isPending}
          className="rounded-xl border border-rose-700 bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {bootstrapMutation.isPending ? 'Syncing...' : 'Sync From Saved Purchases'}
        </button>
      </div>

      {status ? <p className="mb-3 text-sm font-semibold text-emerald-700">{status}</p> : null}
      {error ? <p className="mb-3 text-sm font-semibold text-rose-700">{error}</p> : null}

      {isLoading ? <p className="text-sm text-slate-500">Loading stock...</p> : null}

      {!isLoading && sorted.length === 0 ? (
        <p className="text-sm text-slate-500">No inventory items found.</p>
      ) : null}

      {!isLoading && sorted.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-rose-100 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Default Unit</th>
                <th className="px-3 py-2">Current Stock</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rose-50">
              {sorted.map((item) => (
                <tr key={item._id}>
                  <td className="px-3 py-2 font-semibold text-slate-800">{item.name}</td>
                  <td className="px-3 py-2 text-slate-600">
                    <select
                      value={getRowUnit(item)}
                      onChange={(event) =>
                        setEditingUnits((prev) => ({
                          ...prev,
                          [String(item._id)]: event.target.value,
                        }))
                      }
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                    >
                      {allowedUnits.map((unit) => (
                        <option key={unit} value={unit}>{unit}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{toStockText(item)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSaveDefaultUnit(item)}
                        disabled={updateDefaultUnitMutation.isPending || isRowUnitUnchanged(item)}
                        className="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-[var(--primary)] hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {updateDefaultUnitMutation.isPending ? 'Saving...' : 'Save Unit'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSyncItemFromPurchases(item)}
                        disabled={bootstrapMutation.isPending}
                        className="rounded-lg border border-rose-700 bg-rose-600 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {bootstrapMutation.isPending && syncingItemId === String(item._id)
                          ? 'Syncing...'
                          : 'Sync Purchase'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
