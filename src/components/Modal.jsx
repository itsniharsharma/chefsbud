import { useEffect } from 'react'

export default function Modal({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open || !onClose) return undefined

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [open, onClose])

  if (!open) return null

  const titleId = title ? `modal-title-${String(title).toLowerCase().replace(/\s+/g, '-')}` : undefined

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && onClose) {
          onClose()
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="card flex max-h-[90vh] w-full max-w-md flex-col p-5"
      >
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h3 id={titleId} className="text-lg font-semibold text-slate-900">
            {title}
          </h3>
          <button className="text-slate-500" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
