import { useEffect, useState } from 'react'
import Button from '../components/Button'
import FormInput from '../components/FormInput'
import { useAuth } from '../hooks/useAuth'
import { restaurantService } from '../services/restaurantService'

export default function SettingsPage() {
  const { user, restaurant, setRestaurant } = useAuth()
  const [form, setForm] = useState({
    restaurantName: '',
    gstin: '',
    address: '',
    phone: '',
    lowStockThresholdPercent: '10',
    inventoryEnabled: true,
    analyticsEnabled: true,
  })
  const [message, setMessage] = useState('')
  const [staffMessage, setStaffMessage] = useState('')
  const [staffAccounts, setStaffAccounts] = useState([])
  const [kotMessage, setKotMessage] = useState('')
  const [kotPasskey, setKotPasskey] = useState('')
  const [staffForm, setStaffForm] = useState({
    username: '',
    passkey: '',
    displayName: '',
  })
  const planCode = String(user?.billing?.planCode || '').trim().toLowerCase()
  const isCorePlan = planCode === 'core'
  const isProPlan = planCode === 'pro'
  const isModuleEntitlementLocked = isCorePlan || isProPlan

  useEffect(() => {
    if (!restaurant) return
    const entitlementDefaults = isCorePlan
      ? { inventoryEnabled: false, analyticsEnabled: false }
      : isProPlan
        ? { inventoryEnabled: true, analyticsEnabled: true }
        : null

    setForm({
      restaurantName: restaurant.name || '',
      gstin: restaurant.gstin || '',
      address: restaurant.address || '',
      phone: restaurant.phone || '',
      lowStockThresholdPercent: String(restaurant.inventoryAlertConfig?.lowStockThresholdPercent ?? 10),
      inventoryEnabled: entitlementDefaults ? entitlementDefaults.inventoryEnabled : restaurant.featureConfig?.inventoryEnabled !== false,
      analyticsEnabled: entitlementDefaults ? entitlementDefaults.analyticsEnabled : restaurant.featureConfig?.analyticsEnabled !== false,
    })
  }, [isCorePlan, isProPlan, restaurant])

  useEffect(() => {
    restaurantService
      .listStaff()
      .then((staffList) => {
        setStaffAccounts(Array.isArray(staffList) ? staffList : [])
      })
      .catch(() => {
        setStaffAccounts([])
      })
  }, [])

  const onSave = (event) => {
    event.preventDefault()
    setMessage('')

    restaurantService
      .updateMine({
        name: form.restaurantName,
        address: form.address,
        phone: form.phone,
        lowStockThresholdPercent: Number(form.lowStockThresholdPercent || 10),
        inventoryEnabled: Boolean(form.inventoryEnabled),
        analyticsEnabled: Boolean(form.analyticsEnabled),
      })
      .then((updated) => {
        setRestaurant(updated)
        setMessage('Saved successfully')
      })
      .catch((requestError) => {
        setMessage(requestError?.response?.data?.message || 'Failed to save settings')
      })
  }

  const onCreateStaff = (event) => {
    event.preventDefault()
    setStaffMessage('')

    restaurantService
      .createStaff(staffForm)
      .then((created) => {
        setStaffAccounts((prev) => [created, ...prev])
        setStaffForm({ username: '', passkey: '', displayName: '' })
        setStaffMessage('Staff credential created successfully')
      })
      .catch((requestError) => {
        setStaffMessage(requestError?.response?.data?.message || 'Failed to create staff credential')
      })
  }

  const onDeleteStaff = (staffId) => {
    setStaffMessage('')
    restaurantService
      .deleteStaff(staffId)
      .then(() => {
        setStaffAccounts((prev) => prev.filter((entry) => entry.id !== staffId))
        setStaffMessage('Staff credential deleted')
      })
      .catch((requestError) => {
        setStaffMessage(requestError?.response?.data?.message || 'Failed to delete staff credential')
      })
  }

  const onSaveKotReprintConfig = (event) => {
    event.preventDefault()
    setKotMessage('')

    restaurantService
      .updateKotReprintConfig({ passkey: kotPasskey })
      .then((updated) => {
        setRestaurant(updated)
        setKotPasskey('')
        setKotMessage('KOT reprint passkey saved successfully')
      })
      .catch((requestError) => {
        setKotMessage(requestError?.response?.data?.message || 'Failed to save KOT reprint passkey')
      })
  }

  return (
    <div className="space-y-4">
      <form className="card max-w-3xl space-y-3 p-4" onSubmit={onSave}>
        {message && <p className="text-sm text-[var(--primary)]">{message}</p>}
        <FormInput
          label="Restaurant Name"
          value={form.restaurantName}
          onChange={(e) => setForm((prev) => ({ ...prev, restaurantName: e.target.value }))}
        />
        <FormInput
          label="GSTIN"
          value={form.gstin}
          readOnly
          className="bg-slate-50 text-slate-600"
        />
        <FormInput label="Address" value={form.address} onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))} />
        <FormInput label="Phone" value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} />
        <FormInput
          label="Low Stock Alert Threshold (%)"
          type="number"
          min={1}
          max={100}
          step={1}
          value={form.lowStockThresholdPercent}
          onChange={(e) => setForm((prev) => ({ ...prev, lowStockThresholdPercent: e.target.value }))}
        />
        <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
          <span>
            <span className="block text-sm font-medium text-slate-800">Enable Inventory</span>
            <span className="block text-xs text-slate-500">
              {isCorePlan
                ? 'Included only in the Scale Plan. Disabled for your current plan.'
                : isProPlan
                  ? 'Enabled by your Scale Plan entitlement.'
                  : 'Disable to bypass stock, recipes, and inventory processing.'}
            </span>
          </span>
          <input
            type="checkbox"
            checked={Boolean(form.inventoryEnabled)}
            onChange={(e) => setForm((prev) => ({ ...prev, inventoryEnabled: e.target.checked }))}
            disabled={isModuleEntitlementLocked}
          />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
          <span>
            <span className="block text-sm font-medium text-slate-800">Enable Analytics</span>
            <span className="block text-xs text-slate-500">
              {isCorePlan
                ? 'Included only in the Scale Plan. Disabled for your current plan.'
                : isProPlan
                  ? 'Enabled by your Scale Plan entitlement.'
                  : 'Disable to stop analytics tracking, dashboards, and heavy reporting.'}
            </span>
          </span>
          <input
            type="checkbox"
            checked={Boolean(form.analyticsEnabled)}
            onChange={(e) => setForm((prev) => ({ ...prev, analyticsEnabled: e.target.checked }))}
            disabled={isModuleEntitlementLocked}
          />
        </label>
        <Button type="submit">Save Changes</Button>
      </form>

      <form className="card max-w-3xl space-y-3 p-4" onSubmit={onCreateStaff}>
        <div>
          <h2 className="text-base font-semibold text-slate-900">Staff Login Credentials</h2>
          <p className="text-xs text-slate-500">Create username + passkey credentials for staff dashboard access.</p>
        </div>
        {staffMessage && <p className="text-sm text-[var(--primary)]">{staffMessage}</p>}
        <FormInput
          label="Staff Username"
          value={staffForm.username}
          onChange={(e) => setStaffForm((prev) => ({ ...prev, username: e.target.value }))}
        />
        <FormInput
          label="Display Name (optional)"
          value={staffForm.displayName}
          onChange={(e) => setStaffForm((prev) => ({ ...prev, displayName: e.target.value }))}
        />
        <FormInput
          label="Passkey"
          type="password"
          value={staffForm.passkey}
          onChange={(e) => setStaffForm((prev) => ({ ...prev, passkey: e.target.value }))}
        />
        <Button type="submit">Create Staff Credential</Button>

        <div className="space-y-2 pt-2">
          {staffAccounts.map((staff) => (
            <div key={staff.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{staff.displayName || staff.username}</p>
                <p className="text-xs text-slate-500">@{staff.username}</p>
              </div>
              <Button type="button" variant="secondary" onClick={() => onDeleteStaff(staff.id)}>
                Delete
              </Button>
            </div>
          ))}
          {!staffAccounts.length && <p className="text-xs text-slate-500">No staff credentials created yet.</p>}
        </div>
      </form>

      <form className="card max-w-3xl space-y-3 p-4" onSubmit={onSaveKotReprintConfig}>
        <div>
          <h2 className="text-base font-semibold text-slate-900">KOT Reprint Authorization</h2>
          <p className="text-xs text-slate-500">
            Any KOT reprint after the first print will require this passkey and a reason. The reason is emailed to the manager.
          </p>
        </div>
        {kotMessage && <p className="text-sm text-[var(--primary)]">{kotMessage}</p>}
        <p className="text-xs text-slate-500">
          Status: {restaurant?.hasKotReprintPasskey ? 'Configured' : 'Not configured'}
        </p>
        <FormInput
          label={restaurant?.hasKotReprintPasskey ? 'Rotate Manager Reprint Passkey' : 'Manager Reprint Passkey'}
          type="password"
          value={kotPasskey}
          onChange={(event) => setKotPasskey(event.target.value)}
          required
        />
        <Button type="submit">Save Reprint Passkey</Button>
      </form>
    </div>
  )
}