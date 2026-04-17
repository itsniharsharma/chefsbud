import { isRedisConfigured } from './redis/cacheRedis.js'
import { isBlockingRedisConfigured } from './redis/queueRedis.js'
import { buildRedisTelemetry } from './redis/telemetry.js'

export function getRedisTelemetry({ top = 20 } = {}) {
  return buildRedisTelemetry({
    top,
    configured: isRedisConfigured(),
    blockingConfigured: isBlockingRedisConfigured(),
  })
}

