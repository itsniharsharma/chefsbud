import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

const cardReveal = {
  hidden: { opacity: 0, y: 14 },
  visible: (index) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.28,
      ease: [0.22, 1, 0.36, 1],
      delay: index * 0.05,
    },
  }),
}

export default function InventoryCard({ moduleItem, index = 0 }) {
  const Icon = moduleItem?.icon
  const MotionItem = motion.li

  return (
    <MotionItem
      variants={cardReveal}
      initial="hidden"
      animate="visible"
      custom={index}
      whileHover={{ scale: 1.03 }}
      className="list-none"
    >
      <Link
        to={moduleItem.route}
        className="group block h-full rounded-xl border border-rose-100 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.08)] transition-all duration-200 hover:shadow-[0_20px_36px_rgba(15,23,42,0.14)] focus:outline-none focus-visible:ring-4 focus-visible:ring-rose-100"
      >
        <div className="flex h-full items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-rose-100 bg-gradient-to-br from-rose-50 to-white text-[var(--primary)]">
              {Icon ? <Icon size={20} strokeWidth={2.2} /> : null}
            </div>
            <h3 className="mt-4 text-base font-bold text-slate-900">{moduleItem.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">{moduleItem.description}</p>
          </div>
          <span className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-rose-100 text-slate-500 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--primary)]">
            <ArrowRight size={16} />
          </span>
        </div>
      </Link>
    </MotionItem>
  )
}
