const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const configuredLevel = String(process.env.LOG_LEVEL || 'info').toLowerCase()
const minLevel = LOG_LEVELS[configuredLevel] || LOG_LEVELS.info

function shouldLog(level) {
  return (LOG_LEVELS[level] || LOG_LEVELS.info) >= minLevel
}

function normalizeValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }

  if (typeof value !== 'object') {
    return value
  }

  if (seen.has(value)) {
    return '[Circular]'
  }

  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item, seen))
  }

  const normalized = {}
  for (const [key, entryValue] of Object.entries(value)) {
    normalized[key] = normalizeValue(entryValue, seen)
  }
  return normalized
}

function write(level, message, meta = {}) {
  if (!shouldLog(level)) {
    return
  }

  const normalizedMeta = normalizeValue(meta || {})
  if (Object.prototype.hasOwnProperty.call(normalizedMeta, 'message')) {
    normalizedMeta.metaMessage = normalizedMeta.message
    delete normalizedMeta.message
  }

  const payload = {
    level,
    time: new Date().toISOString(),
    message,
    ...normalizedMeta,
  }

  let line
  try {
    line = JSON.stringify(payload)
  } catch {
    line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      message,
      metaSerializationError: true,
    })
  }
  if (level === 'error') {
    console.error(line)
    return
  }

  if (level === 'warn') {
    console.warn(line)
    return
  }

  console.log(line)
}

export const logger = {
  debug(message, meta) {
    write('debug', message, meta)
  },
  info(message, meta) {
    write('info', message, meta)
  },
  warn(message, meta) {
    write('warn', message, meta)
  },
  error(message, meta) {
    write('error', message, meta)
  },
}
