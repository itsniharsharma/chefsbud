import http from 'k6/http'
import { check, group, sleep } from 'k6'
import { Counter, Trend } from 'k6/metrics'

// -------- Metrics --------
const qrEntryDuration = new Trend('qr_entry_duration', true)
const menuFetchDuration = new Trend('menu_fetch_duration', true)
const orderCreateDuration = new Trend('order_create_duration', true)
const orderTrackDuration = new Trend('order_track_duration', true)

const placedOrders = new Counter('orders_placed')
const flowErrors = new Counter('flow_errors')

// -------- ENV --------
const BASE_WEB_URL = __ENV.BASE_WEB_URL
const BASE_API_URL = __ENV.BASE_API_URL
const RESTAURANT_SLUG = __ENV.RESTAURANT_SLUG || 'janakas'
const CUSTOMER_BEARER_TOKEN = String(__ENV.CUSTOMER_BEARER_TOKEN || '').trim()

const TABLE_MIN = Number(__ENV.TABLE_MIN || 1)
const TABLE_MAX = Number(__ENV.TABLE_MAX || 20)

const FLOOR = 1 // your real setup

const DEFAULT_TIMEOUT = '10s'

function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (CUSTOMER_BEARER_TOKEN) {
    headers.Authorization = `Bearer ${CUSTOMER_BEARER_TOKEN}`
  }
  return headers
}

// -------- Helpers --------
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function safeJson(res) {
  try {
    return res.json()
  } catch {
    return {}
  }
}

// -------- Setup --------
export function setup() {
  const table = TABLE_MIN

  const res = http.get(`${BASE_API_URL}/menu/${RESTAURANT_SLUG}`, {
    timeout: DEFAULT_TIMEOUT,
    headers: CUSTOMER_BEARER_TOKEN ? { Authorization: `Bearer ${CUSTOMER_BEARER_TOKEN}` } : {},
  })

  check(res, {
    'setup menu 200': (r) => r.status === 200,
  })

  const json = safeJson(res)

  return {
    menuItems: json.items || [],
    restaurantSlug: RESTAURANT_SLUG,
  }
}

// -------- Main Flow --------
export default function (data) {
  const table = randomInt(TABLE_MIN, TABLE_MAX)
  let shouldContinue = true

  // ---- QR ENTRY ----
  group('qr-entry', () => {
    const qrRes = http.get(
      `${BASE_WEB_URL}/r/${data.restaurantSlug}/t/${table}?floor=${FLOOR}`,
      {
        timeout: DEFAULT_TIMEOUT,
      }
    )

    qrEntryDuration.add(qrRes.timings.duration)

    const ok = check(qrRes, {
      'qr entry ok': (r) => r.status >= 200 && r.status < 400,
    })

    if (!ok) {
      flowErrors.add(1)
      console.log(`QR failed: ${qrRes.status} | ${String(qrRes.body || '').slice(0, 400)}`)
    }
  })

  let selectedItems = []

  // ---- MENU FETCH ----
  group('menu-fetch', () => {
    const menuRes = http.get(`${BASE_API_URL}/menu/${data.restaurantSlug}`, {
      timeout: DEFAULT_TIMEOUT,
      headers: CUSTOMER_BEARER_TOKEN ? { Authorization: `Bearer ${CUSTOMER_BEARER_TOKEN}` } : {},
    })

    menuFetchDuration.add(menuRes.timings.duration)

    const ok = check(menuRes, {
      'menu fetch 200': (r) => r.status === 200,
    })

    if (!ok) {
      flowErrors.add(1)
      shouldContinue = false
      console.log(`Menu failed: ${menuRes.status} | ${String(menuRes.body || '').slice(0, 400)}`)
      return
    }

    const json = safeJson(menuRes)

    const items = json.items || data.menuItems

    if (!items.length) {
      flowErrors.add(1)
      shouldContinue = false
      console.log('Menu failed: 200 | empty menu items array')
      return
    }

    // pick 1–3 items
    selectedItems = items
      .sort(() => 0.5 - Math.random())
      .slice(0, randomInt(1, 3))
      .map((item) => ({
        menuItemId: item._id,
        quantity: randomInt(1, 2),
      }))
  })

  if (!shouldContinue) {
    sleep(Math.random() * 1.2 + 0.4)
    return
  }

  let orderId = ''

  // ---- PLACE ORDER ----
  if (selectedItems.length) {
    group('place-order', () => {
      const payload = {
        restaurantSlug: data.restaurantSlug,
        tableNumber: table,
        floorNumber: FLOOR,
        couponCode: '',
        customerNote: '',
        items: selectedItems,
      }

      const res = http.post(
        `${BASE_API_URL}/orders`,
        JSON.stringify(payload),
        {
          timeout: DEFAULT_TIMEOUT,
          headers: buildHeaders(),
        }
      )

      orderCreateDuration.add(res.timings.duration)

      const ok = check(res, {
        'order created': (r) => r.status === 200 || r.status === 201,
      })

      if (!ok) {
        flowErrors.add(1)
        console.log(`Order failed: ${res.status} | ${String(res.body || '').slice(0, 600)}`)
        return
      }

      const json = safeJson(res)
      orderId = json?._id || ''
      if (orderId) placedOrders.add(1)
    })
  }

  // ---- STATUS POLLING ----
  group('status-polling', () => {
    for (let i = 0; i < randomInt(2, 4); i++) {
      const res = http.get(
        `${BASE_API_URL}/orders/track/${data.restaurantSlug}/${table}`,
        {
          timeout: DEFAULT_TIMEOUT,
          headers: CUSTOMER_BEARER_TOKEN ? { Authorization: `Bearer ${CUSTOMER_BEARER_TOKEN}` } : {},
        }
      )

      orderTrackDuration.add(res.timings.duration)

      const ok = check(res, {
        'track ok': (r) => r.status === 200,
      })

      if (!ok) {
        flowErrors.add(1)
        console.log(`Track table failed: ${res.status} | ${String(res.body || '').slice(0, 400)}`)
      }

      if (orderId) {
        const statusRes = http.get(
          `${BASE_API_URL}/orders/track/${data.restaurantSlug}/${table}/${orderId}`,
          {
            timeout: DEFAULT_TIMEOUT,
            headers: CUSTOMER_BEARER_TOKEN ? { Authorization: `Bearer ${CUSTOMER_BEARER_TOKEN}` } : {},
          }
        )

        orderTrackDuration.add(statusRes.timings.duration)

        const statusOk = check(statusRes, {
          'track order ok': (r) => r.status === 200 || r.status === 404,
        })

        if (!statusOk) {
          flowErrors.add(1)
          console.log(`Track order failed: ${statusRes.status} | ${String(statusRes.body || '').slice(0, 400)}`)
        }
      }

      sleep(Math.random() * 1.5 + 0.5)
    }
  })

  sleep(Math.random() * 2 + 0.5)
}

// -------- Options --------
export const options = {
  scenarios: {
    janakas_flow: {
      executor: 'constant-arrival-rate',
      rate: 2,
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 5,
      maxVUs: 10,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.1'],
    http_req_duration: ['p(95)<1500'],
  },
}