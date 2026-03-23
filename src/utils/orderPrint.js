import { formatCurrencyINR } from './currency'

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildBillRows(items = []) {
  return items
    .map((item) => {
      const qty = Number(item.quantity || 0)
      const price = Number(item.price ?? item.unitPrice ?? 0)
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
}

function buildAdjustmentRows(order) {
  return (order.billAdjustments || [])
    .map((item) => {
      const qty = Number(item.quantity || 0)
      const price = Number(item.unitPrice || 0)
      const subtotal = qty * price
      const sourceLabel = item.sourceType === 'custom' ? 'Manual' : 'Extra'
      return `
          <tr>
            <td>${escapeHtml(item.name)}</td>
            <td style="text-align:center;">${qty}</td>
            <td style="text-align:right;">${escapeHtml(formatCurrencyINR(price))}</td>
            <td style="text-align:right;">${escapeHtml(formatCurrencyINR(subtotal))}</td>
            <td style="text-align:right;">${escapeHtml(sourceLabel)}</td>
          </tr>
        `
    })
    .join('')
}

function buildKotRows(order) {
  return Array.isArray(order.items)
    ? order.items
        .map((item) => {
          const name = escapeHtml(typeof item === 'string' ? item : item?.name || 'Item')
          const qty = typeof item === 'string' ? 1 : Number(item?.quantity || 1)
          return `<tr><td style="padding:4px 0;">${name}</td><td style="padding:4px 0;text-align:right;">x${qty}</td></tr>`
        })
        .join('')
    : ''
}

export function buildBillHtml({ order, restaurantName }) {
  const baseSubtotal = Number(order.subtotalAmount || 0)
  const discountTotal = Number(order.discountTotal || 0)
  const adjustmentSubtotal = Number(order.billAdjustmentSubtotal || 0)
  const finalTotal = Number(order.billFinalTotalAmount ?? order.totalAmount ?? 0)
  const hasAdjustments = Array.isArray(order.billAdjustments) && order.billAdjustments.length > 0

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Bill ${escapeHtml(order._id || order.id)}</title>
  </head>
  <body style="font-family:Arial,sans-serif;padding:16px;color:#0f172a;">
    <h2 style="margin:0 0 8px 0;">${escapeHtml(restaurantName || "Chef's Bud")}</h2>
    <div style="font-size:12px;line-height:1.6;">
      <div><strong>Order:</strong> ${escapeHtml(order._id || order.id)}</div>
      <div><strong>Table:</strong> ${escapeHtml(order.tableNumber)} | <strong>Floor:</strong> ${escapeHtml(order.floorNumber || 1)}</div>
      <div><strong>Time:</strong> ${escapeHtml(order.createdAt ? new Date(order.createdAt).toLocaleString() : '-')}</div>
      <div><strong>Status:</strong> ${escapeHtml(order.orderStatus || '-')}</div>
    </div>
    <hr style="margin:10px 0;"/>
    <table style="width:100%;font-size:13px;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="text-align:left;padding:4px 0;">Item</th>
          <th style="text-align:center;padding:4px 0;">Qty</th>
          <th style="text-align:right;padding:4px 0;">Price</th>
          <th style="text-align:right;padding:4px 0;">Subtotal</th>
        </tr>
      </thead>
      <tbody>${buildBillRows(order.items || [])}</tbody>
    </table>
    ${hasAdjustments ? `
    <hr style="margin:10px 0;"/>
    <div style="font-size:12px;font-weight:700;margin-bottom:4px;">Bill Adjustments</div>
    <table style="width:100%;font-size:13px;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="text-align:left;padding:4px 0;">Item</th>
          <th style="text-align:center;padding:4px 0;">Qty</th>
          <th style="text-align:right;padding:4px 0;">Price</th>
          <th style="text-align:right;padding:4px 0;">Subtotal</th>
          <th style="text-align:right;padding:4px 0;">Type</th>
        </tr>
      </thead>
      <tbody>${buildAdjustmentRows(order)}</tbody>
    </table>` : ''}
    <hr style="margin:10px 0;"/>
    <div style="font-size:13px;line-height:1.7;display:flex;flex-direction:column;align-items:flex-end;">
      <div>Order subtotal: ${escapeHtml(formatCurrencyINR(baseSubtotal))}</div>
      ${discountTotal > 0 ? `<div>Discounts: -${escapeHtml(formatCurrencyINR(discountTotal))}</div>` : ''}
      ${adjustmentSubtotal > 0 ? `<div>Bill adjustments: +${escapeHtml(formatCurrencyINR(adjustmentSubtotal))}</div>` : ''}
      <div style="font-weight:700;font-size:15px;">Total: ${escapeHtml(formatCurrencyINR(finalTotal))}</div>
    </div>
  </body>
</html>`
}

export function buildKotHtml({ order }) {
  const orderId = String(order?._id || order?.id || '')
  const createdAt = order.createdAt ? new Date(order.createdAt).toLocaleString() : '-'
  const note = order.customerNote ? escapeHtml(String(order.customerNote)) : ''

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>KOT - ${orderId}</title>
  </head>
  <body style="font-family:Arial,sans-serif;padding:14px;color:#0f172a;">
    <h2 style="margin:0 0 8px 0;">KITCHEN ORDER TICKET</h2>
    <div style="font-size:12px;line-height:1.6;">
      <div><strong>Order:</strong> ${orderId}</div>
      <div><strong>Table:</strong> ${order.tableNumber} | <strong>Floor:</strong> ${order.floorNumber || 1}</div>
      <div><strong>Time:</strong> ${createdAt}</div>
      <div><strong>Status:</strong> ${order.orderStatus}</div>
    </div>
    <hr style="margin:10px 0;"/>
    <table style="width:100%;font-size:13px;border-collapse:collapse;">
      <tbody>
        ${buildKotRows(order)}
      </tbody>
    </table>
    ${note ? `<hr style="margin:10px 0;"/><div style="font-size:12px;"><strong>Note:</strong> ${note}</div>` : ''}
  </body>
</html>`
}

function writeHtmlToWindow(opened, html) {
  opened.document.open()
  opened.document.write(html)
  opened.document.close()
}

export function openPrintWindow({ title, features }) {
  const opened = window.open('', '_blank', features)
  if (!opened) {
    throw new Error(`Popup blocked. Please allow popups to print ${title}.`)
  }

  writeHtmlToWindow(
    opened,
    `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head><body style="font-family:Arial,sans-serif;padding:16px;color:#475569;">Preparing ${escapeHtml(title)}...</body></html>`,
  )
  opened.focus()
  return opened
}

export function printHtmlDocument({ html, title, features }) {
  const opened = openPrintWindow({ title, features })
  writeHtmlToWindow(opened, html)
  opened.print()
}

export function printIntoWindow(opened, html) {
  if (!opened || opened.closed) {
    throw new Error('Print window was closed before printing could start.')
  }

  writeHtmlToWindow(opened, html)
  opened.focus()
  opened.print()
}

export function closePrintWindow(opened) {
  if (!opened || opened.closed) return
  opened.close()
}
