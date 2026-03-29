import mongoose from 'mongoose'

const recipeVersionIngredientSchema = new mongoose.Schema(
  {
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    quantity: { type: Number, required: true, min: 0.000001 },
    unit: { type: String, enum: ['g', 'ml', 'unit'], required: true },
  },
  { _id: false },
)

const recipeVersionSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true, index: true },
    version: { type: Number, required: true, min: 1 },
    ingredients: { type: [recipeVersionIngredientSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

recipeVersionSchema.index({ restaurantId: 1, menuItemId: 1, version: 1 }, { unique: true })

export default mongoose.model('RecipeVersion', recipeVersionSchema)
