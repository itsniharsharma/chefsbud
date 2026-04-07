import { motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../hooks/useAuth'
import {
  useDeleteInventoryPurchaseItem,
  useCreateInventoryItem,
  useCreatePurchase,
  useCreateSupplier,
  useInventoryItems,
  useInventoryPurchaseRows,
  useInventorySuppliers,
  useUpdateInventoryPurchaseItem,
} from '../../../hooks/useInventoryPurchaseQueries'
import PurchaseItemsTable from './PurchaseItemsTable'
import PurchaseRowsTable from './PurchaseRowsTable'
import SupplierDropdown from './SupplierDropdown'

const sectionAnimation = {
  hidden: { opacity: 0, y: 10 },
  visible: (index) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.24, delay: index * 0.05 },
  }),
}

const sourceTypes = ['Supplier', 'Restaurant', 'Kitchen']
const discountTypes = ['Fixed', 'Percentage']
const paymentTypes = ['Unpaid', 'Paid']

function initialRow() {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    itemId: '',
    quantity: '1',
    unit: 'Kg',
    rate: '0',
  }
}

function toNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10)
}

function getApiErrorMessage(error, fallback) {
  const responseData = error?.response?.data
  const validationErrors = Array.isArray(responseData?.errors) ? responseData.errors : []

  if (validationErrors.length > 0) {
    const first = validationErrors[0]
    const fieldName = String(first?.path || first?.param || '').trim()
    const msg = String(first?.msg || '').trim() || 'Invalid value'
    return fieldName ? `${fieldName}: ${msg}` : msg
  }

  return responseData?.message || fallback
}

export default function PurchaseForm() {
  const navigate = useNavigate()
  const MotionSection = motion.section
  const { restaurant } = useAuth()
  const restaurantId = restaurant?._id

  const { data: suppliers = [], isLoading: suppliersLoading } = useInventorySuppliers({ restaurantId })
  const { data: itemOptions = [], isLoading: itemsLoading } = useInventoryItems({ restaurantId })
  const createSupplierMutation = useCreateSupplier({ restaurantId })
  const createItemMutation = useCreateInventoryItem({ restaurantId })
  const createPurchaseMutation = useCreatePurchase({ restaurantId })
  const updatePurchaseItemMutation = useUpdateInventoryPurchaseItem({ restaurantId })
  const deletePurchaseItemMutation = useDeleteInventoryPurchaseItem({ restaurantId })
  const { data: purchaseRows = [], isLoading: purchaseRowsLoading } = useInventoryPurchaseRows({ restaurantId })

  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [form, setForm] = useState({
    sourceType: 'Supplier',
    supplierId: '',
    invoiceDate: getTodayDateString(),
    gstNo: '',
    cgst: '',
    igst: '',
    discountType: 'Fixed',
    discountValue: '',
    invoiceNumber: '',
    deliveryCharge: '',
    sgst: '',
    paymentType: 'Paid',
    items: [initialRow()],
  })

  const itemById = useMemo(
    () => new Map((Array.isArray(itemOptions) ? itemOptions : []).map((item) => [String(item._id), item])),
    [itemOptions],
  )

  const subtotal = useMemo(
    () =>
      form.items.reduce((sum, item) => {
        const amount = toNumber(item.quantity) * toNumber(item.rate)
        return sum + amount
      }, 0),
    [form.items],
  )

  const totalDiscount = useMemo(() => {
    const rawDiscount = toNumber(form.discountValue)
    if (!rawDiscount) return 0

    if (form.discountType === 'Percentage') {
      return (subtotal * rawDiscount) / 100
    }

    return rawDiscount
  }, [form.discountType, form.discountValue, subtotal])

  const setField = (name, value) => {
    setForm((prev) => {
      if (name === 'sourceType' && value !== 'Supplier') {
        return { ...prev, sourceType: value, supplierId: '' }
      }

      return { ...prev, [name]: value }
    })
  }

  const handleAddSupplier = async (supplierName) => {
    setErrorMessage('')
    setStatusMessage('')
    try {
      const created = await createSupplierMutation.mutateAsync({
        name: supplierName,
      })
      setStatusMessage('Supplier saved successfully.')
      return created
    } catch (error) {
      setErrorMessage(error?.response?.data?.message || 'Failed to add supplier')
      return null
    }
  }

  const onUpdateItem = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, rowIndex) =>
        rowIndex === index
          ? {
              ...item,
              ...(field === 'itemId'
                ? {
                    itemId: value,
                    unit: itemById.get(String(value))?.defaultUnit || item.unit || 'Unit',
                  }
                : { [field]: value }),
            }
          : item,
      ),
    }))
  }

  const onCreateCatalogItem = async ({ name, defaultUnit, targetRowIndex }) => {
    setErrorMessage('')
    setStatusMessage('')
    try {
      const created = await createItemMutation.mutateAsync({
        name,
        defaultUnit,
      })

      if (Number.isInteger(targetRowIndex)) {
        setForm((prev) => ({
          ...prev,
          items: prev.items.map((item, rowIndex) =>
            rowIndex === targetRowIndex
              ? {
                  ...item,
                  itemId: String(created._id),
                  unit: created.defaultUnit || item.unit || 'Unit',
                }
              : item,
          ),
        }))
      }

      setStatusMessage('Inventory item saved successfully.')
      return created
    } catch (error) {
      setErrorMessage(error?.response?.data?.message || 'Failed to add item')
      return null
    }
  }

  const onAddItem = () => {
    setForm((prev) => ({ ...prev, items: [...prev.items, initialRow()] }))
  }

  const onRemoveItem = (index) => {
    setForm((prev) => {
      if (prev.items.length <= 1) return prev
      return {
        ...prev,
        items: prev.items.filter((_item, rowIndex) => rowIndex !== index),
      }
    })
  }

  const onSubmit = async (event) => {
    event.preventDefault()
    setErrorMessage('')
    setStatusMessage('')

    if (form.sourceType === 'Supplier' && !String(form.supplierId || '').trim()) {
      setErrorMessage('Please select a supplier for source type Supplier.')
      return
    }

    if (!String(form.invoiceDate || '').trim()) {
      setErrorMessage('Please select an invoice date.')
      return
    }

    if (!String(form.invoiceNumber || '').trim()) {
      setErrorMessage('Please enter an invoice number.')
      return
    }

    if (!Array.isArray(form.items) || form.items.length === 0) {
      setErrorMessage('At least one purchase item is required.')
      return
    }

    const invalidItemIndex = form.items.findIndex((row) => {
      const hasItemId = Boolean(String(row?.itemId || '').trim())
      const quantity = toNumber(row?.quantity)
      const rate = toNumber(row?.rate)
      return !hasItemId || quantity <= 0 || rate < 0
    })

    if (invalidItemIndex >= 0) {
      setErrorMessage(
        `Item row ${invalidItemIndex + 1} is invalid. Select item, set quantity > 0, and rate >= 0.`,
      )
      return
    }

    const payload = {
      sourceType: form.sourceType,
      supplierId: form.sourceType === 'Supplier' ? form.supplierId || undefined : undefined,
      invoiceDate: form.invoiceDate,
      invoiceNumber: form.invoiceNumber,
      gstNo: form.gstNo,
      gst: form.gstNo,
      cgstPercent: toNumber(form.cgst),
      cgst: toNumber(form.cgst),
      sgstPercent: toNumber(form.sgst),
      sgst: toNumber(form.sgst),
      igstPercent: toNumber(form.igst),
      igst: toNumber(form.igst),
      deliveryCharge: toNumber(form.deliveryCharge),
      delivery: toNumber(form.deliveryCharge),
      discountType: form.discountType,
      discountValue: toNumber(form.discountValue),
      discount: toNumber(form.discountValue),
      paymentType: form.paymentType,
      items: form.items.map((row) => ({
        itemId: row.itemId,
        quantity: toNumber(row.quantity),
        unit: row.unit,
        rate: toNumber(row.rate),
      })),
    }

    try {
      const saved = await createPurchaseMutation.mutateAsync(payload)
      setStatusMessage(`Purchase saved successfully with id ${String(saved?._id || '').slice(-6)}.`)
      setForm((prev) => ({
        ...prev,
        items: [initialRow()],
      }))
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Failed to save purchase'))
    }
  }

  const onSavePurchaseRow = async ({ purchaseId, itemIndex, payload }) => {
    setErrorMessage('')
    setStatusMessage('')
    try {
      await updatePurchaseItemMutation.mutateAsync({ purchaseId, itemIndex, payload })
      setStatusMessage('Purchase row updated successfully.')
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Failed to update purchase row'))
      throw error
    }
  }

  const onDeletePurchaseRow = async ({ purchaseId, itemIndex }) => {
    setErrorMessage('')
    setStatusMessage('')
    try {
      await deletePurchaseItemMutation.mutateAsync({ purchaseId, itemIndex })
      setStatusMessage('Purchase row deleted successfully.')
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Failed to delete purchase row'))
      throw error
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="rounded-2xl border border-rose-100 bg-[linear-gradient(165deg,#ffffff_0%,#fff8f9_72%,#ffffff_100%)] p-6 shadow-[0_18px_36px_rgba(15,23,42,0.08)] md:p-8">
        <MotionSection variants={sectionAnimation} initial="hidden" animate="visible" custom={0} className="rounded-2xl border border-rose-100 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)] md:p-5">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-slate-600">Source Type</h3>
          <div className="flex flex-wrap gap-3">
            {sourceTypes.map((type) => (
              <label key={type} className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-rose-200">
                <input
                  type="radio"
                  name="sourceType"
                  value={type}
                  checked={form.sourceType === type}
                  onChange={(event) => setField('sourceType', event.target.value)}
                  className="h-4 w-4 accent-rose-600"
                />
                {type}
              </label>
            ))}
          </div>
        </MotionSection>

        {form.sourceType === 'Supplier' && (
          <MotionSection variants={sectionAnimation} initial="hidden" animate="visible" custom={1} className="mt-5 rounded-2xl border border-rose-100 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)] md:p-5">
            <SupplierDropdown
              suppliers={suppliers}
              value={form.supplierId}
              onChange={(nextSupplierId) => setField('supplierId', nextSupplierId)}
              onCreateSupplier={handleAddSupplier}
              isCreating={createSupplierMutation.isPending}
            />
            {suppliersLoading ? <p className="mt-2 text-xs text-slate-500">Loading suppliers...</p> : null}
          </MotionSection>
        )}

        <MotionSection variants={sectionAnimation} initial="hidden" animate="visible" custom={2} className="mt-5 rounded-2xl border border-rose-100 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)] md:p-5">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-[0.12em] text-slate-600">Invoice Details</h3>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <Field label="Invoice Date">
                <input type="date" value={form.invoiceDate} onChange={(event) => setField('invoiceDate', event.target.value)} className={inputClassName} />
              </Field>
              <Field label="GST No.">
                <input type="text" value={form.gstNo} onChange={(event) => setField('gstNo', event.target.value)} placeholder="29ABCDE1234F2Z5" className={inputClassName} />
              </Field>
              <Field label="CGST (%)">
                <input type="number" min="0" step="0.01" value={form.cgst} onChange={(event) => setField('cgst', event.target.value)} className={inputClassName} />
              </Field>
              <Field label="IGST (%)">
                <input type="number" min="0" step="0.01" value={form.igst} onChange={(event) => setField('igst', event.target.value)} className={inputClassName} />
              </Field>
              <Field label="Discount Type">
                <RadioGroup
                  name="discountType"
                  options={discountTypes}
                  value={form.discountType}
                  onChange={(next) => setField('discountType', next)}
                />
              </Field>
              <Field label="Discount (%)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.discountValue}
                  onChange={(event) => setField('discountValue', event.target.value)}
                  className={inputClassName}
                />
              </Field>
            </div>

            <div className="space-y-3">
              <Field label="Invoice Number">
                <input type="text" value={form.invoiceNumber} onChange={(event) => setField('invoiceNumber', event.target.value)} className={inputClassName} />
              </Field>
              <Field label="Delivery Charge">
                <input type="number" min="0" step="0.01" value={form.deliveryCharge} onChange={(event) => setField('deliveryCharge', event.target.value)} className={inputClassName} />
              </Field>
              <Field label="SGST (%)">
                <input type="number" min="0" step="0.01" value={form.sgst} onChange={(event) => setField('sgst', event.target.value)} className={inputClassName} />
              </Field>
              <Field label="Total Discount">
                <input type="text" value={totalDiscount.toFixed(2)} disabled className={`${inputClassName} cursor-not-allowed bg-slate-100 text-slate-500`} />
              </Field>
              <Field label="Payment Type">
                <RadioGroup
                  name="paymentType"
                  options={paymentTypes}
                  value={form.paymentType}
                  onChange={(next) => setField('paymentType', next)}
                />
              </Field>
            </div>
          </div>
        </MotionSection>

        <MotionSection variants={sectionAnimation} initial="hidden" animate="visible" custom={3} className="mt-5">
          <PurchaseItemsTable
            items={form.items}
            itemOptions={itemOptions}
            onAddRow={onAddItem}
            onRemoveRow={onRemoveItem}
            onUpdateRow={onUpdateItem}
            onCreateCatalogItem={onCreateCatalogItem}
            isCreatingCatalogItem={createItemMutation.isPending}
          />
          {itemsLoading ? <p className="mt-2 text-xs text-slate-500">Loading inventory items...</p> : null}
        </MotionSection>

        <MotionSection variants={sectionAnimation} initial="hidden" animate="visible" custom={4} className="mt-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="rounded-xl border border-rose-100 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
            <p>
              Subtotal: <span className="font-semibold text-slate-800">{subtotal.toFixed(2)}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">Error placeholder: Validation and API errors will appear here later.</p>
            {errorMessage ? <p className="mt-2 text-xs font-semibold text-rose-700">{errorMessage}</p> : null}
            {statusMessage ? <p className="mt-2 text-xs font-semibold text-emerald-700">{statusMessage}</p> : null}
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => navigate('/inventory/purchase')}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createPurchaseMutation.isPending}
              className="rounded-xl border border-rose-700 bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_18px_rgba(220,38,38,0.25)] transition hover:bg-rose-700"
            >
              {createPurchaseMutation.isPending ? 'Saving...' : 'Save Purchase'}
            </button>
          </div>
        </MotionSection>

        <MotionSection variants={sectionAnimation} initial="hidden" animate="visible" custom={5} className="mt-5">
          <PurchaseRowsTable
            rows={purchaseRows}
            onSaveRow={onSavePurchaseRow}
            isSaving={updatePurchaseItemMutation.isPending}
            onDeleteRow={onDeletePurchaseRow}
            isDeleting={deletePurchaseItemMutation.isPending}
          />
          {purchaseRowsLoading ? <p className="mt-2 text-xs text-slate-500">Loading saved purchase rows...</p> : null}
        </MotionSection>
      </div>
    </form>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function RadioGroup({ name, options = [], value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <label
          key={option}
          className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-rose-200"
        >
          <input
            type="radio"
            name={name}
            value={option}
            checked={value === option}
            onChange={(event) => onChange?.(event.target.value)}
            className="h-4 w-4 accent-rose-600"
          />
          {option}
        </label>
      ))}
    </div>
  )
}

const inputClassName =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100 disabled:bg-slate-100 disabled:text-slate-500'
