import { useEffect, useMemo, useState } from 'react'
import Button from '../components/Button'
import { useAuth } from '../hooks/useAuth'
import { orderService } from '../services/orderService'
import { formatCurrencyINR } from '../utils/currency'

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildBillHtml(order, restaurantName) {
  const rows = (order.items || [])
    .map((item) => {
      const qty = Number(item.quantity || 0)
      const price = Number(item.price || 0)
      const subtotal = qty * price
      return `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td style="text-align:center;">${qty}</td>
          <td style="text-align:right;">${escapeHtml(formatCurrencyINR(price))}</td>
          <td style="text-align:right;">${escapeHtml(formatCurrencyINR(subtotal))}</td>
        </tr>
      `
    })
    .join('')

  const offerRows = (order.appliedOffers || [])
    .map((offer) => `
      <tr>
        <td colspan="3">${escapeHtml(offer.description || offer.name || 'Offer')}</td>
        <td style="text-align:right;">- ${escapeHtml(formatCurrencyINR(offer.discountAmount || 0))}</td>
      </tr>
    `)
    .join('')

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Bill ${escapeHtml(order._id)}</title>
    <style>
      body {
        font-family: 'Avenir Next', 'Segoe UI', Arial, sans-serif;
        margin: 0;
        padding: 20px;
        background: #f4f0eb;
        color: #1f2937;
      }
      .bill-shell {
        max-width: 780px;
        margin: 0 auto;
        background: #ffffff;
        border: 1px solid #f3d8db;
        border-radius: 18px;
        overflow: hidden;
        box-shadow: 0 16px 40px rgba(17, 24, 39, 0.08);
      }
      .brand {
        padding: 24px;
        background: linear-gradient(135deg, #7f1d1d 0%, #b91c1c 52%, #991b1b 100%);
        color: #fff8f2;
      }
      .brand h1 {
        margin: 0;
        font-size: 34px;
        letter-spacing: 0.02em;
      }
      .brand p {
        margin: 6px 0 0;
        font-size: 13px;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: #fde68a;
      }
      .content {
        padding: 24px;
      }
      .head {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        margin-bottom: 16px;
      }
      p { margin: 4px 0; }
      .meta { color: #64748b; font-size: 13px; }
      .meta-box {
        min-width: 240px;
        background: #fff8f5;
        border: 1px solid #f7d7db;
        border-radius: 12px;
        padding: 12px;
      }
      table { width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 16px; }
      th, td { border-bottom: 1px solid #f1f5f9; padding: 10px 8px; font-size: 14px; }
      th {
        background: #fff5f5;
        text-align: left;
        color: #991b1b;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .totals {
        margin-top: 18px;
        margin-left: auto;
        max-width: 320px;
        background: #fff8f5;
        border: 1px solid #f7d7db;
        border-radius: 12px;
        padding: 12px;
      }
      .total-line {
        display: flex;
        justify-content: space-between;
        font-size: 14px;
        color: #334155;
      }
      .grand-total {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px dashed #f0b7c0;
        display: flex;
        justify-content: space-between;
        font-size: 20px;
        font-weight: 800;
        color: #b91c1c;
      }
      .footer {
        margin-top: 22px;
        padding-top: 10px;
        border-top: 1px solid #fee2e2;
        text-align: center;
        font-size: 12px;
        color: #64748b;
      }
    </style>
  </head>
  <body>
    <div class="bill-shell">
      <div class="brand">
        <h1>${escapeHtml(restaurantName || "Chef's Bud")}</h1>
        <p>Chef's Bud • Luxury Restaurant Intelligence</p>
      </div>

      <div class="content">
        <div class="head">
          <div>
            <p class="meta">Premium Order Bill</p>
            <p class="meta">Crafted for elevated dining operations</p>
          </div>
          <div class="meta-box">
            <p><strong>Order:</strong> ${escapeHtml(order._id)}</p>
            <p><strong>Floor:</strong> ${escapeHtml(order.floorNumber || 1)}</p>
            <p><strong>Table:</strong> ${escapeHtml(order.tableNumber)}</p>
            <p><strong>Date:</strong> ${escapeHtml(new Date(order.createdAt).toLocaleString())}</p>
            <p><strong>Payment:</strong> ${escapeHtml(order.paymentStatus)}</p>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th style="text-align:center;">Qty</th>
              <th style="text-align:right;">Price</th>
              <th style="text-align:right;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            ${offerRows}
          </tbody>
        </table>

        <div class="totals">
          <div class="total-line"><span>Subtotal</span><span>${escapeHtml(formatCurrencyINR(order.subtotalAmount || order.totalAmount || 0))}</span></div>
          <div class="total-line"><span>Discount</span><span>${escapeHtml(formatCurrencyINR(order.discountTotal || 0))}</span></div>
          <div class="grand-total"><span>Total</span><span>${escapeHtml(formatCurrencyINR(order.totalAmount))}</span></div>
        </div>

        ${order.couponCode ? `<p class="meta" style="margin-top:10px;">Coupon: ${escapeHtml(order.couponCode)}</p>` : ''}

        <div class="footer">
          <p><strong>Chef's Bud</strong></p>
          <p>Luxury Restaurant Intelligence • Precision Billing</p>
        </div>
      </div>
    </div>
  </body>
</html>`
}

export default function BillingPage() {
  const { restaurant } = useAuth()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [deletingOrderId, setDeletingOrderId] = useState('')
  const [error, setError] = useState('')
  const [readyToDeleteOrderIds, setReadyToDeleteOrderIds] = useState([])

  useEffect(() => {
    if (!restaurant?._id) return
    setLoading(true)
    orderService
      .list(restaurant._id, { scope: 'all', limit: 200, view: 'completed' })
      .then((data) => {
        setOrders(data)
        setError('')
      })
      .catch((requestError) => {
        setError(requestError?.response?.data?.message || 'Unable to load billing orders')
      })
      .finally(() => setLoading(false))
  }, [restaurant?._id])

  const totals = useMemo(() => {
    const count = orders.length
    const revenue = orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0)
    return { count, revenue }
  }, [orders])

  const removeBilledOrder = async (order) => {
    setDeletingOrderId(order._id)
    try {
      if (!['Served', 'Completed'].includes(order.orderStatus)) {
        await orderService.updateStatus(order._id, 'Completed')
      }
      await orderService.delete(order._id)
      setOrders((prev) => prev.filter((entry) => entry._id !== order._id))
      setReadyToDeleteOrderIds((prev) => prev.filter((id) => id !== order._id))
      setError('')
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'Failed to delete order')
    } finally {
      setDeletingOrderId('')
    }
  }

  const markReadyToDelete = (orderId) => {
    setReadyToDeleteOrderIds((prev) => (prev.includes(orderId) ? prev : [...prev, orderId]))
  }

  const printBill = (order) => {
    const html = buildBillHtml(order, restaurant?.name)
    const printWindow = window.open('', '_blank', 'width=900,height=700')
    if (!printWindow) return
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
    markReadyToDelete(order._id)
  }

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-[var(--primary)]">{error}</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Orders In Billing</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{totals.count}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total Bill Amount</p>
          <p className="mt-1 text-2xl font-bold text-[var(--primary)]">{formatCurrencyINR(totals.revenue)}</p>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="mb-3 text-lg font-semibold">Billing Orders</h2>
        {loading ? (
          <p className="text-sm text-slate-500">Loading billing data...</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-slate-500">No orders available for billing yet.</p>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <div key={order._id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">Order #{order._id.slice(-8).toUpperCase()}</p>
                    <p className="text-xs text-slate-500">{new Date(order.createdAt).toLocaleString()}</p>
                    <p className="mt-1 text-slate-600">Table {order.tableNumber} • {order.paymentStatus} • {order.orderStatus}</p>
                    {order.discountTotal > 0 ? (
                      <p className="text-xs text-emerald-700">Saved {formatCurrencyINR(order.discountTotal)} via offers</p>
                    ) : null}
                  </div>
                  <p className="text-base font-bold text-[var(--primary)]">{formatCurrencyINR(order.totalAmount)}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button onClick={() => printBill(order)} disabled={deletingOrderId === order._id}>
                    Print Bill
                  </Button>
                  {readyToDeleteOrderIds.includes(order._id) ? (
                    <Button variant="secondary" onClick={() => removeBilledOrder(order)} disabled={deletingOrderId === order._id}>
                      {deletingOrderId === order._id ? 'Deleting...' : 'Delete Order'}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
