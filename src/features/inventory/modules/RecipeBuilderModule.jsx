import { useMemo, useState } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import {
  useInventoryItems,
  useInventoryRecipes,
  useManagedMenuItems,
  useUpsertInventoryRecipe,
} from '../../../hooks/useInventoryPurchaseQueries'

const units = ['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet']

function newIngredientRow() {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceType: 'inventory',
    inventoryItemId: '',
    menuItemId: '',
    quantity: '1',
    unit: 'Gram',
  }
}

export default function RecipeBuilderModule() {
  const { restaurant } = useAuth()
  const restaurantId = restaurant?._id

  const { data: menuItems = [] } = useManagedMenuItems({ restaurantId })
  const { data: inventoryItems = [] } = useInventoryItems({ restaurantId })
  const { data: recipes = [] } = useInventoryRecipes({ restaurantId })
  const upsertRecipeMutation = useUpsertInventoryRecipe({ restaurantId })

  const [menuItemId, setMenuItemId] = useState('')
  const [rows, setRows] = useState([newIngredientRow()])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const recipeByMenuItemId = useMemo(
    () => new Map(recipes.map((recipe) => [String(recipe.menuItemId), recipe])),
    [recipes],
  )

  const selectedMenuItemHasSavedRecipe = Boolean(
    menuItemId && recipeByMenuItemId.get(String(menuItemId || '')),
  )

  const menuIngredients = useMemo(
    () => menuItems.filter((item) => String(item?._id || '') !== String(menuItemId || '')),
    [menuItems, menuItemId],
  )

  function onSelectMenuItem(nextMenuItemId) {
    setMenuItemId(nextMenuItemId)
    setStatus('')
    setError('')

    const existing = recipeByMenuItemId.get(String(nextMenuItemId || ''))
    if (!existing) {
      setRows([newIngredientRow()])
      return
    }

    const mapped = (Array.isArray(existing.ingredients) ? existing.ingredients : []).map((ingredient) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sourceType: String(ingredient.sourceType || (ingredient.menuItemId ? 'menu' : 'inventory')).toLowerCase() === 'menu'
        ? 'menu'
        : 'inventory',
      inventoryItemId: String(ingredient.inventoryItemId || ''),
      menuItemId: String(ingredient.menuItemId || ''),
      quantity: String(Number(ingredient.quantity || 0)),
      unit: String(ingredient.unit || 'Gram'),
    }))

    setRows(mapped.length ? mapped : [newIngredientRow()])
  }

  function onUpdateRow(index, field, value) {
    setRows((prev) => prev.map((row, i) => {
      if (i !== index) return row
      if (field === 'sourceType') {
        const nextSourceType = String(value || '').toLowerCase() === 'menu' ? 'menu' : 'inventory'
        return {
          ...row,
          sourceType: nextSourceType,
          inventoryItemId: nextSourceType === 'inventory' ? row.inventoryItemId : '',
          menuItemId: nextSourceType === 'menu' ? row.menuItemId : '',
          unit: nextSourceType === 'menu' ? 'Unit' : row.unit,
        }
      }
      if (field === 'inventoryItemId') {
        return { ...row, inventoryItemId: value, menuItemId: '' }
      }
      if (field === 'menuItemId') {
        return { ...row, menuItemId: value, inventoryItemId: '' }
      }
      return { ...row, [field]: value }
    }))
  }

  function onAddRow() {
    setRows((prev) => [...prev, newIngredientRow()])
  }

  function onRemoveRow(index) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_row, i) => i !== index)))
  }

  async function onSubmit(event) {
    event.preventDefault()
    setStatus('')
    setError('')

    if (!String(menuItemId || '').trim()) {
      setError('Please select a menu item first.')
      return
    }

    const ingredients = rows
      .map((row) => ({
        sourceType: String(row.sourceType || 'inventory').trim().toLowerCase() === 'menu' ? 'menu' : 'inventory',
        inventoryItemId: String(row.inventoryItemId || '').trim(),
        menuItemId: String(row.menuItemId || '').trim(),
        quantity: Number(row.quantity),
        unit: String(row.unit || '').trim(),
      }))
      .filter((row) => {
        if (!(Number.isFinite(row.quantity) && row.quantity > 0 && row.unit)) return false
        if (row.sourceType === 'menu') return Boolean(row.menuItemId)
        return Boolean(row.inventoryItemId)
      })

    if (!ingredients.length) {
      setError('Please add at least one valid ingredient row.')
      return
    }

    try {
      await upsertRecipeMutation.mutateAsync({
        menuItemId,
        ingredients,
      })
      setStatus('Recipe saved successfully.')
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'Failed to save recipe.')
    }
  }

  return (
    <section className="rounded-2xl border border-rose-100 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.08)] md:p-6">
      <h3 className="text-xl font-bold text-slate-900">Recipe Builder</h3>
      <p className="mt-1 text-sm text-slate-500">Bind menu items to raw inventory ingredients for auto-consumption.</p>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <label className="block max-w-xl">
          <span className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            <span>Menu Item</span>
            {menuItemId ? (
              <span className={selectedMenuItemHasSavedRecipe ? 'text-emerald-700' : 'text-slate-500'}>
                {selectedMenuItemHasSavedRecipe ? 'Saved' : 'Not Saved'}
              </span>
            ) : null}
          </span>
          <select
            value={menuItemId}
            onChange={(event) => onSelectMenuItem(event.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Select menu item</option>
            {menuItems.map((item) => {
              const isSaved = Boolean(recipeByMenuItemId.get(String(item?._id || '')))
              return (
                <option key={item._id} value={item._id}>
                  {item.name}{isSaved ? ' - Saved' : ''}
                </option>
              )
            })}
          </select>
        </label>

        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={row.id} className="grid grid-cols-1 gap-2 rounded-xl border border-rose-100 p-3 md:grid-cols-12">
              <select
                value={row.sourceType}
                onChange={(event) => onUpdateRow(index, 'sourceType', event.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm md:col-span-2"
              >
                <option value="inventory">Inventory</option>
                <option value="menu">Menu</option>
              </select>

              <select
                value={row.sourceType === 'menu' ? row.menuItemId : row.inventoryItemId}
                onChange={(event) => onUpdateRow(index, row.sourceType === 'menu' ? 'menuItemId' : 'inventoryItemId', event.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm md:col-span-4"
              >
                <option value="">{row.sourceType === 'menu' ? 'Menu item' : 'Inventory item'}</option>
                {row.sourceType === 'menu'
                  ? menuIngredients.map((item) => (
                      <option key={item._id} value={item._id}>{item.name}</option>
                    ))
                  : inventoryItems.map((item) => (
                      <option key={item._id} value={item._id}>{item.name}</option>
                    ))}
              </select>

              <input
                type="number"
                min="0"
                step="any"
                value={row.quantity}
                onChange={(event) => onUpdateRow(index, 'quantity', event.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm md:col-span-3"
                placeholder="Quantity"
              />

              <select
                value={row.unit}
                onChange={(event) => onUpdateRow(index, 'unit', event.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm md:col-span-2"
                disabled={row.sourceType === 'menu'}
              >
                {units.map((unit) => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => onRemoveRow(index)}
                className="rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-[var(--primary)] md:col-span-1"
              >
                Del
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onAddRow}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Add Ingredient
          </button>
          <button
            type="submit"
            disabled={upsertRecipeMutation.isPending}
            className="rounded-xl border border-rose-700 bg-rose-600 px-4 py-2 text-sm font-semibold text-white"
          >
            {upsertRecipeMutation.isPending ? 'Saving...' : 'Save Recipe'}
          </button>
          {status ? <span className="text-sm font-semibold text-emerald-700">{status}</span> : null}
          {error ? <span className="text-sm font-semibold text-rose-700">{error}</span> : null}
        </div>
      </form>
    </section>
  )
}
