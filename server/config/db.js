import mongoose from 'mongoose'

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
  console.log('MongoDB connected')
}
