import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
import Redis from 'ioredis'
import pidusage from 'pidusage'

dotenv.config()

const outputPath = process.env.INFRA_SAMPLE_PATH || path.resolve('outputs/infra-samples.jsonl')
const intervalMs = Math.max(1000, Number(process.env.SAMPLE_INTERVAL_MS || 5000))
const mongoUri = String(process.env.MONGO_URI || '').trim()
const mongoDbName = String(process.env.MONGO_DB_NAME || 'chefsbud').trim()
const redisUrl = String(process.env.REDIS_URL || '').trim()
const appPid = Number(process.env.APP_PID || 0)

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
const stream = fs.createWriteStream(outputPath, { flags: 'a' })

let mongoClient = null
let mongoDb = null
let redisClient = null
let timer = null

function writeSample(kind, payload = {}) {
  stream.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      kind,
      ...payload,
    })}\n`,
  )
}

async function setupMongo() {
  if (!mongoUri) return
  mongoClient = new MongoClient(mongoUri, { maxPoolSize: 2 })
  await mongoClient.connect()
  mongoDb = mongoClient.db(mongoDbName)
}

async function setupRedis() {
  if (!redisUrl) return
  redisClient = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  })
  await redisClient.connect()
}

async function sampleMongo() {
  if (!mongoDb) return

  const [serverStatus, stats] = await Promise.all([
    mongoDb.admin().serverStatus(),
    mongoDb.stats(),
  ])

  const opcounters = serverStatus?.opcounters || {}
  const wiredTigerCacheBytes =
    Number(serverStatus?.wiredTiger?.cache?.['bytes currently in the cache'] || 0)

  writeSample('mongo', {
    opcounters: {
      query: Number(opcounters.query || 0),
      insert: Number(opcounters.insert || 0),
      update: Number(opcounters.update || 0),
      delete: Number(opcounters.delete || 0),
      getmore: Number(opcounters.getmore || 0),
      command: Number(opcounters.command || 0),
    },
    connections: Number(serverStatus?.connections?.current || 0),
    residentMb: Number(serverStatus?.mem?.resident || 0),
    wiredTigerCacheBytes,
    dataSizeBytes: Number(stats?.dataSize || 0),
    storageSizeBytes: Number(stats?.storageSize || 0),
  })
}

async function sampleRedis() {
  if (!redisClient) return
  const [memoryInfo, statsInfo] = await Promise.all([
    redisClient.info('memory'),
    redisClient.info('stats'),
  ])
  const memoryMap = Object.fromEntries(
    String(memoryInfo)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes(':'))
      .map((line) => {
        const idx = line.indexOf(':')
        return [line.slice(0, idx), line.slice(idx + 1)]
      }),
  )
  const statsMap = Object.fromEntries(
    String(statsInfo)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes(':'))
      .map((line) => {
        const idx = line.indexOf(':')
        return [line.slice(0, idx), line.slice(idx + 1)]
      }),
  )

  writeSample('redis', {
    usedMemoryBytes: Number(memoryMap.used_memory || 0),
    usedMemoryPeakBytes: Number(memoryMap.used_memory_peak || 0),
    usedMemoryRssBytes: Number(memoryMap.used_memory_rss || 0),
    memFragmentationRatio: Number(memoryMap.mem_fragmentation_ratio || 0),
    keyspaceHits: Number(statsMap.keyspace_hits || 0),
    keyspaceMisses: Number(statsMap.keyspace_misses || 0),
    instantaneousOpsPerSec: Number(statsMap.instantaneous_ops_per_sec || 0),
  })
}

async function sampleNodeProcess() {
  if (!appPid || Number.isNaN(appPid)) return
  const stat = await pidusage(appPid)
  writeSample('node', {
    pid: appPid,
    cpuPercent: Number(stat?.cpu || 0),
    memoryBytes: Number(stat?.memory || 0),
    elapsedMs: Number(stat?.elapsed || 0),
  })
}

async function collectOnce() {
  try {
    await Promise.all([sampleMongo(), sampleRedis(), sampleNodeProcess()])
  } catch (error) {
    writeSample('error', { message: error?.message || 'sample_error' })
  }
}

async function shutdown() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }

  await Promise.allSettled([
    mongoClient?.close?.(),
    redisClient?.quit?.(),
  ])

  stream.end()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

async function start() {
  writeSample('meta', {
    message: 'infra sampler started',
    intervalMs,
    hasMongo: Boolean(mongoUri),
    hasRedis: Boolean(redisUrl),
    hasPid: Boolean(appPid),
  })

  await Promise.allSettled([setupMongo(), setupRedis()])
  await collectOnce()
  timer = setInterval(() => {
    void collectOnce()
  }, intervalMs)
}

void start()
