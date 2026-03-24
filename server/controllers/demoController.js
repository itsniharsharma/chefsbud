import { sendDemoBookingEmail } from '../services/emailService.js'

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

    await sendDemoBookingEmail({
      fullName,
      phoneNumber,
      restaurantName,
      state,
      city,
      email,
      note,
    })

    return res.status(201).json({
      success: true,
      message: 'Demo request submitted successfully. Our team will contact you soon.',
    })
  } catch (error) {
    next(error)
  }
}
