import Offer from '../models/Offer.js'
import Restaurant from '../models/Restaurant.js'
import MenuItem from '../models/MenuItem.js'
import { parseOfferPrompt, validateOfferDraft } from '../services/offerDraftParser.js'
import { applyOffersToOrder } from '../services/offerEngine.js'
import { resolveRequestRestaurant } from '../utils/requestRestaurant.js'

const offerPreviewProjection =
  '_id name ruleType stackingPolicy active startTime endTime priority createdAt couponCode conditions actions'

async function loadRestaurantMenuItemIds(restaurantId) {
  const ids = await MenuItem.distinct('_id', { restaurantId })
  return ids.map((id) => String(id))
}

export async function getOffers(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    if (String(restaurant._id) !== req.params.restaurantId) {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const offers = await Offer.find({ restaurantId: restaurant._id }).sort({ createdAt: -1 }).lean()
    return res.json(offers)
  } catch (error) {
    next(error)
  }
}

export async function createOffer(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const {
      name,
      type,
      ruleType = null,
      discountValue,
      conditions,
      actions = null,
      couponCode = '',
      stackingPolicy = 'stackable',
      priority = 100,
      sourcePrompt = '',
      active,
      startTime,
      endTime,
    } = req.body

    const offer = await Offer.create({
      restaurantId: restaurant._id,
      name,
      type,
      ruleType,
      discountValue,
      conditions,
      actions,
      couponCode,
      stackingPolicy,
      priority,
      sourcePrompt,
      active,
      startTime: startTime || null,
      endTime: endTime || null,
    })

    return res.status(201).json(offer)
  } catch (error) {
    next(error)
  }
}

export async function updateOffer(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const offer = await Offer.findOne({ _id: req.params.id, restaurantId: restaurant._id })
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' })
    }

    const updates = [
      'name',
      'type',
      'ruleType',
      'discountValue',
      'conditions',
      'actions',
      'couponCode',
      'stackingPolicy',
      'priority',
      'sourcePrompt',
      'active',
      'startTime',
      'endTime',
    ]
    updates.forEach((field) => {
      if (field in req.body) {
        offer[field] = req.body[field]
      }
    })

    await offer.save()
    return res.json(offer)
  } catch (error) {
    next(error)
  }
}

export async function deleteOffer(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const result = await Offer.deleteOne({ _id: req.params.id, restaurantId: restaurant._id })
    if (!result.deletedCount) {
      return res.status(404).json({ message: 'Offer not found' })
    }

    return res.json({ success: true })
  } catch (error) {
    next(error)
  }
}

export async function draftOfferFromPrompt(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : ''
    const selectedItemIds = Array.isArray(req.body?.selectedItemIds) ? req.body.selectedItemIds : []

    const menuItems = await MenuItem.find({ restaurantId: restaurant._id, available: true })
      .select('_id name price')
      .lean()

    const parsed = parseOfferPrompt({ prompt, menuItems, selectedItemIds })
    if (parsed.error) {
      return res.status(422).json({ message: parsed.error })
    }

    const validation = validateOfferDraft({
      draft: parsed.draft,
      restaurantMenuItemIds: menuItems.map((item) => String(item._id)),
    })

    return res.json({
      draft: parsed.draft,
      summary: parsed.summary,
      warnings: [...(parsed.warnings || []), ...validation.warnings],
      validation,
    })
  } catch (error) {
    next(error)
  }
}

export async function validateOfferDraftPayload(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const restaurantMenuItemIds = await loadRestaurantMenuItemIds(restaurant._id)
    const validation = validateOfferDraft({
      draft: req.body?.draft,
      restaurantMenuItemIds,
    })

    return res.json(validation)
  } catch (error) {
    next(error)
  }
}

export async function publishOfferDraft(req, res, next) {
  try {
    const restaurant = await resolveRequestRestaurant(req)
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const draft = req.body?.draft
    const restaurantMenuItemIds = await loadRestaurantMenuItemIds(restaurant._id)
    const validation = validateOfferDraft({
      draft,
      restaurantMenuItemIds,
    })

    if (!validation.valid) {
      return res.status(422).json({ message: 'Offer draft validation failed', errors: validation.errors, warnings: validation.warnings })
    }

    const offer = await Offer.create({
      restaurantId: restaurant._id,
      name: draft.name,
      type: draft.type || 'AI Rule',
      ruleType: draft.ruleType,
      discountValue: draft.discountValue || '',
      conditions: draft.conditions || null,
      actions: draft.actions || null,
      couponCode: draft.couponCode || draft.conditions?.couponCode || '',
      stackingPolicy: draft.stackingPolicy || 'stackable',
      priority: Number(draft.priority || 100),
      sourcePrompt: draft.sourcePrompt || '',
      active: draft.active !== false,
      startTime: draft.startTime || null,
      endTime: draft.endTime || null,
    })

    return res.status(201).json({ offer, warnings: validation.warnings })
  } catch (error) {
    next(error)
  }
}

export async function previewOfferPricing(req, res, next) {
  try {
    const restaurant = await Restaurant.findOne({ slug: req.params.restaurantSlug }).select('_id').lean()
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' })
    }

    const payloadItems = Array.isArray(req.body?.items) ? req.body.items : []
    if (!payloadItems.length) {
      return res.json({
        subtotalAmount: 0,
        discountTotal: 0,
        totalAmount: 0,
        appliedOffers: [],
        couponCodeApplied: '',
      })
    }

    const quantityById = new Map()
    for (const item of payloadItems) {
      const id = String(item?.menuItemId || '')
      if (!id) continue
      const quantity = Math.max(1, Number(item?.quantity || 1))
      quantityById.set(id, (quantityById.get(id) || 0) + quantity)
    }

    const ids = [...quantityById.keys()]
    const menuItems = await MenuItem.find({ _id: { $in: ids }, restaurantId: restaurant._id, available: true })
      .select('_id name price')
      .lean()
    const menuMap = new Map(menuItems.map((item) => [String(item._id), item]))

    const orderItems = []
    for (const [id, quantity] of quantityById.entries()) {
      const item = menuMap.get(id)
      if (!item) continue
      orderItems.push({
        menuItemId: item._id,
        name: item.name,
        quantity,
        price: item.price,
      })
    }

    const offers = await Offer.find({ restaurantId: restaurant._id, active: true })
      .select(offerPreviewProjection)
      .lean()
    const preview = applyOffersToOrder({
      orderItems,
      offers,
      couponCode: req.body?.couponCode || '',
    })

    return res.json(preview)
  } catch (error) {
    next(error)
  }
}
