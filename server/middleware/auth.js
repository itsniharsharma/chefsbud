import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import StaffAccount from '../models/StaffAccount.js'

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: 'JWT secret is not configured' })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    if (!decoded?.userId) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    if (decoded?.role === 'staff') {
      const ownerId = String(decoded?.ownerId || decoded?.userId || '').trim()
      const staffId = String(decoded?.staffId || '').trim()
      const restaurantId = String(decoded?.restaurantId || '').trim()

      if (!ownerId || !staffId || !restaurantId) {
        return res.status(401).json({ message: 'Unauthorized' })
      }

      const [staff, owner] = await Promise.all([
        StaffAccount.findOne({
          _id: staffId,
          ownerId,
          restaurantId,
          isActive: true,
        })
          .select('_id ownerId restaurantId username displayName isActive')
          .lean(),
        User.findById(ownerId)
          .select('_id name email role emailVerified tokenVersion billing')
          .lean(),
      ])

      if (!staff || !owner) {
        return res.status(401).json({ message: 'Invalid token' })
      }

      const tokenVersion = Number(decoded?.tokenVersion || 0)
      const currentTokenVersion = Number(owner?.tokenVersion || 0)
      if (tokenVersion !== currentTokenVersion) {
        return res.status(401).json({ message: 'Session expired. Please log in again.' })
      }

      req.user = {
        _id: owner._id,
        ownerId: owner._id,
        role: 'staff',
        staffId: staff._id,
        staffUsername: staff.username,
        staffDisplayName: staff.displayName,
        restaurantId: staff.restaurantId,
        name: staff.displayName || staff.username,
        email: owner.email,
        emailVerified: owner.emailVerified,
        billing: owner.billing,
      }
      return next()
    }

    const user = await User.findById(decoded.userId)
      .select('_id name email role emailVerified tokenVersion billing')
      .lean()

    if (!user) {
      return res.status(401).json({ message: 'Invalid token' })
    }

    const tokenVersion = Number(decoded?.tokenVersion || 0)
    const currentTokenVersion = Number(user?.tokenVersion || 0)
    if (tokenVersion !== currentTokenVersion) {
      return res.status(401).json({ message: 'Session expired. Please log in again.' })
    }

    req.user = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      billing: user.billing,
    }
    next()
  } catch {
    return res.status(401).json({ message: 'Unauthorized' })
  }
}
