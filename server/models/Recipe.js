import mongoose from 'mongoose'

const recipeIngredientSchema = new mongoose.Schema(
  {
    sourceType: {
      type: String,
      enum: ['inventory', 'menu'],
      default: 'inventory',
      required: true,
    },
    inventoryItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryItem',
      default: null,
      validate: {
        validator(value) {
          if (String(this.sourceType || 'inventory') === 'menu') return true
          return Boolean(value)
        },
        message: 'inventoryItemId is required when sourceType is inventory',
      },
    },
    menuItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MenuItem',
      default: null,
      validate: {
        validator(value) {
          if (String(this.sourceType || 'inventory') === 'inventory') return true
          return Boolean(value)
        },
        message: 'menuItemId is required when sourceType is menu',
      },
    },
    quantity: { type: Number, required: true, min: 0.000001 },
    unit: {
      type: String,
      enum: ['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet', 'g', 'ml', 'unit'],
      required: true,
    },
  },
  { _id: false },
)

const recipeSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true, index: true },
    ingredients: { type: [recipeIngredientSchema], default: [] },
    version: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true },
)

recipeSchema.index({ restaurantId: 1, menuItemId: 1 }, { unique: true })

export default mongoose.model('Recipe', recipeSchema)
