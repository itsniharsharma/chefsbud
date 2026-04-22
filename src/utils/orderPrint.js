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

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function normalizePercent(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  if (parsed < 0) return 0
  if (parsed > 100) return 100
  return round2(parsed)
}

function buildBillView(order, restaurant) {
  const baseSubtotal = Number(order.totalAmount ?? order.subtotalAmount ?? 0)
  const adjustmentSubtotal = Number(order.billAdjustmentSubtotal || 0)
  const grossBeforeDiscount = round2(baseSubtotal + adjustmentSubtotal)
  const billDiscountPercent = normalizePercent(order.billDiscountPercent)
  const billDiscountAmount = round2(
    order.billDiscountAmount ?? ((grossBeforeDiscount * billDiscountPercent) / 100),
  )
  const billTaxableAmount = round2(
    order.billTaxableAmount ?? Math.max(0, grossBeforeDiscount - billDiscountAmount),
  )
  const billServiceChargePercent = normalizePercent(
    order.billServiceChargePercent ?? restaurant?.billingSettings?.serviceChargePercent,
  )
  const billServiceChargeAmount = round2(
    order.billServiceChargeAmount ?? ((billTaxableAmount * billServiceChargePercent) / 100),
  )
  const billGstPercent = normalizePercent(order.billGstPercent ?? restaurant?.billingSettings?.gstPercent)
  const billGstAmount = round2(order.billGstAmount ?? ((billTaxableAmount * billGstPercent) / 100))
  const finalTotal = round2(
    order.billFinalTotalAmount ?? (billTaxableAmount + billServiceChargeAmount + billGstAmount),
  )

  return {
    baseSubtotal,
    adjustmentSubtotal,
    grossBeforeDiscount,
    billDiscountPercent,
    billDiscountAmount,
    billTaxableAmount,
    billServiceChargePercent,
    billServiceChargeAmount,
    billGstPercent,
    billGstAmount,
    finalTotal,
    hasAdjustments: Array.isArray(order.billAdjustments) && order.billAdjustments.length > 0,
  }
}

export function buildCombinedBillKotHtml({ order, restaurant, restaurantName }) {
  const fallbackRestaurantName = String(restaurant?.name || restaurantName || "Chef's Bud")
  const restaurantGstin = String(restaurant?.gstin || '').trim()
  const orderDisplayNumber = getOrderDisplayNumber(order)
  const createdAt = order.createdAt ? new Date(order.createdAt).toLocaleString() : '-'
  const note = order.customerNote ? escapeHtml(String(order.customerNote)) : ''
  const bill = buildBillView(order, restaurant)

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Bill + KOT ${escapeHtml(orderDisplayNumber)}</title>
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

      .bundle-root {
        display: inline-block;
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

      .avoid-break {
        page-break-inside: avoid;
        break-inside: avoid;
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
        margin: 0;
        font-size: 23px;
        text-align: center;
        letter-spacing: 0.3px;
      }

      .bill-subtitle {
        margin-top: 2px;
        font-size: 11px;
        text-align: center;
        color: #475569;
      }

      .meta {
        font-size: 12px;
        line-height: 1.45;
      }

      .totals {
        font-size: 13px;
        line-height: 1.5;
        display: flex;
        flex-direction: column;
      }

      .total-line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }

      .totals-strong {
        font-weight: 700;
        font-size: 15px;
        color: #0f172a;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        border: 1px solid #cbd5e1;
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 10px;
        color: #334155;
      }

      .tear-line {
        width: 56mm;
        border-top: 2px dashed #94a3b8;
        margin: 6mm 0 2mm;
      }

      .tear-label {
        width: 56mm;
        margin: 0 0 6mm;
        text-align: center;
        color: #64748b;
        font-size: 10px;
        letter-spacing: 0.2px;
      }

      .kot-container {
        box-sizing: border-box;
        display: inline-block;
        width: 190mm;
        max-width: 100%;
        margin: 0;
        padding: 8mm;
        min-height: 0;
        height: auto;
      }

      .kot-title {
        margin: 0 0 6px 0;
        font-size: 20px;
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
    <section class="bundle-root">
    <main class="bill-container">
      <h2 class="bill-title">${escapeHtml(fallbackRestaurantName)}</h2>
      <div class="bill-subtitle">${restaurantGstin ? `GSTIN: ${escapeHtml(restaurantGstin)}` : 'GSTIN: NA'}</div>
      <div class="meta avoid-break">
        <div><strong>Order:</strong> ${escapeHtml(orderDisplayNumber)}</div>
        <div><strong>Time:</strong> ${escapeHtml(createdAt)}</div>
        <div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;">
          <span class="badge">TAX INVOICE</span>
        </div>
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
      ${bill.hasAdjustments ? `
      <hr />
      <div style="font-size:12px;font-weight:700;margin-bottom:4px;" class="avoid-break">Bill Adjustments</div>
      <table class="avoid-break">
        <thead>
          <tr>
            <th style="text-align:left;padding:4px 0;">Item</th>
            <th style="text-align:center;padding:4px 0;">Qty</th>
            <th style="text-align:right;padding:4px 0;">Price</th>
            <th style="text-align:right;padding:4px 0;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${buildAdjustmentRows(order)}</tbody>
      </table>` : ''}
      <hr />
      <div class="totals avoid-break">
        <div class="total-line"><span>Base amount</span><strong>${escapeHtml(formatCurrencyINR(bill.baseSubtotal))}</strong></div>
        <div class="total-line"><span>Extra items</span><strong>+${escapeHtml(formatCurrencyINR(bill.adjustmentSubtotal))}</strong></div>
        <div class="total-line"><span>Gross amount</span><strong>${escapeHtml(formatCurrencyINR(bill.grossBeforeDiscount))}</strong></div>
        <div class="total-line"><span>Discount (${escapeHtml(String(bill.billDiscountPercent))}%)</span><strong>-${escapeHtml(formatCurrencyINR(bill.billDiscountAmount))}</strong></div>
        <div class="total-line"><span>Taxable amount</span><strong>${escapeHtml(formatCurrencyINR(bill.billTaxableAmount))}</strong></div>
        <div class="total-line"><span>Service charge (${escapeHtml(String(bill.billServiceChargePercent))}%)</span><strong>+${escapeHtml(formatCurrencyINR(bill.billServiceChargeAmount))}</strong></div>
        <div class="total-line"><span>GST (${escapeHtml(String(bill.billGstPercent))}%)</span><strong>+${escapeHtml(formatCurrencyINR(bill.billGstAmount))}</strong></div>
        <hr />
        <div class="total-line totals-strong"><span>Grand Total</span><span>${escapeHtml(formatCurrencyINR(bill.finalTotal))}</span></div>
      </div>
    </main>

    <div class="tear-line"></div>
    <p class="tear-label">Tear here</p>

    <main class="kot-container">
      <h2 class="kot-title">KOT</h2>
      <div class="meta avoid-break">
        <div><strong>Order:</strong> ${escapeHtml(orderDisplayNumber)}</div>
        <div><strong>Table:</strong> ${order.tableNumber} | <strong>Floor:</strong> ${order.floorNumber || 1}</div>
        <div><strong>Time:</strong> ${createdAt}</div>
        <div><strong>Status:</strong> ${order.orderStatus}</div>
      </div>
      <hr />
      <table class="avoid-break">
        <tbody>${buildKotRows(order)}</tbody>
      </table>
      ${note ? `<hr /><div style="font-size:12px;" class="avoid-break"><strong>Note:</strong> ${note}</div>` : ''}
    </main>
    </section>
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
