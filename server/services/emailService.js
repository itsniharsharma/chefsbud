import nodemailer from 'nodemailer'

let transport

function parseFromAddress(value) {
  const input = String(value || '').trim()
  const match = input.match(/^(.*)<([^>]+)>$/)

  if (!match) {
    return {
      name: '',
      email: input,
      formatted: input,
    }
  }

  const name = String(match[1] || '').trim().replace(/^"|"$/g, '')
  const email = String(match[2] || '').trim()

  return {
    name,
    email,
    formatted: name ? `${name} <${email}>` : email,
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getMailProvider() {
  const explicitProvider = String(process.env.MAIL_PROVIDER || '').trim().toLowerCase()
  if (explicitProvider) return explicitProvider

  if (String(process.env.MAILTRAP_API_TOKEN || '').trim()) {
    return 'mailtrap_api'
  }

  return 'smtp'
}

function getFromAddress() {
  const fallback = process.env.SMTP_FROM || process.env.SMTP_USER || ''
  const parsed = parseFromAddress(fallback)

  if (!parsed.email) {
    const error = new Error('Email sender is not configured. Set SMTP_FROM or SMTP_USER.')
    error.statusCode = 500
    throw error
  }

  return parsed
}

function getTransport() {
  if (transport) return transport

  const host = String(process.env.SMTP_HOST || '').trim()
  const port = Number(process.env.SMTP_PORT || 587)
  const user = String(process.env.SMTP_USER || '').trim()
  const pass = String(process.env.SMTP_PASS || '').trim()

  if (!host || !user || !pass) {
    const error = new Error('Email service is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS.')
    error.statusCode = 500
    throw error
  }

  transport = nodemailer.createTransport({
    host,
    port,
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: {
      user,
      pass,
    },
    requireTLS: String(process.env.SMTP_REQUIRE_TLS || 'true').toLowerCase() !== 'false',
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10_000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10_000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 20_000),
  })

  return transport
}

async function sendWithSmtp(message) {
  const smtpTransport = getTransport()

  await smtpTransport.sendMail({
    from: getFromAddress().formatted,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  })
}

async function sendWithMailtrapApi(message) {
  const token = String(process.env.MAILTRAP_API_TOKEN || '').trim()
  const endpoint = String(process.env.MAILTRAP_API_URL || 'https://send.api.mailtrap.io/api/send').trim()
  const from = getFromAddress()

  if (!token) {
    const error = new Error('MAILTRAP_API_TOKEN is required when MAIL_PROVIDER=mailtrap_api.')
    error.statusCode = 500
    throw error
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Api-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: {
        email: from.email,
        name: from.name || undefined,
      },
      to: [{ email: String(message.to || '').trim() }],
      subject: message.subject,
      text: message.text,
      html: message.html,
      category: message.category || 'transactional',
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    const error = new Error(`Mailtrap API send failed (${response.status}): ${body}`)
    error.statusCode = 502
    throw error
  }
}

async function sendEmail(message) {
  const provider = getMailProvider()

  if (provider === 'mailtrap_api') {
    return sendWithMailtrapApi(message)
  }

  return sendWithSmtp(message)
}

export async function sendRegistrationOtpEmail({ to, code, expiryMinutes }) {
  const subject = "Verify your email - Chef's Bud"
  const currentYear = new Date().getFullYear()
  const text = [
    "Verify your email - Chef's Bud",
    '',
    'Hi there,',
    '',
    "Welcome to Chef's Bud.",
    '',
    'To complete your registration, please use the verification code below:',
    '',
    'Your Verification Code',
    code,
    '',
    `This code is valid for the next ${expiryMinutes} minutes.`,
    '',
    "If you didn't request this, you can safely ignore this email - no action is required.",
    '',
    "Why Chef's Bud?",
    "We help restaurants understand what sells, what doesn't, and how to grow smarter with data-driven insights.",
    '',
    'If you have any questions, feel free to reach out to us at support@chefsbud.com',
    '',
    'Best regards,',
    "Team Chef's Bud",
    'Helping restaurants grow smarter',
    '',
    `Copyright ${currentYear} Chef's Bud. All rights reserved.`,
  ].join('\n')

  const html = `
    <div style="margin:0;padding:24px;background-color:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,0.08);">
        <div style="background:linear-gradient(135deg,#0f172a 0%,#dc2626 100%);padding:28px 32px;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.24em;text-transform:uppercase;font-weight:700;opacity:0.85;">Chef's Bud</div>
          <h1 style="margin:12px 0 8px;font-size:28px;line-height:1.2;font-weight:800;">Verify your email</h1>
          <p style="margin:0;font-size:15px;line-height:1.6;color:rgba(255,255,255,0.88);">
            Complete your registration by entering the verification code below.
          </p>
        </div>

        <div style="padding:32px;">
          <p style="margin:0 0 12px;font-size:16px;line-height:1.7;color:#334155;">Hi there,</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#334155;">
            Welcome to <strong>Chef's Bud</strong> &#128075;
          </p>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#334155;">
            To complete your registration, please use the verification code below:
          </p>

          <div style="margin-bottom:24px;padding:18px 20px;border:1px solid #fecaca;border-radius:16px;background:#fff7ed;">
            <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#b91c1c;">
              Your Verification Code
            </p>
            <div style="font-size:34px;line-height:1;font-weight:800;letter-spacing:10px;color:#111827;">
              ${code}
            </div>
          </div>

          <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#334155;">
            This code is valid for the next <strong>${expiryMinutes} minutes</strong>.
          </p>

          <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#334155;">
            If you didn't request this, you can safely ignore this email - no action is required.
          </p>

          <div style="padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
            <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#475569;">
              Why Chef's Bud?
            </p>
            <p style="margin:0;font-size:13px;line-height:1.7;color:#475569;">
              We help restaurants understand what sells, what doesn't, and how to grow smarter with data-driven insights.
            </p>
          </div>

          <p style="margin:20px 0 0;font-size:14px;line-height:1.7;color:#334155;">
            If you have any questions, feel free to reach out to us at
            <a href="mailto:support@chefsbud.com" style="color:#dc2626;text-decoration:none;">support@chefsbud.com</a>
          </p>
        </div>

        <div style="padding:18px 32px;border-top:1px solid #e2e8f0;background:#f8fafc;">
          <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#334155;font-weight:700;">
            Best regards,<br />
            Team Chef's Bud
          </p>
          <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#64748b;">
            Helping restaurants grow smarter
          </p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">
            &copy; ${currentYear} Chef's Bud. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  `

  await sendEmail({
    to,
    subject,
    text,
    html,
    category: 'otp',
  })
}

export async function sendBillingStatusEmail({ to, name, status, planType, graceEndsAt, currentPeriodEnd }) {
  const statusLabels = {
    active: 'Active',
    grace_period: 'Grace Period',
    past_due: 'Payment Pending',
    cancelled: 'Cancelled',
  }

  const displayStatus = statusLabels[status] || String(status || 'Updated')
  const expiryDate = graceEndsAt || currentPeriodEnd
  const expiryText = expiryDate ? new Date(expiryDate).toLocaleString('en-IN', { hour12: true }) : 'N/A'
  const planText = planType === 'hybrid' ? 'Hybrid (Auto-Pay)' : 'Lifetime'
  const subject = `Chef's Bud billing update: ${displayStatus}`

  const text = [
    `Hi ${name || 'there'},`,
    '',
    `Your billing status is now: ${displayStatus}`,
    `Plan: ${planText}`,
    `Access valid until: ${expiryText}`,
    '',
    'If this change was unexpected, please contact support immediately.',
  ].join('\n')

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #0f172a;">
      <h2 style="margin-bottom: 8px;">Billing status updated</h2>
      <p style="margin: 0 0 10px;">Hi ${name || 'there'},</p>
      <p style="margin: 0 0 8px;">Your Chef's Bud billing status is now:</p>
      <p style="margin: 0 0 12px; font-size: 20px; font-weight: 700;">${displayStatus}</p>
      <p style="margin: 0 0 6px;">Plan: <strong>${planText}</strong></p>
      <p style="margin: 0 0 6px;">Access valid until: <strong>${expiryText}</strong></p>
      <p style="margin-top: 12px; font-size: 12px; color: #475569;">
        If this change was unexpected, contact support and update your payment method.
      </p>
    </div>
  `

  await sendEmail({
    to,
    subject,
    text,
    html,
    category: 'billing-status',
  })
}

export async function sendKotReprintAuditEmail({
  to,
  restaurantName,
  orderId,
  tableNumber,
  floorNumber,
  actorName,
  actorRole,
  reason,
  reprintedAt,
}) {
  const subject = `Chef's Bud KOT reprint alert: ${orderId}`
  const whenText = reprintedAt
    ? new Date(reprintedAt).toLocaleString('en-IN', { hour12: true })
    : new Date().toLocaleString('en-IN', { hour12: true })

  const text = [
    `Restaurant: ${restaurantName || 'Restaurant'}`,
    `Order ID: ${orderId}`,
    `Table: ${tableNumber || 'N/A'}`,
    `Floor: ${floorNumber || 'N/A'}`,
    `Reprinted by: ${actorName || 'Unknown'} (${actorRole || 'unknown'})`,
    `When: ${whenText}`,
    '',
    'Reason:',
    String(reason || '').trim(),
  ].join('\n')

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a;">
      <h2 style="margin-bottom: 12px;">KOT reprint alert</h2>
      <p style="margin: 0 0 8px;"><strong>Restaurant:</strong> ${restaurantName || 'Restaurant'}</p>
      <p style="margin: 0 0 8px;"><strong>Order ID:</strong> ${orderId}</p>
      <p style="margin: 0 0 8px;"><strong>Table:</strong> ${tableNumber || 'N/A'}</p>
      <p style="margin: 0 0 8px;"><strong>Floor:</strong> ${floorNumber || 'N/A'}</p>
      <p style="margin: 0 0 8px;"><strong>Reprinted by:</strong> ${actorName || 'Unknown'} (${actorRole || 'unknown'})</p>
      <p style="margin: 0 0 16px;"><strong>When:</strong> ${whenText}</p>
      <div style="padding: 14px 16px; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc;">
        <p style="margin: 0 0 8px; font-weight: 700;">Reason</p>
        <p style="margin: 0; white-space: pre-wrap;">${String(reason || '').trim()}</p>
      </div>
    </div>
  `

  await sendEmail({
    to,
    subject,
    text,
    html,
    category: 'kot-reprint-audit',
  })
}

export async function sendDemoBookingEmail({
  fullName,
  phoneNumber,
  restaurantName,
  state,
  city,
  email,
  note,
}) {
  const to = String(process.env.DEMO_BOOKING_EMAIL || 'chefsbudofficial@gmail.com').trim()
  const subject = `Demo Booking Request - ${restaurantName}`
  const bookedAt = new Date().toLocaleString('en-IN', { hour12: true })

  const text = [
    'New Demo Booking Request',
    '',
    `Full Name: ${fullName}`,
    `Phone Number: ${phoneNumber}`,
    `Restaurant Name: ${restaurantName}`,
    `State: ${state}`,
    `City: ${city}`,
    `Email: ${email}`,
    `Booked At: ${bookedAt}`,
    '',
    'Note:',
    String(note || '').trim() || 'N/A',
  ].join('\n')

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a;">
      <h2 style="margin-bottom: 12px;">New Demo Booking Request</h2>
      <p><strong>Full Name:</strong> ${escapeHtml(fullName)}</p>
      <p><strong>Phone Number:</strong> ${escapeHtml(phoneNumber)}</p>
      <p><strong>Restaurant Name:</strong> ${escapeHtml(restaurantName)}</p>
      <p><strong>State:</strong> ${escapeHtml(state)}</p>
      <p><strong>City:</strong> ${escapeHtml(city)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Booked At:</strong> ${escapeHtml(bookedAt)}</p>
      <div style="margin-top: 12px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc;">
        <p style="margin: 0 0 6px;"><strong>Note</strong></p>
        <p style="margin: 0; white-space: pre-wrap;">${escapeHtml(String(note || '').trim() || 'N/A')}</p>
      </div>
    </div>
  `

  await sendEmail({
    to,
    subject,
    text,
    html,
    category: 'demo-booking',
  })
}
