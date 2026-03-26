import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import AddPurchase from '../features/inventory/purchase/AddPurchase'

export default function AddPurchasePage() {
  return (
    <section className="space-y-4">
      <Link
        to="/inventory"
        className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-[var(--primary)] hover:bg-rose-50"
      >
        <ArrowLeft size={16} />
        Back to Inventory Dashboard
      </Link>
      <AddPurchase />
    </section>
  )
}
