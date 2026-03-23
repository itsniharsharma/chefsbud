function toTimestamp(value) {
  const ts = value ? new Date(value).getTime() : NaN
  return Number.isFinite(ts) ? ts : 0
}

function hasBillingAccess(billing) {
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

export async function requireActiveBilling(req, res, next) {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    if (req.user.emailVerified === false) {
      return res.status(403).json({ message: 'Verify your email to continue' })
    }

    if (!hasBillingAccess(req.user.billing)) {
      const pausedMessage =
        req.user.billing?.status === 'past_due' || req.user.billing?.status === 'cancelled'
          ? 'Your subscription has been paused due to failed payment. Please contact support to continue.'
          : 'Billing inactive. Please update your subscription to continue.'
      return res.status(403).json({ message: pausedMessage })
    }

    return next()
  } catch (error) {
    return next(error)
  }
}
