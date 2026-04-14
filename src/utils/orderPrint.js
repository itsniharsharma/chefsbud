import { formatCurrencyINR } from './currency'
import { getOrderDisplayNumber } from './orderDisplay'

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
  const orderDisplayNumber = getOrderDisplayNumber(order)

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Bill ${escapeHtml(orderDisplayNumber)}</title>
    <style>
      :root {
        color-scheme: light;
      }

      html,
      body {
        margin: 0;
        padding: 0;
        width: auto;
        height: auto;
        min-height: 0;
        background: #fff;
        color: #0f172a;
        font-family: Arial, sans-serif;
      }

      body {
        display: inline-block;
      }

      .bill-container {
        box-sizing: border-box;
        display: inline-block;
        width: 190mm;
        max-width: 100%;
        margin: 0;
        padding: 8mm;
        min-height: 0;
        height: auto;
      }

      .bill-title {
        margin: 0 0 6px 0;
        font-size: 22px;
      }

      .meta {
        font-size: 12px;
        line-height: 1.45;
      }

      hr {
        margin: 8px 0;
        border: 0;
        border-top: 1px solid #cbd5e1;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        page-break-inside: avoid;
      }

      th,
      td {
        padding: 3px 0;
      }

      .totals {
        font-size: 13px;
        line-height: 1.5;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
      }

      .totals-strong {
        font-weight: 700;
        font-size: 15px;
      }

      .avoid-break {
        page-break-inside: avoid;
        break-inside: avoid;
      }

      @page {
        size: A4 portrait;
        margin: 6mm;
      }

      @media print {
        html,
        body {
          margin: 0 !important;
          padding: 0 !important;
          width: auto !important;
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
        }

        .bill-container {
          width: auto !important;
          max-width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          min-height: 0 !important;
          height: auto !important;
        }

        .avoid-break {
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }

        hr {
          margin: 6px 0;
        }
      }
    </style>
  </head>
  <body>
    <main class="bill-container">
    <h2 class="bill-title">${escapeHtml(restaurantName || "Chef's Bud")}</h2>
    <div class="meta avoid-break">
      <div><strong>Order:</strong> ${escapeHtml(orderDisplayNumber)}</div>
      <div><strong>Table:</strong> ${escapeHtml(order.tableNumber)} | <strong>Floor:</strong> ${escapeHtml(order.floorNumber || 1)}</div>
      <div><strong>Time:</strong> ${escapeHtml(order.createdAt ? new Date(order.createdAt).toLocaleString() : '-')}</div>
      <div><strong>Status:</strong> ${escapeHtml(order.orderStatus || '-')}</div>
    </div>
    <hr />
    <table class="avoid-break">
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
    <hr />
    <div style="font-size:12px;font-weight:700;margin-bottom:4px;" class="avoid-break">Bill Adjustments</div>
    <table class="avoid-break">
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
    <hr />
    <div class="totals avoid-break">
      <div>Order subtotal: ${escapeHtml(formatCurrencyINR(baseSubtotal))}</div>
      ${discountTotal > 0 ? `<div>Discounts: -${escapeHtml(formatCurrencyINR(discountTotal))}</div>` : ''}
      ${adjustmentSubtotal > 0 ? `<div>Bill adjustments: +${escapeHtml(formatCurrencyINR(adjustmentSubtotal))}</div>` : ''}
      <div class="totals-strong">Total: ${escapeHtml(formatCurrencyINR(finalTotal))}</div>
    </div>
    </main>
  </body>
</html>`
}

export function buildKotHtml({ order }) {
  const orderDisplayNumber = getOrderDisplayNumber(order)
  const createdAt = order.createdAt ? new Date(order.createdAt).toLocaleString() : '-'
  const note = order.customerNote ? escapeHtml(String(order.customerNote)) : ''

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>KOT - ${escapeHtml(orderDisplayNumber)}</title>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        width: auto;
        height: auto;
        min-height: 0;
        background: #fff;
        color: #0f172a;
        font-family: Arial, sans-serif;
      }

      body {
        display: inline-block;
      }

      .kot-container {
        box-sizing: border-box;
        display: inline-block;
        width: 80mm;
        max-width: 100%;
        margin: 0;
        padding: 6mm;
        min-height: 0;
        height: auto;
      }

      .kot-title {
        margin: 0 0 6px 0;
        font-size: 20px;
      }

      .meta {
        font-size: 12px;
        line-height: 1.45;
      }

      hr {
        margin: 8px 0;
        border: 0;
        border-top: 1px solid #cbd5e1;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        page-break-inside: avoid;
      }

      .avoid-break {
        page-break-inside: avoid;
        break-inside: avoid;
      }

      @page {
        size: auto;
        margin: 5mm;
      }

      @media print {
        html,
        body {
          margin: 0 !important;
          padding: 0 !important;
          width: auto !important;
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
        }

        .kot-container {
          width: auto !important;
          max-width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          min-height: 0 !important;
          height: auto !important;
        }
      }
    </style>
  </head>
  <body>
    <main class="kot-container">
    <h2 class="kot-title">KITCHEN ORDER TICKET</h2>
    <div class="meta avoid-break">
      <div><strong>Order:</strong> ${escapeHtml(orderDisplayNumber)}</div>
      <div><strong>Table:</strong> ${order.tableNumber} | <strong>Floor:</strong> ${order.floorNumber || 1}</div>
      <div><strong>Time:</strong> ${createdAt}</div>
      <div><strong>Status:</strong> ${order.orderStatus}</div>
    </div>
    <hr />
    <table class="avoid-break">
      <tbody>
        ${buildKotRows(order)}
      </tbody>
    </table>
    ${note ? `<hr /><div style="font-size:12px;" class="avoid-break"><strong>Note:</strong> ${note}</div>` : ''}
    </main>
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
