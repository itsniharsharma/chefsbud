import InventoryLedger from '../models/InventoryLedger.js'
import { getInventoryRuntimeConfig } from '../config/inventoryRuntime.js'
import { logger } from '../utils/logger.js'
import { validateInventoryConsistency } from './inventoryValidation.js'
import { runLifecycleIndexMaintenance } from './lifecycleIndexMaintenance.js'

const EXPECTED_INVENTORY_LEDGER_CYCLE_INDEX = {
  restaurantId: 1,
  referenceType: 1,
  referenceId: 1,
  direction: 1,
  type: 1,
  'metadata.cycle': 1,
}

function hasExactKeyPattern(candidate = {}, expected = {}) {
  const candidateEntries = Object.entries(candidate)
  const expectedEntries = Object.entries(expected)

  if (candidateEntries.length !== expectedEntries.length) return false

  for (let index = 0; index < expectedEntries.length; index += 1) {
    const [expectedKey, expectedValue] = expectedEntries[index]
    const [candidateKey, candidateValue] = candidateEntries[index] || []
    if (candidateKey !== expectedKey) return false
    if (Number(candidateValue) !== Number(expectedValue)) return false
  }

  return true
}

async function verifyInventoryLedgerIndexes() {
  const indexes = await InventoryLedger.collection.indexes()
  const hasCycleIndex = indexes.some((index) =>
    hasExactKeyPattern(index?.key || {}, EXPECTED_INVENTORY_LEDGER_CYCLE_INDEX),
  )

  if (hasCycleIndex) {
    logger.info('startup_check_inventory_ledger_cycle_index_ready', {
      collection: InventoryLedger.collection.collectionName,
    })
    return
  }

  logger.warn('startup_check_inventory_ledger_cycle_index_missing', {
    collection: InventoryLedger.collection.collectionName,
    expectedKey: EXPECTED_INVENTORY_LEDGER_CYCLE_INDEX,
    note: 'Deploy can proceed, but monitor index build rollout to avoid slower reverse-consumption queries.',
  })
}

function verifyInventoryRuntimeConfig() {
  const config = getInventoryRuntimeConfig()

  logger.info('startup_check_inventory_runtime_config', {
    rolloutMode: config.rolloutMode,
    strictPolicy: config.strictPolicy,
    allowLegacyFallback: config.allowLegacyFallback,
    blockOrderCompletionOnInventoryFailure: config.blockOrderCompletionOnInventoryFailure,
    allowClientPolicyOverride: config.allowClientPolicyOverride,
    enableReservationsOnOrderCreate: config.enableReservationsOnOrderCreate,
  })

  if (config.rolloutMode === 'enforced' && config.allowLegacyFallback) {
    logger.warn('startup_check_inventory_runtime_config_inconsistent', {
      note: 'enforced rollout with legacy fallback can hide policy failures; consider disabling INVENTORY_ALLOW_LEGACY_FALLBACK',
    })
  }
}

export async function runStartupChecks() {
  try {
    verifyInventoryRuntimeConfig()
    await verifyInventoryLedgerIndexes()
    await runLifecycleIndexMaintenance()
    
    // Run inventory consistency validation (non-blocking)
    try {
      const validationResults = await validateInventoryConsistency()
      if (validationResults.error) {
        logger.error('startup_inventory_validation_errors', { results: validationResults })
      }
    } catch (error) {
      logger.warn('startup_inventory_validation_failed', {
        message: error?.message || 'inventory validation check failed',
      })
    }
  } catch (error) {
    logger.warn('startup_checks_failed', {
      message: error?.message || 'unknown startup check failure',
    })
  }
}
