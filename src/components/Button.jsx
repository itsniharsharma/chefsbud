export default function Button({ children, variant = 'primary', className = '', ...props }) {
  const base =
    'rounded-xl px-4 py-2 text-sm font-semibold tracking-wide transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed shadow-sm'
  const styles =
    variant === 'secondary'
      ? 'border border-slate-300 bg-white/95 text-slate-700 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-white hover:shadow-md'
      : variant === 'custom'
        ? ''
      : 'bg-gradient-to-r from-[var(--primary-dark)] to-[var(--primary)] text-white hover:-translate-y-0.5 hover:shadow-[0_12px_24px_rgba(229,9,20,0.3)]'

  return (
    <button className={`${base} ${styles} ${className}`} {...props}>
      {children}
    </button>
  )
}
