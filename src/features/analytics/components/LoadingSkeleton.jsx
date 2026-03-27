export function DashboardLoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {Array.from({ length: 9 }).map((_, idx) => (
          <div key={idx} className="card animate-pulse p-4">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="mt-3 h-7 w-28 rounded bg-slate-200" />
            <div className="mt-3 h-6 w-20 rounded-full bg-slate-200" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div key={idx} className="card animate-pulse p-4">
            <div className="h-5 w-40 rounded bg-slate-200" />
            <div className="mt-2 h-4 w-64 rounded bg-slate-100" />
            <div className="mt-4 h-56 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  )
}
