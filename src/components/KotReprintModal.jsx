import { useEffect, useState } from 'react'
import Modal from './Modal'
import Button from './Button'
import FormInput from './FormInput'

const initialForm = {
  reprintPasskey: '',
  reprintReason: '',
}

export default function KotReprintModal({ open, order, hasPasskey, loading, onClose, onConfirm }) {
  const [form, setForm] = useState(initialForm)

  useEffect(() => {
    if (!open) {
      setForm(initialForm)
    }
  }, [open])

  const submit = (event) => {
    event.preventDefault()
    if (!hasPasskey || loading) return
    onConfirm?.({
      reprintPasskey: form.reprintPasskey,
      reprintReason: form.reprintReason,
    })
  }

  return (
    <Modal open={open} title="Authorize KOT Reprint" onClose={loading ? undefined : onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <p className="text-sm text-slate-600">
          Order <span className="font-semibold text-slate-900">{order?._id || order?.id || '-'}</span> was already printed once.
          Enter the manager reprint passkey and a reason before printing again.
        </p>
        {!hasPasskey ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            KOT reprint passkey is not configured yet. Set it in Settings before reprinting.
          </p>
        ) : null}
        <FormInput
          label="Manager Reprint Passkey"
          type="password"
          value={form.reprintPasskey}
          onChange={(event) => setForm((prev) => ({ ...prev, reprintPasskey: event.target.value }))}
          required
        />
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          <span className="font-medium">Reason</span>
          <textarea
            className="input min-h-24"
            value={form.reprintReason}
            onChange={(event) => setForm((prev) => ({ ...prev, reprintReason: event.target.value }))}
            maxLength={240}
            required
          />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" disabled={!hasPasskey || loading}>
            {loading ? 'Authorizing...' : 'Authorize Reprint'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}