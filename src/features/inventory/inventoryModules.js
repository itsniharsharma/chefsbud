import {
  ArrowRightLeft,
  BookOpen,
  Boxes,
  ClipboardList,
  FileChartColumn,
  ShoppingBasket,
  Trash2,
  Truck,
} from 'lucide-react'

export const inventoryModules = [
  {
    key: 'indent',
    title: 'Indent Management',
    description: 'Calculate raw materials required for bulk preparation',
    icon: ClipboardList,
    route: '/inventory/indent',
  },
  {
    key: 'wastage',
    title: 'Wastage',
    description: 'Track wastage of raw materials and reduce leakage',
    icon: Trash2,
    route: '/inventory/wastage',
  },
  {
    key: 'stock',
    title: 'Current Stock',
    description: 'View and update current stock of all items',
    icon: Boxes,
    route: '/inventory/stock',
  },
  {
    key: 'reports',
    title: 'Stock Report',
    description: 'View purchase, consumption, and stock history',
    icon: FileChartColumn,
    route: '/inventory/reports',
  },
  {
    key: 'purchase',
    title: 'Purchase Management',
    description: 'Manage supplier purchases and inward entries',
    icon: Truck,
    route: '/inventory/purchase/add',
  },
  {
    key: 'conversion',
    title: 'Convert Raw Material',
    description: 'Convert raw -> semi-cooked -> cooked items',
    icon: ArrowRightLeft,
    route: '/inventory/conversion',
  },
  {
    key: 'recipes',
    title: 'Recipe Builder',
    description: 'Map menu items to inventory ingredients for auto consumption',
    icon: BookOpen,
    route: '/inventory/recipes',
  },
  {
    key: 'request',
    title: 'Request For Purchase',
    description: 'Raise purchase requests (PO workflow)',
    icon: ShoppingBasket,
    route: '/inventory/request',
  },
]

export function getInventoryModuleByKey(moduleKey = '') {
  const normalized = String(moduleKey || '').trim().toLowerCase()
  return inventoryModules.find((moduleItem) => moduleItem.key === normalized) || null
}
