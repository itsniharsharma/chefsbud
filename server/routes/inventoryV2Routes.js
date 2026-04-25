import { Router } from 'express'
import { body, param, query } from 'express-validator'
import {
  approvePurchaseOrder,
  consumeReservedInventoryStock,
  createInventoryLocation,
  createPurchaseOrder,
  createRecipeVersion,
  createTransferOrder,
  dispatchTransferOrder,
  getAvailableInventoryStock,
  listInventoryLocations,
  listRecipeVersions,
  receiveGoodsReceipt,
  receiveTransferOrder,
  releaseReservedInventoryStock,
  reserveInventoryStock,
} from '../controllers/inventoryV2Controller.js'
import { requireAuth } from '../middleware/auth.js'
import { requireOwner } from '../middleware/authorize.js'
import { requireActiveBilling } from '../middleware/billing.js'
import { requireInventoryEnabled } from '../middleware/featureAccess.js'
import { validateRequest } from '../middleware/validateRequest.js'

const router = Router()

router.use(requireAuth, requireActiveBilling, requireInventoryEnabled)

router.get('/locations', listInventoryLocations)
router.post(
  '/locations',
  [
    body('name').isString().trim().isLength({ min: 2, max: 120 }),
    body('code').optional().isString().trim().isLength({ min: 2, max: 40 }),
    body('type').optional().isIn(['Kitchen', 'Store', 'Bar', 'Warehouse', 'Other']),
    body('isDefault').optional().isBoolean(),
  ],
  validateRequest,
  requireOwner,
  createInventoryLocation,
)

router.get(
  '/stock/available',
  [
    query('locationId').optional().isMongoId(),
    query('itemIds').optional().isString().isLength({ max: 4000 }),
  ],
  validateRequest,
  getAvailableInventoryStock,
)

router.post(
  '/stock/reserve',
  [
    body('orderId').isString().trim().notEmpty(),
    body('items').isArray({ min: 1, max: 200 }),
    body('items.*.menuItemId').isString().trim().notEmpty(),
    body('items.*.quantity').optional().isFloat({ min: 0.000001, max: 100000000 }),
    body('locationId').optional().isMongoId(),
    body('policy').optional().isIn(['soft', 'hard']),
  ],
  validateRequest,
  reserveInventoryStock,
)

router.post(
  '/stock/release',
  [
    body('orderId').isString().trim().notEmpty(),
    body('reason').optional().isString().trim().isLength({ max: 120 }),
  ],
  validateRequest,
  releaseReservedInventoryStock,
)

router.post(
  '/stock/consume',
  [
    body('orderId').isString().trim().notEmpty(),
    body('cycle').optional().isInt({ min: 1, max: 10000 }),
    body('policy').optional().isIn(['soft', 'hard']),
  ],
  validateRequest,
  consumeReservedInventoryStock,
)

router.post(
  '/procurement/po',
  [
    body('poNumber').optional().isString().trim().isLength({ max: 80 }),
    body('supplierId').optional({ values: 'falsy' }).isMongoId(),
    body('supplierNameSnapshot').optional().isString().trim().isLength({ max: 160 }),
    body('locationId').optional({ values: 'falsy' }).isMongoId(),
    body('expectedDate').optional().isISO8601(),
    body('notes').optional().isString().trim().isLength({ max: 400 }),
    body('items').isArray({ min: 1, max: 500 }),
    body('items.*.inventoryItemId').isMongoId(),
    body('items.*.orderedQty').isFloat({ min: 0.000001, max: 100000000 }),
    body('items.*.unit').isIn(['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet']),
    body('items.*.expectedRate').optional().isFloat({ min: 0, max: 100000000 }),
  ],
  validateRequest,
  requireOwner,
  createPurchaseOrder,
)

router.post(
  '/procurement/po/:poId/approve',
  [param('poId').isMongoId()],
  validateRequest,
  requireOwner,
  approvePurchaseOrder,
)

router.post(
  '/procurement/po/:poId/grn',
  [
    param('poId').isMongoId(),
    body('grnNumber').optional().isString().trim().isLength({ max: 80 }),
    body('locationId').optional({ values: 'falsy' }).isMongoId(),
    body('invoiceNumber').optional().isString().trim().isLength({ max: 80 }),
    body('invoiceDate').optional().isISO8601(),
    body('lines').isArray({ min: 1, max: 500 }),
    body('lines.*.purchaseOrderItemIndex').isInt({ min: 0, max: 9999 }),
    body('lines.*.inventoryItemId').isMongoId(),
    body('lines.*.receivedQty').isFloat({ min: 0, max: 100000000 }),
    body('lines.*.acceptedQty').optional().isFloat({ min: 0, max: 100000000 }),
    body('lines.*.unit').isIn(['Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet']),
    body('lines.*.unitRate').optional().isFloat({ min: 0, max: 100000000 }),
  ],
  validateRequest,
  receiveGoodsReceipt,
)

router.post(
  '/transfers',
  [
    body('transferNumber').optional().isString().trim().isLength({ max: 80 }),
    body('fromLocationId').isMongoId(),
    body('toLocationId').isMongoId(),
    body('lines').isArray({ min: 1, max: 500 }),
    body('lines.*.inventoryItemId').isMongoId(),
    body('lines.*.quantity').isFloat({ min: 0.000001, max: 100000000 }),
    body('lines.*.unit').isIn(['g', 'ml', 'unit', 'Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet']),
  ],
  validateRequest,
  createTransferOrder,
)

router.post('/transfers/:transferId/dispatch', [param('transferId').isMongoId()], validateRequest, dispatchTransferOrder)
router.post('/transfers/:transferId/receive', [param('transferId').isMongoId()], validateRequest, receiveTransferOrder)

router.post(
  '/recipes/:menuItemId/versions',
  [
    param('menuItemId').isMongoId(),
    body('ingredients').isArray({ min: 1, max: 500 }),
    body('ingredients.*.inventoryItemId').isMongoId(),
    body('ingredients.*.quantity').isFloat({ min: 0.000001, max: 100000000 }),
    body('ingredients.*.unit').isIn(['g', 'ml', 'unit', 'Kg', 'Gram', 'Litre', 'Ml', 'Unit', 'Packet']),
  ],
  validateRequest,
  createRecipeVersion,
)

router.get('/recipes/:menuItemId/versions', [param('menuItemId').isMongoId()], validateRequest, listRecipeVersions)

export default router
