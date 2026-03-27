import mongoose from 'mongoose'
import { logger } from '../utils/logger.js'
import { performanceMetrics } from '../services/performanceMetrics.js'

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

export async function connectDB() {
  const mongoUri = process.env.MONGO_URI
  if (!mongoUri) {
    throw new Error('MONGO_URI is required in environment variables')
  }

  await mongoose.connect(mongoUri, {
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 15),
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 0),
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 8000),
    socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000),
    monitorCommands: performanceMetrics.isEnabled,
  })
  attachMongoCommandMetrics()
  logger.info('mongodb_connected')
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
