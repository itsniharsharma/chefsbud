import Category from '../models/Category.js'
import MenuItem from '../models/MenuItem.js'
import Restaurant from '../models/Restaurant.js'
import Offer from '../models/Offer.js'
import { parseMenuWithAI } from '../services/aiMenuParser.js'
import { invalidateCacheByTags } from '../services/responseCache.js'
import {
  emitMenuItemCreated,
  emitMenuItemDeleted,
  emitMenuItemUpdated,
  emitMenuRefreshRequired,
} from '../realtime/menuEvents.js'
import { resolveRequestRestaurant } from '../utils/requestRestaurant.js'

const menuProjection = '_id categoryId name description price available isVeg bestseller'
const categoryProjection = '_id name orderIndex'
const offerProjection = '_id name type discountValue conditions active startTime endTime'

function invalidateMenuCache(restaurantSlug) {
  invalidateCacheByTags([`menu:${restaurantSlug}`])
}

async function buildMenuPayload(restaurant) {
  const [categories, items, offers] = await Promise.all([
    Category.find({ restaurantId: restaurant._id })
      .sort({ orderIndex: 1, name: 1 })
      .select(categoryProjection)
      .lean(),
    MenuItem.find({ restaurantId: restaurant._id })
      .sort({ createdAt: -1 })
      .select(menuProjection)
      .lean(),
    Offer.find({ restaurantId: restaurant._id, active: true })
      .sort({ createdAt: -1 })
      .select(offerProjection)
      .lean(),
  ])

  return { restaurant, categories, items, offers }
}

export async function getMenuBySlug(req, res, next) {
  try {
    const restaurant = await Restaurant.findOne({ slug: req.params.restaurantSlug })
      .select('_id name slug address phone')
      .lean()
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    return res.json(await buildMenuPayload(restaurant))
  } catch (error) {
    next(error)
  }
}

export async function getManagedMenu(req, res, next) {
  try {
    const restaurant = await Restaurant.findOne({
      _id: req.params.restaurantId,
      ownerId: req.user._id,
    })
      .select('_id name slug address phone')
      .lean()

    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    return res.json(await buildMenuPayload(restaurant))
  } catch (error) {
    next(error)
  }
}

export async function createCategory(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const { name, orderIndex = 0 } = req.body
    if (!name?.trim()) {
      return res.status(400).json({ message: 'Category name is required' })
    }

    const category = await Category.create({
      restaurantId: restaurant._id,
      name: name.trim(),
      orderIndex,
    })

    invalidateMenuCache(restaurant.slug)
    emitMenuRefreshRequired(restaurant.slug, 'category-created')

    return res.status(201).json(category)
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Category already exists' })
    }
    next(error)
  }
}

export async function createMenuItem(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const { categoryId, name, description, price, available, isVeg, bestseller } = req.body

    const category = await Category.findOne({ _id: categoryId, restaurantId: restaurant._id }).lean()
    if (!category) {
      return res.status(400).json({ message: 'Invalid category' })
    }

    const item = await MenuItem.create({
      restaurantId: restaurant._id,
      categoryId,
      name,
      description,
      price,
      available,
      isVeg,
      bestseller,
    })

    invalidateMenuCache(restaurant.slug)
    emitMenuItemCreated(restaurant.slug, item)

    return res.status(201).json(item)
  } catch (error) {
    next(error)
  }
}

export async function updateMenuItem(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const updates = ['categoryId', 'name', 'description', 'price', 'available', 'isVeg', 'bestseller']
    const patch = {}
    updates.forEach((field) => {
      if (field in req.body) {
        patch[field] = req.body[field]
      }
    })

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ message: 'No valid menu fields provided' })
    }

    const item = await MenuItem.findOneAndUpdate(
      { _id: req.params.id, restaurantId: restaurant._id },
      { $set: patch },
      { new: true, runValidators: true },
    )
    if (!item) {
      return res.status(404).json({ message: 'Menu item not found' })
    }

    invalidateMenuCache(restaurant.slug)
    emitMenuItemUpdated(restaurant.slug, req.params.id, patch)
    return res.json(item)
  } catch (error) {
    next(error)
  }
}

export async function deleteMenuItem(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const result = await MenuItem.deleteOne({ _id: req.params.id, restaurantId: restaurant._id })
    if (!result.deletedCount) {
      return res.status(404).json({ message: 'Menu item not found' })
    }

    invalidateMenuCache(restaurant.slug)
    emitMenuItemDeleted(restaurant.slug, req.params.id)

    return res.json({ success: true })
  } catch (error) {
    next(error)
  }
}

export async function analyzeMenuWithAI(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const menuText = typeof req.body?.menuText === 'string' ? req.body.menuText.trim() : ''
    const rawMenuImages = Array.isArray(req.body?.menuImages) ? req.body.menuImages : []
    const menuImages = rawMenuImages
      .map((image) => ({
        mimeType: String(image?.mimeType || '').trim(),
        dataBase64: String(image?.dataBase64 || '').trim(),
      }))
      .filter((image) => image.mimeType && image.dataBase64)

    if (!menuText && menuImages.length === 0) {
      return res.status(400).json({ message: 'Upload menu images for AI analysis' })
    }

    if (menuImages.length > 4) {
      return res.status(400).json({ message: 'You can analyze up to 4 menu images at once' })
    }

    const parsedMenu = await parseMenuWithAI({ menuText, menuImages })
    return res.json(parsedMenu)
  } catch (error) {
    next(error)
  }
}

export async function importMenuDraft(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const draftCategories = Array.isArray(req.body?.categories) ? req.body.categories : []
    if (!draftCategories.length) {
      return res.status(400).json({ message: 'Draft categories are required' })
    }

    const normalizedCategories = draftCategories
      .map((category) => {
        const name = String(category?.name || '').trim()
        if (!name) return null

        const items = (Array.isArray(category?.items) ? category.items : [])
          .map((item) => {
            const itemName = String(item?.name || '').trim()
            const price = Number(item?.price)
            if (!itemName || Number.isNaN(price) || price < 0) {
              return null
            }

            return {
              name: itemName,
              description: String(item?.description || '').trim(),
              price,
              available: item?.available !== false,
              isVeg: item?.isVeg !== false,
              bestseller: Boolean(item?.bestseller),
            }
          })
          .filter(Boolean)

        if (!items.length) return null

        return {
          name,
          items,
        }
      })
      .filter(Boolean)

    if (!normalizedCategories.length) {
      return res.status(400).json({ message: 'No valid categories/items to import' })
    }

    const categoryNameByLower = new Map()
    for (const category of normalizedCategories) {
      const nameLower = category.name.toLowerCase()
      if (!categoryNameByLower.has(nameLower)) {
        categoryNameByLower.set(nameLower, category.name)
      }
    }

    const uniqueNames = [...categoryNameByLower.values()]

    await Category.bulkWrite(
      uniqueNames.map((originalName) => {
        return {
          updateOne: {
            filter: { restaurantId: restaurant._id, name: originalName },
            update: { $setOnInsert: { restaurantId: restaurant._id, name: originalName, orderIndex: 0 } },
            upsert: true,
          },
        }
      }),
      { ordered: false },
    )

    const categories = await Category.find({ restaurantId: restaurant._id, name: { $in: uniqueNames } })
      .select('_id name')
      .lean()
    const categoryIdByName = new Map(categories.map((category) => [category.name.toLowerCase(), category._id]))

    const itemDocs = []
    for (const category of normalizedCategories) {
      const categoryId = categoryIdByName.get(category.name.toLowerCase())
      if (!categoryId) continue

      for (const item of category.items) {
        itemDocs.push({
          restaurantId: restaurant._id,
          categoryId,
          name: item.name,
          description: item.description,
          price: item.price,
          available: item.available,
          isVeg: item.isVeg,
          bestseller: item.bestseller,
        })
      }
    }

    if (!itemDocs.length) {
      return res.status(400).json({ message: 'No valid menu items to import' })
    }

    await MenuItem.insertMany(itemDocs, { ordered: false })
    invalidateMenuCache(restaurant.slug)
    emitMenuRefreshRequired(restaurant.slug, 'menu-imported')

    return res.status(201).json({
      importedCategories: categories.length,
      importedItems: itemDocs.length,
    })
  } catch (error) {
    next(error)
  }
}
