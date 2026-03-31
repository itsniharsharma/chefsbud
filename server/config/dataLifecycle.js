/**
 * Data Lifecycle Configuration
 * Centralized settings for archive, rollup, and cleanup jobs
 * Environment variables override defaults for production flexibility
 */

function parseBooleanFlag(value, defaultValue = false) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue
  }

  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return defaultValue
}

const archiveEnabledFlag =
  process.env.ARCHIVE_ENABLED !== undefined
    ? process.env.ARCHIVE_ENABLED
    : process.env.ORDER_ARCHIVE_ENABLED
const rollupEnabledFlag = process.env.ROLLUP_ENABLED
const purgeEnabledFlag = process.env.PURGE_ENABLED
const inventoryLifecycleEnabledFlag = process.env.INVENTORY_LEDGER_SUMMARY_ENABLED
const inventoryMonthlyArchiveEnabledFlag = process.env.INVENTORY_MONTHLY_ARCHIVE_ENABLED

const config = {
  // Archive settings: Move orders to Azure after N days
  archive: {
    enabled: parseBooleanFlag(archiveEnabledFlag, false),
    afterDays: parseInt(process.env.ARCHIVE_AFTER_DAYS || '45', 10),
    batchSize: parseInt(process.env.ARCHIVE_BATCH_SIZE || '1000', 10),
    maxRetries: 3,
    retryDelayMs: 5000,
    // Only archive completed orders to avoid issues with ongoing orders
    archiveOnlyStatuses: ['Completed'],
    timeout: 120000, // 2 minutes per batch
  },

  // Purge settings: Remove already-archived orders from Mongo after safety window
  purge: {
    enabled: parseBooleanFlag(purgeEnabledFlag, true),
    deleteAfterArchiveDays: parseInt(process.env.DELETE_AFTER_ARCHIVE_DAYS || '1', 10),
    batchSize: parseInt(process.env.PURGE_BATCH_SIZE || '500', 10),
    dryRun: process.env.DRY_RUN_PURGE === 'true',
    maxDurationMs: parseInt(process.env.PURGE_MAX_DURATION_MS || '120000', 10),
  },

  // Rollup settings: Aggregate daily → monthly after N days
  rollup: {
    enabled: parseBooleanFlag(rollupEnabledFlag, false),
    afterDays: parseInt(process.env.ROLLUP_AFTER_DAYS || '90', 10),
    // Keep only top N basket pairs per restaurant per month (rest are deleted)
    topBasketPairsPerMonth: 100,
    timeout: 180000, // 3 minutes per rollup job
  },

  // Cleanup settings
  cleanup: {
    // Mark daily data as rolledUp and keep for reference (don't delete immediately)
    keepRolledUpDaily: true,
    keepRolledUpDailyFor: parseInt(process.env.DAILY_ANALYTICS_RETENTION_DAYS || '90', 10), // days
    
    // Delete low-frequency data aggressively to prevent unbounded growth
    deleteOrdersMissingAnalytics: true,
    deleteOrdersMissingAnalyticsAfterDays: 365,
    
    // Cleanup old hourly metrics
    hourlyMetricsRetention: 30, // days
    
    // Cleanup old event ingestion (TTL handles this, but explicit cleanup as fallback)
    eventIngestionRetention: 7, // days (matching TTL)
  },

  // Azure Blob Storage settings
  azure: {
    containerName: process.env.AZURE_STORAGE_CONTAINER || 'orders-archive',
    inventoryContainerName: process.env.AZURE_INVENTORY_STORAGE_CONTAINER || 'inventory-archive',
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
    archivePath: 'orders-archive', // Base path in container
    inventoryArchivePath: process.env.AZURE_INVENTORY_ARCHIVE_PATH || 'inventory-monthly-archive',
  },

  // Inventory lifecycle settings
  inventoryLifecycle: {
    enabled: parseBooleanFlag(inventoryLifecycleEnabledFlag, true),
    dailyRollupLookbackDays: parseInt(process.env.INVENTORY_DAILY_ROLLUP_LOOKBACK_DAYS || '3', 10),
    dailySummaryRetentionDays: parseInt(process.env.INVENTORY_DAILY_SUMMARY_RETENTION_DAYS || '90', 10),
    monthlyRebuildWindowMonths: parseInt(process.env.INVENTORY_MONTHLY_REBUILD_WINDOW_MONTHS || '18', 10),
    monthlyArchiveEnabled: parseBooleanFlag(inventoryMonthlyArchiveEnabledFlag, false),
    monthlyArchiveAfterMonths: parseInt(process.env.INVENTORY_MONTHLY_ARCHIVE_AFTER_MONTHS || '12', 10),
    monthlyArchiveBatchSize: parseInt(process.env.INVENTORY_MONTHLY_ARCHIVE_BATCH_SIZE || '5000', 10),
  },

  // Cron schedules (cron format: minute hour day month dayOfWeek)
  schedules: {
    // Run archive job daily at 2 AM (attempts to archive 45+ day old orders)
    archive: process.env.CRON_ARCHIVE || '0 2 * * *',
    
    // Run rollup job daily at 3 AM (rolls up 90+ day old daily metrics to monthly)
    rollup: process.env.CRON_ROLLUP || '0 3 * * *',
    
    // Clean up expired reservations every 15 minutes (TTL index does this, but explicit job as fallback)
    cleanupExpired: process.env.CRON_CLEANUP_EXPIRED || '*/15 * * * *',
    
    // Run cleanup jobs daily at 4 AM
    cleanup: process.env.CRON_CLEANUP || '0 4 * * *',

    // Roll up inventory ledger to daily/monthly summaries once daily.
    inventoryLifecycle: process.env.CRON_INVENTORY_LIFECYCLE || '30 1 * * *',

    // Run purge job every 6 hours
    purge: process.env.CRON_PURGE || '0 */6 * * *',
  },

  // Logging and monitoring
  logging: {
    enabled: true,
    logArchiveDetails: process.env.NODE_ENV === 'development', // Verbose in dev only
    logRollupDetails: process.env.NODE_ENV === 'development',
  },

  // Safety limits
  safety: {
    // Max documents to process in single operation
    maxDocumentsPerOperation: 10000,
    
    // Abort if more than X% of batch fails
    failureThreshold: 10, // percent
    
    // Require manual intervention if > X documents affected per cycle
    auditThreshold: 5000,
  },
}

export default config
