import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

function getEncryptionKey() {
  const rawKey = String(process.env.PAYMENT_CONFIG_ENCRYPTION_KEY || '').trim()
  if (!rawKey) {
    const error = new Error('PAYMENT_CONFIG_ENCRYPTION_KEY is missing in server environment')
    error.statusCode = 500
    throw error
  }

  return crypto.createHash('sha256').update(rawKey).digest()
}

export function encryptSecret(value) {
  const plaintext = String(value || '')
  if (!plaintext) return ''

  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptSecret(payload) {
  const encoded = String(payload || '').trim()
  if (!encoded) return ''

  const [ivHex, authTagHex, encryptedHex] = encoded.split(':')
  if (!ivHex || !authTagHex || !encryptedHex) {
    const error = new Error('Encrypted secret format is invalid')
    error.statusCode = 500
    throw error
  }

  const key = getEncryptionKey()
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}
