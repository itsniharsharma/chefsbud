export default function AnalyticsPage() {
  return (
    <section className="space-y-5">
      <div className="card overflow-hidden border border-amber-100 bg-gradient-to-br from-amber-50 via-white to-red-50 p-6 md:p-8">
        <p className="inline-flex rounded-full border border-amber-200 bg-amber-100/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-800">
          In Progress
        </p>

        <h1 className="mt-4 text-2xl font-extrabold text-slate-900 md:text-3xl">Analytics Section Is Currently Developing</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 md:text-base">
          We are moving analytics computation out of the app layer and into a dedicated pipeline. Upcoming dashboards will be powered by an AWS-backed data flow and served through optimized APIs.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 1</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Build pipeline</p>
            <p className="mt-1 text-xs text-slate-600">Ingest order and menu events into cloud storage and processing jobs.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 2</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Aggregate metrics</p>
            <p className="mt-1 text-xs text-slate-600">Compute daily and near-real-time KPI summaries outside the request path.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 3</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Serve via API</p>
            <p className="mt-1 text-xs text-slate-600">Expose lightweight analytics endpoints consumed by this dashboard.</p>
          </div>
        </div>
      </div>
    </section>
  )
}
