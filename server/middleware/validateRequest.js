import { validationResult } from 'express-validator'

export function validateRequest(req, res, next) {
  if (req?._orderCreateStartedAtNs && !req?._orderCreateValidatedAtNs) {
    req._orderCreateValidatedAtNs = process.hrtime.bigint()
  }

  const errors = validationResult(req)
  if (errors.isEmpty()) {
    return next()
  }

  return res.status(400).json({
    message: 'Validation failed',
    errors: errors.array(),
  })
}
