import mongoose from 'mongoose'

const inventoryRollupJobStateSchema = new mongoose.Schema(
  {
    jobType: {
      type: String,
      enum: ['inventory_daily_rollup', 'inventory_monthly_rollup', 'inventory_monthly_archive'],
      required: true,
      index: true,
    },
    windowKey: { type: String, required: true, trim: true },
    status: { type: String, enum: ['processing', 'completed', 'failed'], required: true, index: true },
    startedAt: { type: Date, required: true, index: true },
    completedAt: { type: Date, default: null, index: true },
    rowCount: { type: Number, default: 0, min: 0 },
    checksum: { type: String, default: '', trim: true, maxlength: 120 },
    errorMessage: { type: String, default: '', trim: true, maxlength: 1000 },
    // Phase 1 hardening fields
    runId: { type: String, default: '', trim: true, maxlength: 100, index: true },
    retryCount: { type: Number, default: 0, min: 0, max: 10 },
    lockOwner: { type: String, default: '', trim: true, maxlength: 100 },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
)

inventoryRollupJobStateSchema.index({ jobType: 1, windowKey: 1 }, { unique: true })
inventoryRollupJobStateSchema.index({ jobType: 1, startedAt: -1 })

export default mongoose.model('InventoryRollupJobState', inventoryRollupJobStateSchema)
