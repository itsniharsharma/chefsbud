export function requireOwner(req, res, next) {
  if (req.user?.role !== 'owner') {
    return res.status(403).json({ message: 'Only manager access is allowed for this action.' })
  }
  return next()
}