import 'dotenv/config'
import mongoose from 'mongoose'
import User from '../server/models/User.js'
import Restaurant from '../server/models/Restaurant.js'
import Category from '../server/models/Category.js'
import MenuItem from '../server/models/MenuItem.js'

const emailArg = process.argv.find((arg) => arg.startsWith('--email=')) || ''
const ownerEmail = (emailArg.split('=')[1] || 'itsniharsharmas@gmail.com').trim().toLowerCase()

const menuDefinition = [
  {
    category: 'Burger',
    items: [
      { name: 'Cheese Burger', prices: { regular: 100, large: 180 }, bestseller: true },
      { name: 'Paneer Patty Burger', prices: { regular: 100, large: 180 }, bestseller: true, description: 'with Multi Grain Bun' },
      { name: 'Dominator Burger', prices: { regular: 110, large: 180 }, bestseller: true },
      { name: 'Maharaja Burger', prices: { regular: 130, large: 210 }, bestseller: true },
      { name: 'Aloo Tikki Burger', prices: { regular: 55, large: 130 } },
      { name: 'Aloo Tikki Spicy Burger', prices: { regular: 60, large: 140 } },
      { name: 'Baby Burger', prices: { regular: 80, large: 150 } },
      { name: 'Bun Pizza Burger', prices: { regular: 80, large: 150 } },
    ],
  },
  {
    category: 'Sandwich',
    items: [
      { name: 'Hara Bhara Sandwich', price: 140, bestseller: true, description: 'Veg Kabbab, Sweet Corn, Onion, Capsicum' },
      { name: 'Grilled Super Salad Sandwich', price: 130, bestseller: true, description: 'Paneer, Onion, Capsicum, Tomato, Black Olive' },
      { name: 'Grilled Paneer Sandwich', price: 120, bestseller: true, description: 'Paneer, Onion' },
      { name: 'Grilled Pasta Sandwich', price: 120 },
      { name: 'Sweet Corn Sandwich', price: 110 },
      { name: 'Cold Sandwich', price: 100 },
    ],
  },
  {
    category: 'Wraps',
    items: [
      { name: 'Hara Bhara Wrap', prices: { regular: 150, large: 230 } },
      { name: 'Super Veg Wrap', prices: { regular: 140, large: 220 }, description: 'with Cheese Slice' },
      { name: 'Paneer Wrap', prices: { regular: 120, large: 200 }, description: 'with Cheese Slice' },
      { name: 'Aloo Tikki Wrap', prices: { regular: 100, large: 180 } },
      { name: 'Garlic Wrap', prices: { regular: 100, large: 180 } },
    ],
  },
  {
    category: 'Chinese Snacks',
    items: [
      { name: 'Cheese Corn Roll', price: 170, bestseller: true },
      { name: 'Gravy Momos (8pc)', price: 160, bestseller: true },
      { name: 'Kurkure Momos (8pc)', price: 150, bestseller: true },
      { name: 'Paneer Momos Fry/Steam (8pc)', price: 130 },
      { name: 'Veg Momos Fry/Steam (10pc)', price: 130 },
      { name: 'Spring Roll', price: 150 },
    ],
  },
  {
    category: 'Cold Drinks',
    items: [
      { name: 'Masala Coke', prices: { medium: 70, large: 90 } },
      { name: 'Cold Drink', prices: { medium: 45, large: 60 } },
      { name: 'Pepsi', prices: { medium: 45, large: 60 } },
      { name: 'Sprite', prices: { medium: 45, large: 60 } },
      { name: 'Fenta', prices: { medium: 45, large: 60 } },
      { name: 'Mazza', prices: { medium: 45, large: 60 } },
    ],
  },
  {
    category: 'Hot Coffee',
    items: [
      { name: 'Cappuccino', price: 100 },
      { name: 'Hot Coffee', price: 100 },
      { name: 'Chocolate Coffee Mocha', price: 130 },
      { name: 'Vanilla Coffee', price: 120 },
      { name: 'Hazelnut Coffee', price: 120 },
      { name: 'Hot Tea', price: 50 },
      { name: 'Espresso Shot', price: 80 },
      { name: 'Americano', price: 90 },
    ],
  },
  {
    category: 'Shakes',
    items: [
      { name: 'Vanilla Shake', price: 120 },
      { name: 'Strawberry Shake', price: 130 },
      { name: 'Butterscotch Shake', price: 130 },
      { name: 'Black Currant Shake', price: 130 },
      { name: 'Chocolate Shake', price: 130 },
      { name: 'Oreo Shake', price: 130 },
      { name: 'Mango Shake', price: 140 },
    ],
  },
  {
    category: 'Cold Coffee',
    items: [
      { name: 'Cold Coffee', price: 130 },
      { name: 'Vanilla Cold Coffee', price: 140 },
      { name: 'Hazelnut Cold Coffee', price: 140 },
    ],
  },
  {
    category: 'Garlic Bread',
    items: [
      { name: 'Plain Garlic Bread', price: 130 },
      { name: 'Garlic Bread with Sweet Corn', price: 150 },
    ],
  },
  {
    category: "Mojito's",
    items: [
      { name: 'Mint Mojito', price: 100 },
      { name: 'Green Apple Mojito', price: 100 },
      { name: 'Strawberry Mojito', price: 100 },
      { name: 'Blue Curacao Mojito', price: 100 },
      { name: 'Water Melon Mojito', price: 100 },
      { name: 'Bubblegum Mojito', price: 100 },
      { name: 'Spicy Mango Mojito', price: 100 },
    ],
  },
  {
    category: 'Walk & Talk',
    items: [
      { name: 'Golden Fries', prices: { regular: 90, medium: 120 } },
      { name: 'Masala Fries', prices: { regular: 110, medium: 130 } },
      { name: 'Peri Peri Fries', prices: { regular: 130, medium: 150 } },
      { name: 'Cheese Fries', prices: { regular: 150, medium: 170 } },
    ],
  },
  {
    category: 'Fresh Salad',
    items: [
      { name: 'Sweet Corn Salad', price: 100 },
      { name: 'Green Salad', price: 130 },
      { name: 'Aloo Tikki Salad', price: 150 },
      { name: 'Paneer Tikka Salad', price: 180 },
    ],
  },
  {
    category: 'Pastas',
    items: [
      { name: 'Tandoori Pasta', price: 150 },
      { name: 'White Sauce Pasta', price: 150 },
      { name: 'Red Sauce Pasta', price: 140 },
      { name: 'Mix Sauce Pasta', price: 140 },
    ],
  },
  {
    category: 'Maggi',
    items: [
      { name: 'Veggies Maggi', price: 140 },
      { name: 'Tandoori Maggi', price: 120 },
      { name: 'Masala Maggi', price: 100 },
      { name: 'Plain Maggi', price: 80 },
    ],
  },
  {
    category: 'Sub',
    items: [
      { name: 'Mexican Sub', prices: { regular: 180, xlarge: 340 }, description: '6 inch / 12 inch' },
      { name: 'Paneer Patty Sub', prices: { regular: 160, xlarge: 300 }, description: '6 inch / 12 inch' },
      { name: 'Aloo Patty Sub', prices: { regular: 140, xlarge: 260 }, description: '6 inch / 12 inch' },
    ],
  },
  {
    category: 'Pizza',
    items: [
      { name: 'Farm House Pizza', prices: { small: 230, regular: 300, medium: 380, large: 480, xlarge: 580 }, bestseller: true, description: 'Full Loaded Vegetable with Extra Cheese' },
      { name: 'Super Deluxe with Mushroom Pizza', prices: { small: 220, regular: 280, medium: 340, large: 460, xlarge: 560 }, bestseller: true, description: 'Onion, Tomato, Mushroom, Capsicum' },
      { name: 'Peri Peri Paneer Pizza', prices: { small: 220, regular: 270, medium: 330, large: 450, xlarge: 550 }, bestseller: true, description: 'Red Paprika, Paneer, Capsicum, Onion' },
      { name: 'Paneer Tikka Pizza', prices: { small: 210, regular: 260, medium: 340, large: 450, xlarge: 560 }, bestseller: true, description: 'Sweet Paneer with Ring Onion' },
      { name: 'Gold Corn with Black Olive Pizza', prices: { small: 190, regular: 270, medium: 380, large: 460, xlarge: 520 }, description: 'Sweet Corn, Olives, Mushroom' },
      { name: 'Crispy Pizza', prices: { small: 170, regular: 240, medium: 320, large: 400, xlarge: 490 }, description: 'Crunchy Capsicum & Onion' },
      { name: 'Bingo Chips Pizza', prices: { small: 190, regular: 250, medium: 300, large: 380, xlarge: 460 }, description: 'Onion, Tomato, Mushroom, Olives, Chips' },
      { name: 'Margherita Pizza', prices: { small: 170, regular: 240, medium: 320, large: 400, xlarge: 490 }, description: 'Mozzarella Cheese' },
      { name: 'Kadhai Paneer Pizza', prices: { small: 220, regular: 300, medium: 420, large: 480, xlarge: 550 }, bestseller: true, description: 'Red Paprika, Paneer, Capsicum, Onion' },
      { name: 'Snapy Pizza', prices: { small: 220, regular: 270, medium: 350, large: 450, xlarge: 550 }, bestseller: true, description: 'Green Jalapeno, Capsicum with Onion' },
    ],
  },
  {
    category: 'Ice Cream',
    items: [
      { name: 'Vanilla Ice Cream', price: 30 },
      { name: 'Strawberry Ice Cream', price: 30 },
      { name: 'Butterscotch Ice Cream', price: 30 },
      { name: 'Chocolate Ice Cream', price: 30 },
      { name: 'Mango Ice Cream', price: 30 },
    ],
  },
  {
    category: 'Family Combo',
    items: [
      {
        name: 'Family Combo',
        price: 380,
        description: 'Paneer Tikka Pizza (S) + Golden Fries (S) + 2 Cold Drink (S) + Aloo Tikki Burger',
        bestseller: true,
      },
    ],
  },
]

function flattenItems(categoryId, categoryDef) {
  const rows = []
  for (const item of categoryDef.items || []) {
    const base = {
      restaurantId: categoryId.restaurantId,
      categoryId: categoryId._id,
      name: String(item.name || '').trim(),
      description: String(item.description || '').trim(),
      available: true,
      isVeg: item.isVeg !== false,
      bestseller: Boolean(item.bestseller),
    }

    if (item.prices && typeof item.prices === 'object') {
      for (const [portionSize, price] of Object.entries(item.prices)) {
        rows.push({
          ...base,
          portionSize,
          price: Number(price),
        })
      }
    } else {
      rows.push({
        ...base,
        portionSize: 'medium',
        price: Number(item.price),
      })
    }
  }
  return rows
}

async function run() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing in .env')
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 })

  const user = await User.findOne({ email: ownerEmail }).select('_id email').lean()
  if (!user) throw new Error(`User not found for email: ${ownerEmail}`)

  const restaurant = await Restaurant.findOne({ ownerId: user._id }).select('_id name slug').lean()
  if (!restaurant) throw new Error(`Restaurant not found for owner: ${ownerEmail}`)

  let categoriesTouched = 0
  let itemsUpserted = 0

  for (let index = 0; index < menuDefinition.length; index += 1) {
    const categoryDef = menuDefinition[index]

    const category = await Category.findOneAndUpdate(
      { restaurantId: restaurant._id, name: categoryDef.category },
      {
        $set: {
          restaurantId: restaurant._id,
          name: categoryDef.category,
          orderIndex: index,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )

    categoriesTouched += 1

    const rows = flattenItems({ _id: category._id, restaurantId: restaurant._id }, categoryDef)
    for (const row of rows) {
      await MenuItem.findOneAndUpdate(
        {
          restaurantId: restaurant._id,
          categoryId: category._id,
          name: row.name,
          portionSize: row.portionSize,
        },
        { $set: row },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      itemsUpserted += 1
    }
  }

  const finalCategoryCount = await Category.countDocuments({ restaurantId: restaurant._id })
  const finalItemCount = await MenuItem.countDocuments({ restaurantId: restaurant._id })

  console.log(
    JSON.stringify(
      {
        ownerEmail,
        restaurant: {
          id: String(restaurant._id),
          name: restaurant.name,
          slug: restaurant.slug,
        },
        categoriesTouched,
        itemsUpserted,
        totals: {
          categories: finalCategoryCount,
          menuItems: finalItemCount,
        },
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
