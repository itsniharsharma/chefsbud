export default function ChartWrapper({ title, subtitle, action, children, className = '' }) {
  return (
    <div className={`card p-4 ${className}`.trim()}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="text-sm text-slate-600">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}
