import { motion } from 'framer-motion'
import PurchaseForm from './PurchaseForm'

export default function AddPurchase() {
  const MotionDiv = motion.div

  return (
    <MotionDiv
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
      className="space-y-4"
    >
      <div className="rounded-2xl border border-rose-100 bg-white/90 px-5 py-4 shadow-[0_14px_34px_rgba(15,23,42,0.08)] md:px-6">
        <h2 className="text-2xl font-bold text-slate-900">Add Purchase</h2>
        <p className="mt-1 text-sm text-slate-500">Manage supplier purchases and inward entries</p>
      </div>
      <PurchaseForm />
    </MotionDiv>
  )
}
