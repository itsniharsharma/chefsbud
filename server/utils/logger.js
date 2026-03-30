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

function write(level, message, meta = {}) {
  if (!shouldLog(level)) {
    return
  }

  const normalizedMeta = { ...(meta || {}) }
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

  const line = JSON.stringify(payload)
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
