const ROLLOUT_MODES = new Set(['off', 'shadow', 'enforced'])
const POLICY_MODES = new Set(['soft', 'hard'])

function asBoolean(value, defaultValue = false) {
  if (value == null) return defaultValue
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return defaultValue
}

function normalizeRolloutMode(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (ROLLOUT_MODES.has(normalized)) {
    return normalized
  }
  return 'shadow'
}

function normalizePolicy(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (POLICY_MODES.has(normalized)) {
    return normalized
  }
  return 'soft'
}

function buildInventoryRuntimeConfig() {
  const rolloutMode = normalizeRolloutMode(process.env.INVENTORY_V2_ROLLOUT_MODE)
  const strictPolicy = normalizePolicy(process.env.INVENTORY_STRICT_POLICY)

  const allowLegacyFallbackDefault = rolloutMode !== 'enforced'
  const allowLegacyFallback = asBoolean(process.env.INVENTORY_ALLOW_LEGACY_FALLBACK, allowLegacyFallbackDefault)

  const blockOrderCompletionDefault = rolloutMode === 'enforced'
  const blockOrderCompletionOnInventoryFailure = asBoolean(
    process.env.INVENTORY_BLOCK_ORDER_COMPLETION_ON_FAILURE,
    blockOrderCompletionDefault,
  )

  return {
    rolloutMode,
    strictPolicy,
    allowLegacyFallback,
    blockOrderCompletionOnInventoryFailure,
    allowClientPolicyOverride: asBoolean(process.env.INVENTORY_ALLOW_CLIENT_POLICY_OVERRIDE, false),
    enableReservationsOnOrderCreate: asBoolean(
      process.env.INVENTORY_ENABLE_RESERVATIONS_ON_ORDER_CREATE,
      rolloutMode !== 'off',
    ),
  }
}

let runtimeConfigCache = buildInventoryRuntimeConfig()

export function getInventoryRuntimeConfig() {
  return runtimeConfigCache
}

export function refreshInventoryRuntimeConfig() {
  runtimeConfigCache = buildInventoryRuntimeConfig()
  return runtimeConfigCache
}

export function resolveInventoryPolicy(requestedPolicy = null) {
  const cfg = getInventoryRuntimeConfig()

  if (cfg.rolloutMode === 'enforced') {
    return cfg.strictPolicy
  }

  if (cfg.allowClientPolicyOverride) {
    const normalizedRequested = normalizePolicy(requestedPolicy)
    if (POLICY_MODES.has(normalizedRequested)) {
      return normalizedRequested
    }
  }

  return 'soft'
}

export function getOrderInventoryBehavior() {
  const cfg = getInventoryRuntimeConfig()

  return {
    mode: cfg.rolloutMode,
    reserveOnCreate: cfg.enableReservationsOnOrderCreate,
    consumptionPolicy: cfg.rolloutMode === 'enforced' ? cfg.strictPolicy : 'soft',
    allowLegacyFallback: cfg.allowLegacyFallback,
    blockOrderCompletionOnInventoryFailure: cfg.blockOrderCompletionOnInventoryFailure,
  }
}

export function isInventoryConstraintError(error) {
  const message = String(error?.message || '').toLowerCase()
  if (!message) return false

  return (
    message.includes('insufficient available stock') ||
    message.includes('reserved stock cannot become negative') ||
    message.includes('unsupported unit conversion')
  )
}
