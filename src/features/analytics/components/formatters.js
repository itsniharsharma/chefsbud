import { formatCurrencyINR } from '../../../utils/currency'

export function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`
}

export function formatCompactNumber(value) {
  return Number(value || 0).toLocaleString('en-IN')
}

export function formatKpiNumber(value) {
  return Number(value || 0).toFixed(2).replace(/\.00$/, '')
}

export function formatMoney(value) {
  return formatCurrencyINR(Number(value || 0))
}

export function getDeltaTone(changePercent) {
  const numeric = Number(changePercent || 0)
  if (numeric > 0) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (numeric < 0) return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

export function formatSigned(value, isPercent = false) {
  const numeric = Number(value || 0)
  const prefix = numeric > 0 ? '+' : ''
  return `${prefix}${isPercent ? `${numeric.toFixed(1)}%` : numeric.toFixed(2).replace(/\.00$/, '')}`
}
