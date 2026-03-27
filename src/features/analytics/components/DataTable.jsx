export default function DataTable({ columns, rows, rowKey = 'id', emptyText = 'No data available.' }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.length ? rows.map((row, index) => (
            <tr key={row[rowKey] || `${index}`}>
              {columns.map((column) => (
                <td key={column.key} className="px-3 py-2 text-slate-700">
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          )) : (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-sm text-slate-500">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
