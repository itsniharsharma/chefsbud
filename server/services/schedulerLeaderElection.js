import { withRedis } from '../config/redis.js'
import { logger } from '../utils/logger.js'

/**
 * Distributed scheduler leader election service
 * Ensures only one process runs background jobs across multiple instances
 * Uses Redis for distributed coordination with TTL-based heartbeat
 */

const SCHEDULER_TYPES = {
  ORDER_ARCHIVE: 'scheduler:leader:order_archive',
  INVENTORY_RECONCILIATION: 'scheduler:leader:inventory_reconciliation',
}

const LEADER_LOCK_TTL_SECONDS = 30
const LEADER_HEARTBEAT_INTERVAL_MS = 20000 // Heartbeat every 20 seconds

let activeLeaderships = new Map() // { schedulerType: { lockValue, refreshTimer } }

/**
 * Attempt to become or maintain leadership for a scheduler
 * Returns true if this process is now the leader
 */
export async function electSchedulerLeader(schedulerType) {
  if (!SCHEDULER_TYPES[schedulerType]) {
    throw new Error(`Unknown scheduler type: ${schedulerType}`)
  }

  const lockKey = SCHEDULER_TYPES[schedulerType]
  const lockValue = `${process.pid}:${Date.now()}:${Math.random()}`

  try {
    // Try to acquire leadership
    const result = await withRedis(
      'scheduler_leader_election_acquire',
      (redis) =>
        redis.set(lockKey, lockValue, {
          nx: true, // Only if missing
          ex: LEADER_LOCK_TTL_SECONDS,
        }),
      '__FALLBACK__',
    )

    if (result === 'OK') {
      // Successfully acquired leadership
      setupLeadershipHeartbeat(schedulerType, lockKey, lockValue)
      logger.info('scheduler_leader_elected', {
        schedulerType,
        processId: process.pid,
      })
      return true
    }

    if (result === '__FALLBACK__') {
      // Redis unavailable, use local only
      logger.warn('scheduler_leader_election_fallback', { schedulerType })
      setupLeadershipHeartbeat(schedulerType, lockKey, lockValue)
      return true
    }

    // Someone else is leader
    return false
  } catch (error) {
    logger.error('scheduler_leader_election_failed', {
      schedulerType,
      error: error.message,
    })
    return false
  }
}

/**
 * Set up periodic heartbeat to maintain leadership
 */
function setupLeadershipHeartbeat(schedulerType, lockKey, lockValue) {
  // Clear any existing heartbeat
  if (activeLeaderships.has(schedulerType)) {
    const { refreshTimer } = activeLeaderships.get(schedulerType)
    clearInterval(refreshTimer)
  }

  // Set up new heartbeat
  const refreshTimer = setInterval(async () => {
    try {
      // Refresh if we still own the lock
      const currentValue = await withRedis(
        'scheduler_leader_check',
        (redis) => redis.get(lockKey),
        null,
      )

      if (currentValue === lockValue) {
        // We still own it, refresh the TTL
        await withRedis(
          'scheduler_leader_refresh',
          (redis) => redis.expire(lockKey, LEADER_LOCK_TTL_SECONDS),
          0,
        )
      } else {
        // Lost leadership
        logger.warn('scheduler_leader_lost', { schedulerType })
        clearInterval(refreshTimer)
        activeLeaderships.delete(schedulerType)
      }
    } catch (error) {
      logger.warn('scheduler_leader_heartbeat_error', {
        schedulerType,
        error: error.message,
      })
    }
  }, LEADER_HEARTBEAT_INTERVAL_MS)

  refreshTimer.unref?.()
  activeLeaderships.set(schedulerType, { lockValue, refreshTimer })
}

/**
 * Release leadership for a scheduler
 */
export async function releaseSchedulerLeadership(schedulerType) {
  const lockKey = SCHEDULER_TYPES[schedulerType]

  // Stop heartbeat
  if (activeLeaderships.has(schedulerType)) {
    const { refreshTimer } = activeLeaderships.get(schedulerType)
    clearInterval(refreshTimer)
    activeLeaderships.delete(schedulerType)
  }

  // Try to delete the lock
  try {
    await withRedis(
      'scheduler_leader_release',
      (redis) => redis.del(lockKey),
      0,
    )
    logger.info('scheduler_leadership_released', { schedulerType })
  } catch (error) {
    logger.warn('scheduler_leader_release_failed', {
      schedulerType,
      error: error.message,
    })
  }
}

/**
 * Check if this process is currently the leader
 */
export function isSchedulerLeader(schedulerType) {
  return activeLeaderships.has(schedulerType)
}

/**
 * Cleanup all leaderships on process shutdown
 */
export async function cleanupAllLeaderships() {
  for (const schedulerType of Object.keys(SCHEDULER_TYPES)) {
    await releaseSchedulerLeadership(schedulerType)
  }
}
