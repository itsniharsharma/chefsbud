function toTimestamp(value) {
  const ts = value ? new Date(value).getTime() : NaN
  return Number.isFinite(ts) ? ts : 0
}

export function hasBillingAccess(billing) {
  if (!billing) {
    return false
  }

  if (billing.status === 'active') {
    return true
  }

  const now = Date.now()
  const graceWindowEnds = Math.max(toTimestamp(billing.graceEndsAt), toTimestamp(billing.currentPeriodEnd))
  return ['grace_period', 'past_due'].includes(billing.status) && graceWindowEnds > now
}
