export default function CardContainer({ title, subtitle, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card group w-full p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[0_18px_30px_rgba(2,6,23,0.08)]"
    >
      <div className="mb-3">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {subtitle ? <p className="text-sm text-slate-600">{subtitle}</p> : null}
      </div>
      {children}
      <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-red-600 group-hover:text-red-700">Open analysis</p>
    </button>
  )
}
