import { useEffect, useState } from 'react'
import Button from '../components/Button'
import FormInput from '../components/FormInput'
import { useAuth } from '../hooks/useAuth'
import { restaurantService } from '../services/restaurantService'

export default function SettingsPage() {
  const { restaurant, setRestaurant } = useAuth()
  const [form, setForm] = useState({
    restaurantName: '',
    address: '',
    phone: '',
  })
  const [message, setMessage] = useState('')
  const [staffMessage, setStaffMessage] = useState('')
  const [staffAccounts, setStaffAccounts] = useState([])
  const [staffForm, setStaffForm] = useState({
    username: '',
    passkey: '',
    displayName: '',
  })

  useEffect(() => {
    if (!restaurant) return
    setForm({
      restaurantName: restaurant.name || '',
      address: restaurant.address || '',
      phone: restaurant.phone || '',
    })
  }, [restaurant])

  useEffect(() => {
    restaurantService
      .listStaff()
      .then((data) => {
        setStaffAccounts(Array.isArray(data) ? data : [])
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

  return (
    <div className="space-y-4">
      <form className="card max-w-3xl space-y-3 p-4" onSubmit={onSave}>
        {message && <p className="text-sm text-[var(--primary)]">{message}</p>}
        <FormInput
          label="Restaurant Name"
          value={form.restaurantName}
          onChange={(e) => setForm((prev) => ({ ...prev, restaurantName: e.target.value }))}
        />
        <FormInput label="Address" value={form.address} onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))} />
        <FormInput label="Phone" value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} />
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
    </div>
  )
}