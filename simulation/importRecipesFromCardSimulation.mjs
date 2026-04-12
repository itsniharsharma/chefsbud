import 'dotenv/config'
import mongoose from 'mongoose'
import User from '../server/models/User.js'
import Restaurant from '../server/models/Restaurant.js'
import MenuItem from '../server/models/MenuItem.js'
import InventoryItem from '../server/models/InventoryItem.js'
import Recipe from '../server/models/Recipe.js'
import RecipeVersion from '../server/models/RecipeVersion.js'

const emailArg = process.argv.find((arg) => arg.startsWith('--email=')) || ''
const ownerEmail = (emailArg.split('=')[1] || 'itsniharsharmas@gmail.com').trim().toLowerCase()
const dryRun = process.argv.includes('--dry-run')

const SIZE_MULTIPLIERS = {
  Small: 0.8,
  Regular: 1,
  Medium: 1.2,
  Large: 1.4,
  XLarge: 1.7,
}

// Generic/base names from card data mapped to concrete menu entries present in the imported menu.
const MENU_NAME_ALIASES = {
  'Wrap Base': 'Paneer Wrap',
  'Grilled Sandwich': 'Grilled Paneer Sandwich',
  'Garlic Bread': 'Plain Garlic Bread',
  'Veg Momos': 'Veg Momos Fry/Steam (10pc)',
  'Paneer Sub': 'Paneer Patty Sub',
}

const INGREDIENT_NAME_ALIASES = {
  'Flavour Syrups': 'Flavour Syrups (Strawberry, Mango, Vanilla)',
}

const FLAVOR_VARIANT_RECIPES_TO_SKIP = new Set(['Mojito Base', 'Ice Cream Base'])

const RECIPE_DEFINITIONS = [
  {
    menuItem: 'Snapy Pizza',
    category: 'Pizza',
    ingredients: [
      { item: 'Pizza Base (Ready)', quantity: 1, unit: 'Unit' },
      { item: 'Pizza Sauce', quantity: 80, unit: 'Gram' },
      { item: 'Mozzarella Cheese', quantity: 120, unit: 'Gram' },
      { item: 'Capsicum', quantity: 40, unit: 'Gram' },
      { item: 'Onion', quantity: 40, unit: 'Gram' },
      { item: 'Jalapeno', quantity: 20, unit: 'Gram' },
      { item: 'Oregano', quantity: 2, unit: 'Gram' },
      { item: 'Red Chilli Flakes', quantity: 2, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Kadhai Paneer Pizza',
    category: 'Pizza',
    ingredients: [
      { item: 'Pizza Base (Ready)', quantity: 1, unit: 'Unit' },
      { item: 'Pizza Sauce', quantity: 80, unit: 'Gram' },
      { item: 'Mozzarella Cheese', quantity: 100, unit: 'Gram' },
      { item: 'Paneer', quantity: 80, unit: 'Gram' },
      { item: 'Capsicum', quantity: 40, unit: 'Gram' },
      { item: 'Onion', quantity: 40, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Margherita Pizza',
    category: 'Pizza',
    ingredients: [
      { item: 'Pizza Base (Ready)', quantity: 1, unit: 'Unit' },
      { item: 'Pizza Sauce', quantity: 80, unit: 'Gram' },
      { item: 'Mozzarella Cheese', quantity: 150, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Bingo Chips Pizza',
    category: 'Pizza',
    ingredients: [
      { item: 'Pizza Base (Ready)', quantity: 1, unit: 'Unit' },
      { item: 'Pizza Sauce', quantity: 80, unit: 'Gram' },
      { item: 'Mozzarella Cheese', quantity: 100, unit: 'Gram' },
      { item: 'Onion', quantity: 30, unit: 'Gram' },
      { item: 'Tomato', quantity: 30, unit: 'Gram' },
      { item: 'Mushroom', quantity: 40, unit: 'Gram' },
      { item: 'Black Olives', quantity: 20, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Farm House Pizza',
    category: 'Pizza',
    ingredients: [
      { item: 'Pizza Base (Ready)', quantity: 1, unit: 'Unit' },
      { item: 'Pizza Sauce', quantity: 80, unit: 'Gram' },
      { item: 'Mozzarella Cheese', quantity: 150, unit: 'Gram' },
      { item: 'Onion', quantity: 40, unit: 'Gram' },
      { item: 'Capsicum', quantity: 40, unit: 'Gram' },
      { item: 'Tomato', quantity: 40, unit: 'Gram' },
      { item: 'Sweet Corn', quantity: 40, unit: 'Gram' },
      { item: 'Mushroom', quantity: 40, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Paneer Tikka Pizza',
    category: 'Pizza',
    ingredients: [
      { item: 'Pizza Base (Ready)', quantity: 1, unit: 'Unit' },
      { item: 'Pizza Sauce', quantity: 80, unit: 'Gram' },
      { item: 'Mozzarella Cheese', quantity: 120, unit: 'Gram' },
      { item: 'Paneer', quantity: 80, unit: 'Gram' },
      { item: 'Onion', quantity: 40, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Aloo Tikki Burger',
    category: 'Burger',
    ingredients: [
      { item: 'Burger Buns', quantity: 1, unit: 'Unit' },
      { item: 'Aloo Patty', quantity: 1, unit: 'Unit' },
      { item: 'Onion', quantity: 20, unit: 'Gram' },
      { item: 'Tomato', quantity: 20, unit: 'Gram' },
      { item: 'Mayonnaise', quantity: 15, unit: 'Gram' },
      { item: 'Tomato Ketchup', quantity: 10, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Paneer Patty Burger',
    category: 'Burger',
    ingredients: [
      { item: 'Burger Buns', quantity: 1, unit: 'Unit' },
      { item: 'Paneer Patty', quantity: 1, unit: 'Unit' },
      { item: 'Onion', quantity: 20, unit: 'Gram' },
      { item: 'Mayonnaise', quantity: 15, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Golden Fries',
    category: 'Fries',
    ingredients: [
      { item: 'Frozen Fries', quantity: 150, unit: 'Gram' },
      { item: 'Salt', quantity: 2, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Cheese Fries',
    category: 'Fries',
    ingredients: [
      { item: 'Frozen Fries', quantity: 150, unit: 'Gram' },
      { item: 'Cheese Sauce', quantity: 40, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'White Sauce Pasta',
    category: 'Pasta',
    ingredients: [
      { item: 'Pasta Raw', quantity: 100, unit: 'Gram' },
      { item: 'White Sauce Base', quantity: 80, unit: 'Gram' },
      { item: 'Butter', quantity: 10, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Red Sauce Pasta',
    category: 'Pasta',
    ingredients: [
      { item: 'Pasta Raw', quantity: 100, unit: 'Gram' },
      { item: 'Red Sauce Base', quantity: 80, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Masala Maggi',
    category: 'Maggi',
    ingredients: [{ item: 'Maggi Noodles', quantity: 1, unit: 'Packet' }],
  },
  {
    menuItem: 'Wrap Base',
    category: 'Wrap',
    ingredients: [
      { item: 'Tortilla Wraps', quantity: 1, unit: 'Unit' },
      { item: 'Onion', quantity: 20, unit: 'Gram' },
      { item: 'Capsicum', quantity: 20, unit: 'Gram' },
      { item: 'Mayonnaise', quantity: 15, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Grilled Sandwich',
    category: 'Sandwich',
    ingredients: [
      { item: 'Bread Loaf', quantity: 2, unit: 'Unit' },
      { item: 'Butter', quantity: 10, unit: 'Gram' },
      { item: 'Onion', quantity: 20, unit: 'Gram' },
      { item: 'Tomato', quantity: 20, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Green Salad',
    category: 'Salad',
    ingredients: [
      { item: 'Lettuce', quantity: 50, unit: 'Gram' },
      { item: 'Onion', quantity: 20, unit: 'Gram' },
      { item: 'Tomato', quantity: 20, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Garlic Bread',
    category: 'Garlic Bread',
    ingredients: [
      { item: 'Bread Base', quantity: 1, unit: 'Unit' },
      { item: 'Garlic Butter', quantity: 30, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Veg Momos',
    category: 'Momos',
    ingredients: [
      { item: 'Momos Dough', quantity: 100, unit: 'Gram' },
      { item: 'Onion', quantity: 30, unit: 'Gram' },
      { item: 'Capsicum', quantity: 30, unit: 'Gram' },
      { item: 'Schezwan Sauce', quantity: 20, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Cold Coffee',
    category: 'Beverages',
    ingredients: [
      { item: 'Milk', quantity: 200, unit: 'Ml' },
      { item: 'Coffee Powder', quantity: 10, unit: 'Gram' },
      { item: 'Sugar', quantity: 15, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Mojito Base',
    category: 'Beverages',
    ingredients: [{ item: 'Soft Drink Syrup', quantity: 100, unit: 'Ml' }],
  },
  {
    menuItem: 'Cold Drink',
    category: 'Beverages',
    ingredients: [{ item: 'Packaged Cold Drinks', quantity: 1, unit: 'Unit' }],
  },
  {
    menuItem: 'Ice Cream Base',
    category: 'Ice Cream',
    ingredients: [
      { item: 'Ice Cream Base', quantity: 120, unit: 'Ml' },
      { item: 'Flavour Syrups', quantity: 20, unit: 'Ml' },
    ],
  },
  {
    menuItem: 'Aloo Patty Sub',
    category: 'Sub',
    ingredients: [
      { item: 'Sub Bread (6 inch)', quantity: 1, unit: 'Unit' },
      { item: 'Aloo Patty', quantity: 1, unit: 'Unit' },
      { item: 'Onion', quantity: 20, unit: 'Gram' },
    ],
  },
  {
    menuItem: 'Paneer Sub',
    category: 'Sub',
    ingredients: [
      { item: 'Sub Bread (6 inch)', quantity: 1, unit: 'Unit' },
      { item: 'Paneer Patty', quantity: 1, unit: 'Unit' },
      { item: 'Onion', quantity: 20, unit: 'Gram' },
    ],
  },
]

function normalizeName(value = '') {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function unitToBase(quantity, unit) {
  const q = Number(quantity || 0)
  const normalized = String(unit || '').trim().toLowerCase()
  if (!Number.isFinite(q) || q <= 0) return { quantity: 0, unit: 'unit' }

  if (normalized === 'kg') return { quantity: q * 1000, unit: 'g' }
  if (normalized === 'gram' || normalized === 'g') return { quantity: q, unit: 'g' }
  if (normalized === 'litre' || normalized === 'liter') return { quantity: q * 1000, unit: 'ml' }
  if (normalized === 'ml') return { quantity: q, unit: 'ml' }
  return { quantity: q, unit: 'unit' }
}

function pickRepresentativeMenu(menuItems = []) {
  const preferredOrder = ['regular', 'medium', 'small', 'large', 'xlarge']
  const bySize = new Map(menuItems.map((row) => [String(row.portionSize || ''), row]))
  for (const size of preferredOrder) {
    if (bySize.has(size)) return bySize.get(size)
  }
  return menuItems[0] || null
}

function stableRecipeSignature(ingredients = []) {
  return JSON.stringify(
    ingredients
      .map((row) => ({
        inventoryItemId: String(row.inventoryItemId),
        quantity: Number(row.quantity),
        unit: String(row.unit),
      }))
      .sort((a, b) => {
        const idComp = a.inventoryItemId.localeCompare(b.inventoryItemId)
        if (idComp !== 0) return idComp
        const unitComp = a.unit.localeCompare(b.unit)
        if (unitComp !== 0) return unitComp
        return a.quantity - b.quantity
      }),
  )
}

async function run() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing in .env')
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 })

  const user = await User.findOne({ email: ownerEmail }).select('_id email role').lean()
  if (!user) throw new Error(`User not found for email: ${ownerEmail}`)

  const restaurant = await Restaurant.findOne({ ownerId: user._id }).select('_id name slug').lean()
  if (!restaurant) throw new Error(`Restaurant not found for owner: ${ownerEmail}`)

  const [menuItems, inventoryItems] = await Promise.all([
    MenuItem.find({ restaurantId: restaurant._id, available: true })
      .select('_id name portionSize')
      .lean(),
    InventoryItem.find({ restaurantId: restaurant._id, isActive: true })
      .select('_id name')
      .lean(),
  ])

  const menuByNormalizedName = new Map()
  for (const item of menuItems) {
    const key = normalizeName(item.name)
    if (!menuByNormalizedName.has(key)) {
      menuByNormalizedName.set(key, [])
    }
    menuByNormalizedName.get(key).push(item)
  }

  const inventoryByNormalizedName = new Map(
    inventoryItems.map((item) => [normalizeName(item.name), item]),
  )

  const recipeInsertReadyDocs = []
  const skippedFlavorVariantRecipes = []
  const unresolvedMenuItems = []
  const unresolvedIngredients = []
  let createdRecipes = 0
  let updatedRecipes = 0
  let unchangedRecipes = 0
  let createdVersions = 0

  for (const recipeDef of RECIPE_DEFINITIONS) {
    if (FLAVOR_VARIANT_RECIPES_TO_SKIP.has(recipeDef.menuItem)) {
      skippedFlavorVariantRecipes.push(recipeDef.menuItem)
      continue
    }

    const menuLookupName = MENU_NAME_ALIASES[recipeDef.menuItem] || recipeDef.menuItem
    const normalizedMenuName = normalizeName(menuLookupName)
    const candidateMenuRows = menuByNormalizedName.get(normalizedMenuName) || []
    const menuItem = pickRepresentativeMenu(candidateMenuRows)

    if (!menuItem) {
      unresolvedMenuItems.push({ requested: recipeDef.menuItem, lookedUpAs: menuLookupName })
      continue
    }

    const ingredientRows = []
    let hasMissingIngredient = false

    for (const row of recipeDef.ingredients) {
      const ingredientLookupName = INGREDIENT_NAME_ALIASES[row.item] || row.item
      const inventoryItem = inventoryByNormalizedName.get(normalizeName(ingredientLookupName))

      if (!inventoryItem) {
        unresolvedIngredients.push({ recipe: recipeDef.menuItem, ingredient: row.item, lookedUpAs: ingredientLookupName })
        hasMissingIngredient = true
        continue
      }

      ingredientRows.push({
        inventoryItemId: inventoryItem._id,
        quantity: Number(row.quantity),
        unit: String(row.unit),
      })
    }

    if (hasMissingIngredient) {
      continue
    }

    recipeInsertReadyDocs.push({
      menuItem: recipeDef.menuItem,
      category: recipeDef.category,
      ingredients: recipeDef.ingredients.map((row) => ({
        item: INGREDIENT_NAME_ALIASES[row.item] || row.item,
        quantity: Number(row.quantity),
        unit: String(row.unit),
      })),
    })

    if (dryRun) {
      continue
    }

    const existingRecipe = await Recipe.findOne({
      restaurantId: restaurant._id,
      menuItemId: menuItem._id,
    })

    if (!existingRecipe) {
      const created = await Recipe.create({
        restaurantId: restaurant._id,
        menuItemId: menuItem._id,
        ingredients: ingredientRows,
        version: 1,
      })

      createdRecipes += 1

      const versionedIngredients = ingredientRows
        .map((ingredient) => {
          const converted = unitToBase(ingredient.quantity, ingredient.unit)
          return {
            inventoryItemId: ingredient.inventoryItemId,
            quantity: converted.quantity,
            unit: converted.unit,
          }
        })
        .filter((ingredient) => ingredient.quantity > 0)

      await RecipeVersion.updateOne(
        {
          restaurantId: restaurant._id,
          menuItemId: menuItem._id,
          version: 1,
        },
        {
          $setOnInsert: {
            restaurantId: restaurant._id,
            menuItemId: menuItem._id,
            version: 1,
            ingredients: versionedIngredients,
            createdBy: user._id,
          },
        },
        { upsert: true },
      )
      createdVersions += 1
      continue
    }

    const previousSignature = stableRecipeSignature(existingRecipe.ingredients || [])
    const nextSignature = stableRecipeSignature(ingredientRows)

    if (previousSignature === nextSignature) {
      unchangedRecipes += 1
      continue
    }

    existingRecipe.ingredients = ingredientRows
    existingRecipe.version = Math.max(1, Number(existingRecipe.version || 1) + 1)
    await existingRecipe.save()
    updatedRecipes += 1

    const versionedIngredients = ingredientRows
      .map((ingredient) => {
        const converted = unitToBase(ingredient.quantity, ingredient.unit)
        return {
          inventoryItemId: ingredient.inventoryItemId,
          quantity: converted.quantity,
          unit: converted.unit,
        }
      })
      .filter((ingredient) => ingredient.quantity > 0)

    await RecipeVersion.updateOne(
      {
        restaurantId: restaurant._id,
        menuItemId: menuItem._id,
        version: Number(existingRecipe.version || 1),
      },
      {
        $setOnInsert: {
          restaurantId: restaurant._id,
          menuItemId: menuItem._id,
          version: Number(existingRecipe.version || 1),
          ingredients: versionedIngredients,
          createdBy: user._id,
        },
      },
      { upsert: true },
    )
    createdVersions += 1
  }

  if (!dryRun) {
    await mongoose.connection.collection('recipe_size_multipliers').updateOne(
      { restaurantId: restaurant._id },
      {
        $set: {
          restaurantId: restaurant._id,
          sizeMultipliers: SIZE_MULTIPLIERS,
          updatedByUserId: user._id,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    )

  }

  console.log(
    JSON.stringify(
      {
        ownerEmail,
        dryRun,
        restaurant: {
          id: String(restaurant._id),
          name: restaurant.name,
          slug: restaurant.slug,
        },
        sizeMultipliersStored: !dryRun,
        summary: {
          recipeDocumentsGenerated: recipeInsertReadyDocs.length,
          createdRecipes,
          updatedRecipes,
          unchangedRecipes,
          createdVersions,
          skippedFlavorVariantRecipes,
          unresolvedMenuItems,
          unresolvedIngredients,
        },
        recipeDocuments: recipeInsertReadyDocs,
      },
      null,
      2,
    ),
  )

  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error?.message || error)
  try {
    await mongoose.disconnect()
  } catch {
    // no-op
  }
  process.exit(1)
})
