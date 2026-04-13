import mongoose from 'mongoose'
import { logger } from '../utils/logger.js'
import { performanceMetrics } from '../services/performanceMetrics.js'

const MONGO_CONNECT_MAX_RETRIES = Math.max(1, Number(process.env.MONGO_CONNECT_MAX_RETRIES || 8))
const MONGO_CONNECT_RETRY_DELAY_MS = Math.max(250, Number(process.env.MONGO_CONNECT_RETRY_DELAY_MS || 1500))
const MONGO_HEARTBEAT_FREQUENCY_MS = Math.max(500, Number(process.env.MONGO_HEARTBEAT_FREQUENCY_MS || 1000))
const MONGO_WAIT_QUEUE_TIMEOUT_MS = Math.max(1000, Number(process.env.MONGO_WAIT_QUEUE_TIMEOUT_MS || 15000))
const MONGO_MAX_IDLE_TIME_MS = Math.max(1000, Number(process.env.MONGO_MAX_IDLE_TIME_MS || 30000))

const mongoCommandStarts = new Map()
const MONGO_COMMAND_TRACKER_MAX_ENTRIES = Math.max(1_000, Number(process.env.MONGO_COMMAND_TRACKER_MAX_ENTRIES || 20_000))
const MONGO_COMMAND_TRACKER_STALE_MS = Math.max(30_000, Number(process.env.MONGO_COMMAND_TRACKER_STALE_MS || 5 * 60 * 1000))
const TRACKED_MONGO_COMMANDS = new Set([
  'find',
  'aggregate',
  'count',
  'countDocuments',
  'distinct',
  'findAndModify',
  'insert',
  'update',
  'delete',
])

function buildMongoCommandTrackKey(event = {}) {
  const requestId = Number(event?.requestId || 0)
  const connectionId = String(event?.connectionId || '')
  return `${connectionId}:${requestId}`
}

function cleanupMongoCommandTracker(nowNs = process.hrtime.bigint()) {
  const staleThresholdNs = BigInt(MONGO_COMMAND_TRACKER_STALE_MS) * 1_000_000n

  for (const [key, value] of mongoCommandStarts.entries()) {
    if (!value?.startedAt) continue
    if (nowNs - value.startedAt > staleThresholdNs) {
      mongoCommandStarts.delete(key)
    }
  }

  while (mongoCommandStarts.size > MONGO_COMMAND_TRACKER_MAX_ENTRIES) {
    const oldestKey = mongoCommandStarts.keys().next().value
    if (!oldestKey) break
    mongoCommandStarts.delete(oldestKey)
  }
}

function extractMongoCollectionName(event = {}) {
  const commandName = String(event?.commandName || '')
  const command = event?.command || {}
  if (!commandName || typeof command !== 'object' || !command) {
    return 'unknown'
  }

  const raw = command?.[commandName]
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim()
  }

  if (typeof command?.collection === 'string' && command.collection.trim()) {
    return command.collection.trim()
  }

  return 'unknown'
}

function buildMongoOperationKey(event = {}) {
  const db = String(event?.databaseName || 'db').trim() || 'db'
  const collection = extractMongoCollectionName(event)
  const commandName = String(event?.commandName || 'unknown').trim() || 'unknown'
  return `${db}.${collection}.${commandName}`
}

function attachMongoCommandMetrics() {
  if (!performanceMetrics.isEnabled) return

  const client = mongoose.connection.getClient?.()
  if (!client) return

  if (client.__chefBudCommandMetricsAttached) {
    return
  }

  client.__chefBudCommandMetricsAttached = true

  client.on('commandStarted', (event) => {
    const commandName = String(event?.commandName || '').trim()
    if (!TRACKED_MONGO_COMMANDS.has(commandName)) return

    const requestId = Number(event?.requestId || 0)
    if (!requestId) return
    const trackerKey = buildMongoCommandTrackKey(event)
    cleanupMongoCommandTracker()

    mongoCommandStarts.set(trackerKey, {
      startedAt: process.hrtime.bigint(),
      operationKey: buildMongoOperationKey(event),
    })
  })

  client.on('commandSucceeded', (event) => {
    const requestId = Number(event?.requestId || 0)
    if (!requestId) return
    const trackerKey = buildMongoCommandTrackKey(event)

    const start = mongoCommandStarts.get(trackerKey)
    if (!start) return
    mongoCommandStarts.delete(trackerKey)

    const durationMs = Number(process.hrtime.bigint() - start.startedAt) / 1_000_000
    performanceMetrics.recordMongo({
      operationKey: start.operationKey,
      durationMs,
      failed: false,
    })
  })

  client.on('commandFailed', (event) => {
    const requestId = Number(event?.requestId || 0)
    if (!requestId) return
    const trackerKey = buildMongoCommandTrackKey(event)

    const start = mongoCommandStarts.get(trackerKey)
    if (!start) return
    mongoCommandStarts.delete(trackerKey)

    const durationMs = Number(process.hrtime.bigint() - start.startedAt) / 1_000_000
    performanceMetrics.recordMongo({
      operationKey: start.operationKey,
      durationMs,
      failed: true,
    })
  })
}

function getReadyStateLabel(readyState) {
  switch (Number(readyState)) {
    case 1:
      return 'connected'
    case 2:
      return 'connecting'
    case 3:
      return 'disconnecting'
    default:
      return 'disconnected'
  }
}

let reconnectInFlight = null
let mongoConnectionListenersAttached = false

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildConnectOptions() {
  return {
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 15),
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 0),
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 8000),
    socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000),
    heartbeatFrequencyMS: MONGO_HEARTBEAT_FREQUENCY_MS,
    waitQueueTimeoutMS: MONGO_WAIT_QUEUE_TIMEOUT_MS,
    maxIdleTimeMS: MONGO_MAX_IDLE_TIME_MS,
    retryWrites: true,
    retryReads: true,
    appName: process.env.MONGO_APP_NAME || 'chefsbud-api',
    monitorCommands: performanceMetrics.isEnabled,
  }
}

export function isMongoStalePrimaryError(error) {
  const message = String(error?.message || '').toLowerCase()
  return (
    message.includes('primary marked stale due to electionid/setversion mismatch')
    || message.includes('mongoserverselectionerror')
  )
}

function attachMongoConnectionListeners() {
  if (mongoConnectionListenersAttached) return

  mongoConnectionListenersAttached = true
  mongoose.connection.on('connected', () => {
    logger.info('mongodb_connection_state', { state: 'connected' })
  })

  mongoose.connection.on('disconnected', () => {
    logger.warn('mongodb_connection_state', { state: 'disconnected' })
  })

  mongoose.connection.on('reconnected', () => {
    logger.info('mongodb_connection_state', { state: 'reconnected' })
  })

  mongoose.connection.on('error', (error) => {
    logger.error('mongodb_connection_error', {
      name: error?.name,
      message: error?.message,
    })

    if (!isMongoStalePrimaryError(error)) {
      return
    }

    void reconnectMongo({ reason: 'stale_primary_selection', sourceError: error })
  })
}

async function reconnectMongo({ reason, sourceError } = {}) {
  if (reconnectInFlight) {
    return reconnectInFlight
  }

  reconnectInFlight = (async () => {
    logger.warn('mongodb_reconnect_started', {
      reason: String(reason || 'unknown'),
      errorName: sourceError?.name,
      errorMessage: sourceError?.message,
      readyState: mongoose.connection.readyState,
    })

    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect()
      }

      await connectWithRetry({ isReconnect: true })
      logger.info('mongodb_reconnect_completed', {
        reason: String(reason || 'unknown'),
      })
    } catch (error) {
      logger.error('mongodb_reconnect_failed', {
        reason: String(reason || 'unknown'),
        message: error?.message,
      })
      throw error
    }
  })()

  try {
    await reconnectInFlight
  } finally {
    reconnectInFlight = null
  }
}

export async function refreshMongoTopology(reason = 'manual_refresh') {
  await reconnectMongo({ reason })
}

async function connectWithRetry({ isReconnect = false } = {}) {
  const mongoUri = process.env.MONGO_URI
  if (!mongoUri) {
    throw new Error('MONGO_URI is required in environment variables')
  }

  let lastError = null
  for (let attempt = 1; attempt <= MONGO_CONNECT_MAX_RETRIES; attempt += 1) {
    try {
      await mongoose.connect(mongoUri, buildConnectOptions())
      attachMongoCommandMetrics()
      attachMongoConnectionListeners()
      logger.info('mongodb_connected', {
        attempt,
        reconnect: Boolean(isReconnect),
      })
      return
    } catch (error) {
      lastError = error
      logger.warn('mongodb_connect_attempt_failed', {
        attempt,
        maxAttempts: MONGO_CONNECT_MAX_RETRIES,
        reconnect: Boolean(isReconnect),
        errorName: error?.name,
        errorMessage: error?.message,
      })

      if (attempt >= MONGO_CONNECT_MAX_RETRIES) {
        break
      }

      const backoffMs = MONGO_CONNECT_RETRY_DELAY_MS * attempt
      await delay(backoffMs)
    }
  }

  throw lastError || new Error('MongoDB connection failed')
}

export async function connectDB() {
  await connectWithRetry({ isReconnect: false })
}

export async function closeDB() {
  if (mongoose.connection.readyState === 0) {
    return
  }

  await mongoose.connection.close()
  logger.info('mongodb_disconnected')
}

export function getDbStatus() {
  return {
    readyState: mongoose.connection.readyState,
    state: getReadyStateLabel(mongoose.connection.readyState),
  }
}
