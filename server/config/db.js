import mongoose from 'mongoose'
import { logger } from '../utils/logger.js'

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
  })
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
