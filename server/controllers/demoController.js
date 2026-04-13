import { enqueueDemoBookingEmailJob } from '../services/orderOutboxService.js'

export async function bookDemo(req, res, next) {
  try {
    const {
      fullName,
      phoneNumber,
      restaurantName,
      state,
      city,
      email,
      note = '',
    } = req.body

    await enqueueDemoBookingEmailJob({
      fullName,
      phoneNumber,
      restaurantName,
      state,
      city,
      email,
      note,
      eventKey: `EMAIL_DEMO_BOOKING:${String(email || '').trim().toLowerCase()}:${Date.now()}`,
    })

    return res.status(201).json({
      success: true,
      message: 'Demo request submitted successfully. Our team will contact you soon.',
    })
  } catch (error) {
    next(error)
  }
}
