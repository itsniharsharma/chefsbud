import { QRCodeCanvas } from 'qrcode.react'
import Button from './Button'
import { buildCustomerMenuUrl } from '../utils/customerUrl'
import { createLabeledQrDataUrl } from '../utils/qrDownload'

export default function QRCard({ tableNumber, floorNumber = 1, slug }) {
  const hasValidSlug = Boolean(String(slug || '').trim())
  const value = hasValidSlug
    ? buildCustomerMenuUrl({
      baseUrl: import.meta.env.VITE_FRONTEND_BASE_URL || window.location.origin,
      slug,
      tableNumber,
      floorNumber,
    })
    : ''

  const download = async () => {
    if (!value) return

    try {
      const { default: QRCode } = await import('qrcode')
      const url = await createLabeledQrDataUrl({
        QRCode,
        value,
        tableNumber,
        floorNumber,
        qrSize: 720,
      })

      const link = document.createElement('a')
      link.href = url
      link.download = `floor-${Number(floorNumber || 1)}-table-${tableNumber}-qr.png`
      link.click()
    } catch (error) {
      console.error('Failed to download labeled QR code', error)
    }
  }

  return (
    <div className="card p-4">
      <p className="font-semibold text-slate-800">Floor {Number(floorNumber || 1)} | Table {tableNumber}</p>
      {hasValidSlug ? (
        <>
          <p className="mb-3 mt-1 text-sm text-slate-500">QR: {value}</p>
          <div className="mb-3 inline-block rounded-lg border border-slate-200 p-2">
            <QRCodeCanvas value={value} size={150} />
          </div>
          <Button onClick={download}>Download QR</Button>
        </>
      ) : (
        <p className="mb-3 mt-1 text-sm text-[var(--primary)]">Restaurant slug missing. Save restaurant details and refresh tables.</p>
      )}
    </div>
  )
}
