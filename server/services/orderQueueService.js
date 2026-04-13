import { randomUUID } from 'node:crypto'
import { getRedisClient, isRedisConfigured } from '../config/redis.js'
import { logger } from '../utils/logger.js'
import { syncCompletedOrderAnalytics } from './itemAnalyticsService.js'
import { consumeReservationsForOrder } from './inventoryV2Service.js'

const QUEUE_KEY = 'order:jobs:pending'
const DEAD_LETTER_KEY = 'order:jobs:deadletter'
const BATCH_SIZE = Math.max(1, Number(process.env.ORDER_QUEUE_BATCH_SIZE || 10))
const BATCH_DELAY_MS = Math.max(50, Number(process.env.ORDER_QUEUE_BATCH_DELAY_MS || 250))
const CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.ORDER_QUEUE_CONCURRENCY || 5)))
const MAX_RETRIES = Math.max(1, Number(process.env.ORDER_QUEUE_MAX_RETRIES || 3))
const PROCESSED_JOBS_KEY = 'order:jobs:processed'
const INFLIGHT_JOBS_KEY = 'order:jobs:inflight'
const MAX_QUEUE_SIZE = Math.max(1000, Number(process.env.ORDER_QUEUE_MAX_SIZE || 5000))
const PROCESSED_JOB_TTL_SECONDS = Math.max(3600, Number(process.env.ORDER_QUEUE_PROCESSED_TTL_SECONDS || 86400))
const ENQUEUE_RETRY_MAX_ATTEMPTS = 3
const ENQUEUE_RETRY_DELAY_MS = 100
const INFLIGHT_LOCK_TTL_SECONDS = 300

let queueWorkerRunning = false
let activeWorkers = 0


export async function enqueueOrderJob(job) {
  if (!isRedisConfigured()) {
    logger.error('order_queue_enqueue_failed_redis_not_configured', { jobType: job?.jobType })
    return false
  }

  const redis = getRedisClient()
  if (!redis) {
    logger.error('order_queue_enqueue_failed_redis_unavailable', { jobType: job?.jobType })
    return false
  }

  let lastError = null

  for (let attempt = 1; attempt <= ENQUEUE_RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      // Check queue depth before enqueuing
      const queueLength = await redis.llen(QUEUE_KEY)
      if (queueLength >= MAX_QUEUE_SIZE) {
        logger.error('order_queue_enqueue_rejected_queue_full', {
          jobType: job.jobType,
          queueLength,
          maxSize: MAX_QUEUE_SIZE,
        })
        return false
      }

      const jobData = JSON.stringify({
        ...job,
        jobId: job.jobId || randomUUID(),
        enqueuedAt: new Date().toISOString(),
        attempts: 0,
      })

      await redis.lpush(QUEUE_KEY, jobData)
      logger.info('order_queue_job_enqueued', {
        jobType: job.jobType,
        jobId: job.jobId,
      })
      return true
    } catch (error) {
      lastError = error
      if (attempt < ENQUEUE_RETRY_MAX_ATTEMPTS) {
        await sleep(ENQUEUE_RETRY_DELAY_MS * attempt)
        continue
      }
    }
  }

  logger.error('order_queue_enqueue_failed_all_retries', {
    jobType: job.jobType,
    attempts: ENQUEUE_RETRY_MAX_ATTEMPTS,
    error: lastError?.message,
  })
  return false
}

/**
 * Start queue worker (poll and process jobs)
 */
export async function startOrderQueueWorker() {
  if (queueWorkerRunning) {
    return
  }

  if (!isRedisConfigured()) {
    logger.warn('order_queue_worker_not_started_redis_not_configured')
    return
  }

  queueWorkerRunning = true
  logger.info('order_queue_worker_started', { concurrency: CONCURRENCY })

  const workLoop = async (workerNo) => {
    while (queueWorkerRunning) {
      try {
        // Fetch next batch
        const batch = await fetchJobBatch(BATCH_SIZE)
        if (!batch || batch.length === 0) {
          await sleep(BATCH_DELAY_MS)
          continue
        }

        // Process batch with concurrency control
        activeWorkers += 1
        try {
          await processBatchConcurrent(batch)
        } finally {
          activeWorkers -= 1
        }

        await sleep(BATCH_DELAY_MS)
      } catch (error) {
        logger.error('order_queue_work_loop_error', { error: error?.message, workerNo })
        await sleep(1000)
      }
    }
  }

  for (let i = 0; i < CONCURRENCY; i += 1) {
    void workLoop(i + 1)
  }
}

export async function stopOrderQueueWorker() {
  queueWorkerRunning = false
  logger.info('order_queue_worker_stopped')
}

// ─────────────────────────────────────────────────────────────────

async function fetchJobBatch(limit) {
  try {
    const redis = getRedisClient()
    if (!redis) {
      return []
    }

    const jobs = []

    for (let i = 0; i < limit; i++) {
      const jobData = await redis.rpop(QUEUE_KEY)
      if (!jobData) break

      // JSON parse safety - catch and DLQ corrupted jobs
      let job = null
      try {
        job = JSON.parse(jobData)
      } catch (parseError) {
        logger.error('order_queue_parse_error', {
          error: parseError?.message,
          rawData: jobData.substring(0, 100),
        })
        // Move corrupted job to DLQ
        await redis.lpush(DEAD_LETTER_KEY, JSON.stringify({
          rawData: jobData,
          parseError: parseError?.message,
          failedAt: new Date().toISOString(),
        }))
        continue
      }

      if (job) {
        jobs.push(job)
      }
    }

    if (jobs.length > 0) {
      logger.info('order_queue_batch_fetched', {
        batchSize: jobs.length,
        queueDepth: (await redis.llen(QUEUE_KEY)) || 0,
      })
    }

    return jobs
  } catch (error) {
    logger.error('order_queue_fetch_batch_error', { error: error?.message })
    return []
  }
}

async function processBatchConcurrent(batch) {
  const results = await Promise.allSettled(
    batch.map((job) => processJob(job))
  )

  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length > 0) {
    logger.warn('order_queue_batch_has_failures', {
      totalJobs: batch.length,
      failedJobs: failed.length,
    })
  }
}

async function isJobProcessed(jobId) {
  try {
    const redis = getRedisClient()
    if (!redis) return false
    const processedKey = `${PROCESSED_JOBS_KEY}:${jobId}`
    return Boolean(await redis.exists(processedKey))
  } catch (error) {
    logger.error('order_queue_idempotency_check_failed', { error: error?.message })
    return false
  }
}

async function acquireInflightLock(jobId) {
  try {
    const redis = getRedisClient()
    if (!redis) return false
    const lockKey = `${INFLIGHT_JOBS_KEY}:${jobId}`
    const acquired = await redis.set(lockKey, '1', { nx: true, ex: INFLIGHT_LOCK_TTL_SECONDS })
    return Boolean(acquired)
  } catch (error) {
    logger.error('order_queue_inflight_lock_failed', { error: error?.message, jobId })
    return false
  }
}

async function releaseInflightLock(jobId) {
  try {
    const redis = getRedisClient()
    if (!redis) return
    const lockKey = `${INFLIGHT_JOBS_KEY}:${jobId}`
    await redis.del(lockKey)
  } catch (error) {
    logger.warn('order_queue_inflight_unlock_failed', { error: error?.message, jobId })
  }
}

async function markJobProcessed(jobId) {
  try {
    const redis = getRedisClient()
    if (!redis) {
      throw new Error('redis_unavailable_for_mark_processed')
    }
    const processedKey = `${PROCESSED_JOBS_KEY}:${jobId}`
    await redis.set(processedKey, '1', { ex: PROCESSED_JOB_TTL_SECONDS })
  } catch (error) {
    logger.error('order_queue_mark_processed_failed', { error: error?.message, jobId })
    throw error
  }
}

async function processJob(job) {
  const jobId = job?.jobId || randomUUID()
  let lockAcquired = false

  try {
    const { jobType, jobData } = job

    // Check idempotency - skip if already processed
    const alreadyProcessed = await isJobProcessed(jobId)
    if (alreadyProcessed) {
      logger.info('order_queue_job_skipped_duplicate', { jobId, jobType })
      return
    }

    lockAcquired = await acquireInflightLock(jobId)
    if (!lockAcquired) {
      logger.info('order_queue_job_skipped_inflight', { jobId, jobType })
      return
    }

    // Process job
    switch (jobType) {
      case 'update_inventory':
        await handleInventoryUpdate(jobData)
        break
      case 'track_analytics':
        await handleAnalyticsTracking(jobData)
        break
      case 'notify_order_change':
        await handleOrderNotification(jobData)
        break
      default:
        throw new Error(`Unknown job type: ${jobType}`)
    }

    // Mark as processed
    await markJobProcessed(jobId)

    logger.info('order_queue_job_completed', { jobId, jobType })
  } catch (error) {
    const currentJob = job || {}
    const attempts = (currentJob?.attempts || 0) + 1

    if (attempts >= MAX_RETRIES) {
      // Move to dead letter queue
      await moveToDeadLetter(currentJob, error, attempts)
    } else {
      // Re-enqueue for retry
      await requeueJob(currentJob, attempts)
    }

    throw error
  } finally {
    if (lockAcquired) {
      await releaseInflightLock(jobId)
    }
  }
}

async function requeueJob(job, newAttempts) {
  try {
    const redis = getRedisClient()
    if (!redis) {
      throw new Error('redis_unavailable_for_requeue')
    }
    const retryJob = {
      ...job,
      attempts: newAttempts,
      lastError: 'retrying',
      retryAt: new Date().toISOString(),
    }
    await redis.lpush(QUEUE_KEY, JSON.stringify(retryJob))
    logger.info('order_queue_job_requeued', {
      jobType: job.jobType,
      attempt: newAttempts,
    })
  } catch (error) {
    logger.error('order_queue_requeue_failed', { error: error?.message })
  }
}

async function moveToDeadLetter(job, error, attempts) {
  try {
    const redis = getRedisClient()
    if (!redis) {
      logger.error('order_queue_deadletter_redis_unavailable', {
        jobType: job?.jobType,
        attempts,
        reason: error?.message,
      })
      return
    }
    const dlJob = {
      ...job,
      attempts,
      failedAt: new Date().toISOString(),
      error: error?.message || 'unknown error',
    }
    await redis.lpush(DEAD_LETTER_KEY, JSON.stringify(dlJob))
    logger.warn('order_queue_job_deadlettered', {
      jobType: job.jobType,
      attempts,
      reason: error?.message,
    })
  } catch (error) {
    logger.error('order_queue_deadletter_failed', { error: error?.message })
  }
}

// ─────────────────────────────────────────────────────────────────
// Job handlers (implement as needed)

async function handleInventoryUpdate(jobData) {
  if (!jobData?.orderId || !jobData?.restaurantId) {
    throw new Error('Invalid job data: missing orderId or restaurantId')
  }

  try {
    await consumeReservationsForOrder({
      restaurantId: jobData.restaurantId,
      orderId: jobData.orderId,
      policy: 'soft',
      idempotencyPrefix: `queue_inventory_${jobData.orderId}`,
    })
    logger.info('order_queue_inventory_consumed', {
      orderId: jobData.orderId,
      restaurantId: jobData.restaurantId,
    })
  } catch (error) {
    logger.error('order_queue_inventory_update_failed', {
      orderId: jobData.orderId,
      restaurantId: jobData.restaurantId,
      error: error?.message,
    })
    throw error
  }
}

async function handleAnalyticsTracking(jobData) {
  if (!jobData?.orderId) {
    throw new Error('Invalid job data: missing orderId')
  }

  try {
    await syncCompletedOrderAnalytics(jobData.orderId)
    logger.info('order_queue_analytics_synced', {
      orderId: jobData.orderId,
      restaurantId: jobData.restaurantId,
    })
  } catch (error) {
    logger.error('order_queue_analytics_tracking_failed', {
      orderId: jobData.orderId,
      error: error?.message,
    })
    throw error
  }
}

async function handleOrderNotification(jobData) {
  if (!jobData?.orderId) {
    throw new Error('Invalid job data: missing orderId')
  }

  try {
    // Placeholder for notification service (Twilio SMS, FCM push, etc.)
    // For now, just log - can be extended in Phase 2
    logger.info('order_queue_notification_queued', {
      orderId: jobData.orderId,
      restaurantId: jobData.restaurantId,
      orderStatus: jobData.orderStatus,
    })
    // TODO: Integrate with actual notification service (Twilio, FCM, etc.)
  } catch (error) {
    logger.error('order_queue_notification_failed', {
      orderId: jobData.orderId,
      error: error?.message,
    })
    throw error
  }
}

// ─────────────────────────────────────────────────────────────────

export async function getQueueStats() {
  try {
    const redis = getRedisClient()
    if (!redis) {
      return {
        pendingJobs: 0,
        deadLetterJobs: 0,
        activeWorkers,
        maxConcurrency: CONCURRENCY,
        maxQueueSize: MAX_QUEUE_SIZE,
        queueHealthy: false,
      }
    }
    const pendingCount = (await redis.llen(QUEUE_KEY)) || 0
    const deadLetterCount = (await redis.llen(DEAD_LETTER_KEY)) || 0

    return {
      pendingJobs: pendingCount,
      deadLetterJobs: deadLetterCount,
      activeWorkers,
      maxConcurrency: CONCURRENCY,
      maxQueueSize: MAX_QUEUE_SIZE,
      queueHealthy: pendingCount < MAX_QUEUE_SIZE && deadLetterCount < 100,
    }
  } catch (error) {
    logger.error('order_queue_stats_error', { error: error?.message })
    return {
      pendingJobs: 0,
      deadLetterJobs: 0,
      activeWorkers,
      maxConcurrency: CONCURRENCY,
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
