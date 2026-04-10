import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../components/Button'
import FormInput from '../components/FormInput'
import Modal from '../components/Modal'
import { menuService } from '../services/menuService'
import { useAuth } from '../hooks/useAuth'
import { formatCurrencyINR } from '../utils/currency'
import { useMenuQuery } from '../hooks/useDashboardQueries'
import { queryKeys } from '../lib/queryKeys'

const initialForm = {
  name: '',
  description: '',
  price: '',
  categoryId: '',
  available: true,
  isVeg: true,
  portionSize: 'medium',
  bestseller: false,
}

const newDraftItem = {
  name: '',
  description: '',
  price: '',
  available: true,
  isVeg: true,
  portionSize: 'medium',
  bestseller: false,
}

const MAX_AI_IMAGES = 4
const MAX_AI_IMAGE_SIZE_BYTES = 2 * 1024 * 1024

export default function MenuPage() {
  const { restaurant } = useAuth()
  const [categoryName, setCategoryName] = useState('')
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [form, setForm] = useState(initialForm)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const [pendingToggleItemIds, setPendingToggleItemIds] = useState({})
  const [aiImages, setAiImages] = useState([])
  const [aiDraftCategories, setAiDraftCategories] = useState([])
  const [aiLoading, setAiLoading] = useState(false)
  const queryClient = useQueryClient()

  const { data: menuData } = useMenuQuery({
    restaurantId: restaurant?._id,
  })

  const menuQueryKey = queryKeys.dashboard.menu(restaurant?._id)

  const categories = useMemo(() => menuData?.categories || [], [menuData?.categories])
  const items = useMemo(() => menuData?.items || [], [menuData?.items])

  const refreshMenu = () => {
    if (!restaurant?._id) return Promise.resolve()
    return queryClient.invalidateQueries({
      queryKey: menuQueryKey,
    })
  }

  const categoryMap = useMemo(() => {
    const map = new Map()
    for (const category of categories) {
      map.set(category._id, category.name)
    }
    return map
  }, [categories])

  useEffect(() => {
    if (!categories.length) return
    setForm((prev) => {
      if (prev.categoryId) return prev
      return { ...prev, categoryId: categories[0]?._id || '' }
    })
  }, [categories])

  const patchMenuItemInCache = (itemId, patch) => {
    if (!restaurant?._id) return

    queryClient.setQueryData(menuQueryKey, (current) => {
      if (!current) return current

      return {
        ...current,
        items: Array.isArray(current.items)
          ? current.items.map((item) =>
              String(item._id) === String(itemId)
                ? { ...item, ...patch }
                : item,
            )
          : current.items,
      }
    })
  }

  const replaceMenuItemInCache = (nextItem) => {
    if (!restaurant?._id || !nextItem?._id) return

    queryClient.setQueryData(menuQueryKey, (current) => {
      if (!current) return current

      return {
        ...current,
        items: Array.isArray(current.items)
          ? current.items.map((item) =>
              String(item._id) === String(nextItem._id)
                ? { ...item, ...nextItem }
                : item,
            )
          : current.items,
      }
    })
  }

  const toggleItemFieldMutation = useMutation({
    mutationFn: ({ itemId, patch }) => menuService.updateItem(itemId, patch),
    onMutate: async ({ itemId, patch }) => {
      setPendingToggleItemIds((current) => ({ ...current, [String(itemId)]: true }))
      setError('')

      await queryClient.cancelQueries({
        queryKey: menuQueryKey,
      })

      const previousMenu = restaurant?._id
        ? queryClient.getQueryData(menuQueryKey)
        : null

      patchMenuItemInCache(itemId, patch)

      return {
        previousMenu,
      }
    },
    onSuccess: (updatedItem) => {
      replaceMenuItemInCache(updatedItem)
    },
    onError: (requestError, _variables, context) => {
      if (restaurant?._id && context?.previousMenu) {
        queryClient.setQueryData(menuQueryKey, context.previousMenu)
      }
      setError(requestError?.response?.data?.message || 'Failed to update menu item')
    },
    onSettled: (_data, _error, variables) => {
      setPendingToggleItemIds((current) => {
        const next = { ...current }
        delete next[String(variables?.itemId || '')]
        return next
      })
      void queryClient.invalidateQueries({ queryKey: menuQueryKey })
    },
  })

  const saveItemMutation = useMutation({
    mutationFn: ({ targetEditingId, payload }) =>
      targetEditingId ? menuService.updateItem(targetEditingId, payload) : menuService.createItem(payload),
    onSuccess: () => {
      setError('')
      refreshMenu()
      setEditingId(null)
      setForm((prev) => ({ ...initialForm, categoryId: categories[0]?._id || prev.categoryId }))
    },
    onError: (requestError) => {
      setError(requestError?.response?.data?.message || 'Failed to save menu item')
    },
  })

  const deleteItemMutation = useMutation({
    mutationFn: (id) => menuService.deleteItem(id),
    onSuccess: () => {
      setError('')
      refreshMenu()
    },
    onError: (requestError) => {
      setError(requestError?.response?.data?.message || 'Failed to delete item')
    },
  })

  const addCategoryMutation = useMutation({
    mutationFn: (payload) => menuService.createCategory(payload),
    onSuccess: () => {
      setError('')
      refreshMenu()
      setCategoryName('')
      setShowCategoryModal(false)
    },
    onError: (requestError) => {
      setError(requestError?.response?.data?.message || 'Failed to add category')
    },
  })

  const importDraftMutation = useMutation({
    mutationFn: (payload) => menuService.importDraft(payload),
    onSuccess: () => {
      setError('')
      refreshMenu()
      setAiDraftCategories([])
      clearAiImages()
    },
    onError: (requestError) => {
      setError(requestError?.response?.data?.message || 'Failed to import AI-generated menu')
    },
  })

  const onSubmit = (event) => {
    event.preventDefault()
    setError('')
    const payload = {
      ...form,
      categoryId: form.categoryId,
      price: Number(form.price),
    }

    saveItemMutation.mutate({ targetEditingId: editingId, payload })
  }

  const onEdit = (item) => {
    setEditingId(item._id)
    setForm({ ...item, price: String(item.price), portionSize: item.portionSize || 'medium' })
  }

  const onDelete = (id) => {
    deleteItemMutation.mutate(id)
  }

  const addCategory = () => {
    if (!categoryName.trim()) return

    addCategoryMutation.mutate({ name: categoryName })
  }

  const clearAiImages = () => {
    setAiImages([])
  }

  const readFileAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`))
      reader.readAsDataURL(file)
    })

  const onAiImagesUpload = async (event) => {
    const selectedFiles = Array.from(event.target.files || [])
    event.target.value = ''
    if (!selectedFiles.length) return

    setError('')

    if (aiImages.length + selectedFiles.length > MAX_AI_IMAGES) {
      setError(`You can upload up to ${MAX_AI_IMAGES} menu images at once`)
      return
    }

    const invalidFile = selectedFiles.find(
      (file) => !String(file.type || '').startsWith('image/') || file.size > MAX_AI_IMAGE_SIZE_BYTES,
    )

    if (invalidFile) {
      setError(`Only image files up to ${Math.floor(MAX_AI_IMAGE_SIZE_BYTES / (1024 * 1024))}MB are allowed`)
      return
    }

    try {
      const encoded = await Promise.all(
        selectedFiles.map(async (file) => {
          const dataUrl = await readFileAsDataUrl(file)
          const base64Start = dataUrl.indexOf(',')
          const dataBase64 = base64Start >= 0 ? dataUrl.slice(base64Start + 1) : ''

          return {
            name: file.name,
            mimeType: file.type || 'image/jpeg',
            dataBase64,
          }
        }),
      )

      setAiImages((prev) => [...prev, ...encoded])
    } catch (uploadError) {
      setError(uploadError?.message || 'Failed to process uploaded images')
    }
  }

  const runAiAnalysis = async () => {
    setError('')
    setAiLoading(true)

    try {
      const payload = {
        menuImages: aiImages,
      }
      const data = await menuService.analyzeWithAI(payload)

      const normalized = (data.categories || []).map((category) => ({
        name: category.name || '',
        items: (category.items || []).map((item) => ({
          name: item.name || '',
          description: item.description || '',
          price: String(item.price ?? ''),
          available: item.available ?? true,
          isVeg: item.isVeg ?? true,
          portionSize: item.portionSize || 'medium',
          bestseller: item.bestseller ?? false,
        })),
      }))

      setAiDraftCategories(normalized)
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'AI menu analysis failed')
    } finally {
      setAiLoading(false)
    }
  }

  const updateDraftCategory = (categoryIndex, value) => {
    setAiDraftCategories((prev) =>
      prev.map((category, index) => (index === categoryIndex ? { ...category, name: value } : category)),
    )
  }

  const removeDraftCategory = (categoryIndex) => {
    setAiDraftCategories((prev) => prev.filter((_, index) => index !== categoryIndex))
  }

  const addDraftCategory = () => {
    setAiDraftCategories((prev) => [...prev, { name: '', items: [{ ...newDraftItem }] }])
  }

  const updateDraftItem = (categoryIndex, itemIndex, field, value) => {
    setAiDraftCategories((prev) =>
      prev.map((category, currentCategoryIndex) => {
        if (currentCategoryIndex !== categoryIndex) return category

        return {
          ...category,
          items: category.items.map((item, currentItemIndex) =>
            currentItemIndex === itemIndex ? { ...item, [field]: value } : item,
          ),
        }
      }),
    )
  }

  const addDraftItem = (categoryIndex) => {
    setAiDraftCategories((prev) =>
      prev.map((category, index) =>
        index === categoryIndex ? { ...category, items: [...category.items, { ...newDraftItem }] } : category,
      ),
    )
  }

  const removeDraftItem = (categoryIndex, itemIndex) => {
    setAiDraftCategories((prev) =>
      prev.map((category, index) => {
        if (index !== categoryIndex) return category
        return {
          ...category,
          items: category.items.filter((_, currentItemIndex) => currentItemIndex !== itemIndex),
        }
      }),
    )
  }

  const importAiDraftToMenu = async () => {
    if (aiDraftCategories.length === 0) return
    setError('')

    await importDraftMutation.mutateAsync({ categories: aiDraftCategories })
  }

  const toggleItemAvailability = (item) => {
    toggleItemFieldMutation.mutate({
      itemId: item._id,
      patch: { available: item.available === false },
    })
  }

  const toggleItemDiet = (item) => {
    toggleItemFieldMutation.mutate({
      itemId: item._id,
      patch: { isVeg: item.isVeg === false },
    })
  }

  return (
    <div className="space-y-5">
      <div className="card p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">AI Menu Import</h2>
            <p className="text-sm text-slate-600">Upload menu images and auto-generate categories with priced items.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={clearAiImages} disabled={aiLoading || aiImages.length === 0}>
              Delete Uploaded Images
            </Button>
            <Button variant="secondary" onClick={runAiAnalysis} disabled={aiLoading || aiImages.length === 0}>
              {aiLoading ? 'Analyzing...' : 'Analyze with AI'}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Upload Menu Images</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="input"
              onChange={onAiImagesUpload}
            />
            <p className="mt-1 text-xs text-slate-500">
              Upload up to {MAX_AI_IMAGES} images (max {Math.floor(MAX_AI_IMAGE_SIZE_BYTES / (1024 * 1024))}MB each).
            </p>
          </label>
        </div>

        {aiImages.length > 0 ? (
          <div className="mt-3 rounded-xl border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-700">Uploaded Images ({aiImages.length})</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {aiImages.map((image, index) => (
                <span key={`${image.name}-${index}`} className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600">
                  {image.name}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {aiDraftCategories.length > 0 && (
          <div className="mt-4 space-y-4 rounded-xl border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Review & Edit AI Draft</h3>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={clearAiImages} disabled={aiImages.length === 0}>
                  Delete Uploaded Images
                </Button>
                <Button variant="secondary" onClick={addDraftCategory}>
                  Add Category
                </Button>
                <Button onClick={importAiDraftToMenu} disabled={importDraftMutation.isPending}>
                  {importDraftMutation.isPending ? 'Importing...' : 'Import to Menu'}
                </Button>
              </div>
            </div>

            {aiDraftCategories.map((category, categoryIndex) => (
              <div key={`${categoryIndex}-${category.name}`} className="rounded-xl border border-slate-200 p-3">
                <div className="mb-3 flex items-center gap-2">
                  <input
                    className="input"
                    value={category.name}
                    onChange={(e) => updateDraftCategory(categoryIndex, e.target.value)}
                    placeholder="Category name"
                  />
                  <Button variant="secondary" onClick={() => addDraftItem(categoryIndex)}>
                    Add Item
                  </Button>
                  <Button variant="secondary" onClick={() => removeDraftCategory(categoryIndex)}>
                    Remove Category
                  </Button>
                </div>

                <div className="space-y-2">
                  {category.items.map((item, itemIndex) => (
                    <div key={`${itemIndex}-${item.name}`} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-100 p-3 md:grid-cols-12">
                      <input
                        className="input md:col-span-3"
                        value={item.name}
                        onChange={(e) => updateDraftItem(categoryIndex, itemIndex, 'name', e.target.value)}
                        placeholder="Item name"
                      />
                      <input
                        className="input md:col-span-4"
                        value={item.description}
                        onChange={(e) => updateDraftItem(categoryIndex, itemIndex, 'description', e.target.value)}
                        placeholder="Description"
                      />
                      <input
                        type="number"
                        className="input md:col-span-2"
                        value={item.price}
                        onChange={(e) => updateDraftItem(categoryIndex, itemIndex, 'price', e.target.value)}
                        placeholder="Price"
                      />
                      <label className="md:col-span-1 flex items-center justify-center gap-1 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={item.available}
                          onChange={(e) => updateDraftItem(categoryIndex, itemIndex, 'available', e.target.checked)}
                        />
                        Avl
                      </label>
                      <label className="md:col-span-1 flex items-center justify-center gap-1 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={item.isVeg !== false}
                          onChange={(e) => updateDraftItem(categoryIndex, itemIndex, 'isVeg', e.target.checked)}
                        />
                        Veg
                      </label>
                      <select
                        className="input md:col-span-1"
                        value={item.portionSize || 'medium'}
                        onChange={(e) => updateDraftItem(categoryIndex, itemIndex, 'portionSize', e.target.value)}
                      >
                        <option value="small">Small</option>
                        <option value="medium">Medium</option>
                        <option value="large">Large</option>
                      </select>
                      <label className="md:col-span-1 flex items-center justify-center gap-1 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={item.bestseller}
                          onChange={(e) => updateDraftItem(categoryIndex, itemIndex, 'bestseller', e.target.checked)}
                        />
                        Best
                      </label>
                      <Button variant="secondary" className="md:col-span-1" onClick={() => removeDraftItem(categoryIndex, itemIndex)}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add Menu Item</h2>
          <Button variant="secondary" onClick={() => setShowCategoryModal(true)}>
            Add Category
          </Button>
        </div>
        {error && <p className="mb-3 text-sm text-[var(--primary)]">{error}</p>}

        <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={onSubmit}>
          <FormInput
            label="Name"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            required
          />
          <FormInput
            label="Price"
            type="number"
            value={form.price}
            onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
            required
          />
          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm font-medium text-slate-700">Description</span>
            <textarea
              className="input"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-slate-700">Category</span>
            <select
              className="input"
              value={form.categoryId}
              onChange={(e) => setForm((prev) => ({ ...prev, categoryId: e.target.value }))}
            >
              {categories.map((category) => (
                <option key={category._id} value={category._id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.available}
              onChange={(e) => setForm((prev) => ({ ...prev, available: e.target.checked }))}
            />
            Available
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isVeg}
              onChange={(e) => setForm((prev) => ({ ...prev, isVeg: e.target.checked }))}
            />
            Veg Dish
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-slate-700">Portion Size</span>
            <select
              className="input"
              value={form.portionSize || 'medium'}
              onChange={(e) => setForm((prev) => ({ ...prev, portionSize: e.target.value }))}
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.bestseller}
              onChange={(e) => setForm((prev) => ({ ...prev, bestseller: e.target.checked }))}
            />
            Bestseller
          </label>
          <div className="md:col-span-2">
            <Button type="submit">{editingId ? 'Update Item' : 'Add Item'}</Button>
          </div>
        </form>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <div key={item._id} className="card p-4">
            <div className="mb-2 flex items-start justify-between">
              <h3 className="font-semibold">{item.name}</h3>
              <p className="font-semibold text-[var(--primary)]">{formatCurrencyINR(item.price)}</p>
            </div>
            <p className="text-sm text-slate-600">{item.description}</p>
            <p className="mt-2 text-sm text-slate-500">Category: {categoryMap.get(item.categoryId) || '-'}</p>
            <div className="mt-2 flex gap-2 text-xs">
              <span className={`rounded px-2 py-1 ${item.available === false ? 'bg-slate-200 text-slate-700' : 'bg-emerald-50 text-emerald-700'}`}>
                {item.available === false ? 'Hidden' : 'Visible'}
              </span>
              <span className={`rounded px-2 py-1 ${item.isVeg === false ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                {item.isVeg === false ? 'Non-Veg' : 'Veg'}
              </span>
              <span className="rounded bg-slate-100 px-2 py-1 text-slate-700">
                {(item.portionSize || 'medium').toUpperCase()}
              </span>
              {item.bestseller && <span className="rounded bg-red-50 px-2 py-1 text-[var(--primary)]">Bestseller</span>}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                variant="custom"
                className={`border ${
                  item.available === false
                    ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
                onClick={() => toggleItemAvailability(item)}
                disabled={Boolean(pendingToggleItemIds[String(item._id)])}
              >
                {item.available === false ? 'Off' : 'On'}
              </Button>
              <Button
                variant="custom"
                className={`border ${
                  item.isVeg === false
                    ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
                onClick={() => toggleItemDiet(item)}
                disabled={Boolean(pendingToggleItemIds[String(item._id)])}
              >
                {item.isVeg === false ? 'NonVeg' : 'Veg'}
              </Button>
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" onClick={() => onEdit(item)}>
                Edit
              </Button>
              <Button variant="secondary" onClick={() => onDelete(item._id)}>
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={showCategoryModal} title="Add Category" onClose={() => setShowCategoryModal(false)}>
        <div className="space-y-3">
          <FormInput
            label="Category Name"
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
          />
          <Button onClick={addCategory}>Save Category</Button>
        </div>
      </Modal>
    </div>
  )
}
