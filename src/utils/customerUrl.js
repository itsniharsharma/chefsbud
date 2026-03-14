function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '')
}

function toSafeSegment(value) {
  return encodeURIComponent(String(value ?? '').trim())
}

function appendFloorQuery(url, floorNumber) {
  const parsedFloor = Number(floorNumber)
  if (!Number.isFinite(parsedFloor) || parsedFloor < 1) {
    return url
  }

  const safeFloor = encodeURIComponent(String(Math.floor(parsedFloor)))
  return `${url}?floor=${safeFloor}`
}

export function buildCustomerMenuUrl({ baseUrl, slug, tableNumber, floorNumber }) {
  const normalizedBase = normalizeBaseUrl(baseUrl)
  const safeSlug = toSafeSegment(slug)
  const safeTableNumber = toSafeSegment(tableNumber)
  const basePath = `${normalizedBase}/r/${safeSlug}/t/${safeTableNumber}`
  return appendFloorQuery(basePath, floorNumber)
}

export function buildCustomerCheckoutUrl({ baseUrl, slug, tableNumber, floorNumber }) {
  const basePath = `${normalizeBaseUrl(baseUrl)}/r/${toSafeSegment(slug)}/t/${toSafeSegment(tableNumber)}/checkout`
  return appendFloorQuery(basePath, floorNumber)
}

export function buildCustomerStatusUrl({ baseUrl, slug, tableNumber, floorNumber }) {
  const basePath = `${normalizeBaseUrl(baseUrl)}/r/${toSafeSegment(slug)}/t/${toSafeSegment(tableNumber)}/status`
  return appendFloorQuery(basePath, floorNumber)
}

export function buildCustomerOrderTrackingUrl({ baseUrl, slug, tableNumber, orderId, floorNumber }) {
  const safeOrderId = toSafeSegment(orderId)
  const basePath = `${normalizeBaseUrl(baseUrl)}/r/${toSafeSegment(slug)}/t/${toSafeSegment(tableNumber)}/order/${safeOrderId}`
  return appendFloorQuery(basePath, floorNumber)
}
