import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../components/Button'
import QRCard from '../components/QRCard'
import { useAuth } from '../hooks/useAuth'
import { tableService } from '../services/tableService'
import { buildCustomerMenuUrl } from '../utils/customerUrl'
import { useTablesQuery } from '../hooks/useDashboardQueries'
import { queryKeys } from '../lib/queryKeys'

export default function TablesPage() {
  const [count, setCount] = useState('12')
  const [floorNumber, setFloorNumber] = useState('1')
  const [error, setError] = useState('')
  const [batchDownloading, setBatchDownloading] = useState(false)
  const { restaurant } = useAuth()
  const queryClient = useQueryClient()

  const { data: tables = [] } = useTablesQuery({
    restaurantId: restaurant?._id,
  })

  const createTablesMutation = useMutation({
    mutationFn: (payload) => tableService.create(payload),
    onSuccess: (nextTables) => {
      setError('')
      queryClient.setQueryData(queryKeys.dashboard.tables(restaurant?._id), nextTables)
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.tables(restaurant?._id) })
    },
    onError: (requestError) => {
      setError(requestError?.response?.data?.message || 'Failed to create tables')
    },
  })

  const generateTables = () => {
    const nextFloorNumber = Number(floorNumber)
    const nextCount = Number(count)

    if (!Number.isFinite(nextFloorNumber) || nextFloorNumber < 1) {
      setError('Floor number must be at least 1')
      return
    }

    if (!Number.isFinite(nextCount) || nextCount < 1) {
      setError('Table count must be at least 1')
      return
    }

    createTablesMutation.mutate({
      count: Math.floor(nextCount),
      floorNumber: Math.floor(nextFloorNumber),
    })
  }

  const downloadAllQRCodes = async () => {
    if (!tables.length || !restaurant?.slug) return

    setBatchDownloading(true)
    setError('')

    try {
      const [{ default: JSZip }, { default: QRCode }] = await Promise.all([import('jszip'), import('qrcode')])
      const frontendBaseUrl = import.meta.env.VITE_FRONTEND_BASE_URL || window.location.origin
      const zip = new JSZip()

      for (const table of tables) {
        const floor = Number(table.floorNumber || 1)
        const tableNumber = table.tableNumber
        const qrValue = buildCustomerMenuUrl({
          baseUrl: frontendBaseUrl,
          slug: restaurant.slug,
          tableNumber,
          floorNumber: floor,
        })
        const dataUrl = await QRCode.toDataURL(qrValue, {
          width: 720,
          margin: 2,
          errorCorrectionLevel: 'H',
        })

        const base64Png = dataUrl.split(',')[1]
        zip.file(`floor-${floor}-table-${tableNumber}-qr.png`, base64Png, { base64: true })
      }

      const floorsIncluded = [...new Set(tables.map((table) => Number(table.floorNumber || 1)))]
        .sort((a, b) => a - b)
        .join(', ')

      zip.file(
        'README.txt',
        [
          `Restaurant: ${restaurant.name || restaurant.slug}`,
          `Generated at: ${new Date().toLocaleString()}`,
          `Floors included: ${floorsIncluded}`,
          '',
          'Each PNG file contains the table QR code URL in this format:',
          buildCustomerMenuUrl({
            baseUrl: frontendBaseUrl,
            slug: restaurant.slug,
            tableNumber: '<tableNumber>',
            floorNumber: '<floorNumber>',
          }),
        ].join('\n'),
      )

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const blobUrl = URL.createObjectURL(zipBlob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = `${restaurant.slug || 'restaurant'}-all-table-qrs.zip`
      link.click()
      URL.revokeObjectURL(blobUrl)
    } catch (downloadError) {
      setError(downloadError?.message || 'Failed to batch download QR codes')
    } finally {
      setBatchDownloading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Add number of tables</h2>
          <Button variant="secondary" onClick={downloadAllQRCodes} disabled={!tables.length || batchDownloading}>
            {batchDownloading ? 'Preparing ZIP...' : 'Download All QR Codes'}
          </Button>
        </div>
        {error && <p className="mb-3 text-sm text-[var(--primary)]">{error}</p>}
        <div className="flex flex-col gap-3 md:flex-row">
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            <span className="font-medium">Floor number</span>
            <input
              className="input max-w-xs"
              type="number"
              min="1"
              value={floorNumber}
              onChange={(e) => setFloorNumber(e.target.value)}
              placeholder="Floor number"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            <span className="font-medium">How many tables</span>
            <input
              className="input max-w-xs"
              type="number"
              min="1"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </label>
          <Button onClick={generateTables}>Generate QRs For This Floor</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tables.map((table) => (
          <div key={table._id || table.tableNumber} className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-lg font-semibold">Table {table.tableNumber}</p>
              <span
                className={`rounded px-2 py-1 text-xs ${
                  table.active ? 'bg-red-50 text-[var(--primary)]' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {table.active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <p className="mb-2 text-sm text-slate-600">Floor {Number(table.floorNumber || 1)}</p>
            <QRCard
              tableNumber={table.tableNumber}
              floorNumber={Number(table.floorNumber || 1)}
              slug={restaurant?.slug || ''}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
