import { logger } from '../utils/logger.js'

/**
 * Circuit breaker implementation for fault tolerance
 * Prevents cascading failures by stopping calls to failing services
 *
 * States: CLOSED (normal) -> OPEN (failing) -> HALF_OPEN (testing) -> CLOSED
 */

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name
    this.failureThreshold = options.failureThreshold || 5 // Failures before opening
    this.successThreshold = options.successThreshold || 2 // Successes in HALF_OPEN to close
    this.timeout = options.timeout || 60000 // Milliseconds before retry in HALF_OPEN
    this.onOpen = options.onOpen || null
    this.onClose = options.onClose || null

    this.state = 'CLOSED'
    this.failureCount = 0
    this.successCount = 0
    this.nextAttempt = Date.now()
    this.lastError = null
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error(
          `CircuitBreaker ${this.name} is OPEN. Failing fast. Retrying in ${Math.ceil((this.nextAttempt - Date.now()) / 1000)}s`,
        )
      }
      // Try to transition to HALF_OPEN
      this.state = 'HALF_OPEN'
      this.successCount = 0
    }

    try {
      const result = await operation()

      if (this.state === 'HALF_OPEN') {
        this.successCount++
        if (this.successCount >= this.successThreshold) {
          this.close()
        }
      } else {
        // CLOSED state - success
        this.recordSuccess()
      }

      return result
    } catch (error) {
      this.recordFailure(error)
      throw error
    }
  }

  /**
   * Record successful operation
   */
  recordSuccess() {
    this.failureCount = 0
    this.lastError = null
  }

  /**
   * Record failed operation
   */
  recordFailure(error) {
    this.failureCount++
    this.lastError = error
    this.successCount = 0

    logger.warn('circuit_breaker_failure', {
      name: this.name,
      failureCount: this.failureCount,
      threshold: this.failureThreshold,
      error: error.message,
    })

    if (this.failureCount >= this.failureThreshold && this.state === 'CLOSED') {
      this.open()
    }
  }

  /**
   * Transition to OPEN state
   */
  open() {
    this.state = 'OPEN'
    this.nextAttempt = Date.now() + this.timeout

    logger.error('circuit_breaker_opened', {
      name: this.name,
      retryAfterMs: this.timeout,
      lastError: this.lastError?.message,
    })

    if (this.onOpen) {
      this.onOpen()
    }
  }

  /**
   * Transition to CLOSED state
   */
  close() {
    this.state = 'CLOSED'
    this.failureCount = 0
    this.successCount = 0

    logger.info('circuit_breaker_closed', { name: this.name })

    if (this.onClose) {
      this.onClose()
    }
  }

  /**
   * Get circuit breaker status
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastError: this.lastError?.message || null,
      nextAttempt: this.state === 'OPEN' ? new Date(this.nextAttempt) : null,
    }
  }

  /**
   * Force reset to CLOSED
   */
  reset() {
    this.state = 'CLOSED'
    this.failureCount = 0
    this.successCount = 0
    this.lastError = null
    logger.info('circuit_breaker_reset', { name: this.name })
  }
}

// Registry of circuit breakers
const breakers = new Map()

/**
 * Get or create a circuit breaker
 */
export function getOrCreateCircuitBreaker(name, options = {}) {
  if (!breakers.has(name)) {
    breakers.set(name, new CircuitBreaker(name, options))
  }
  return breakers.get(name)
}

/**
 * Get all circuit breakers status
 */
export function getAllCircuitBreakerStatus() {
  const statuses = {}
  for (const [name, breaker] of breakers.entries()) {
    statuses[name] = breaker.getStatus()
  }
  return statuses
}

/**
 * Reset specific circuit breaker
 */
export function resetCircuitBreaker(name) {
  const breaker = breakers.get(name)
  if (breaker) {
    breaker.reset()
  }
}

/**
 * Reset all circuit breakers
 */
export function resetAllCircuitBreakers() {
  for (const breaker of breakers.values()) {
    breaker.reset()
  }
}

export default CircuitBreaker
