# Chef's Bud - Restaurant Revenue OS

Full-stack SaaS restaurant revenue platform with

- Owner dashboard (menu, tables, orders, offers, analytics, settings)
- Public customer ordering route via QR: `/r/:restaurantSlug/t/:tableNumber`
- Express + MongoDB backend with JWT auth and multi-tenant data model

## Tech Stack

- Frontend: React + Vite + Tailwind + React Router + Axios + Recharts
- Backend: Express + Mongoose + JWT + bcrypt

## Environment Setup

1. Copy `.env.example` to `.env`
2. Update values as needed:

```
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/chefs_bud
MONGO_MAX_POOL_SIZE=25
MONGO_MIN_POOL_SIZE=5
MONGO_SERVER_SELECTION_TIMEOUT_MS=8000
MONGO_SOCKET_TIMEOUT_MS=45000
JWT_SECRET=change-this-secret
CORS_ORIGIN=http://localhost:5173
GEMINI_API_KEY=<your-gemini-api-key>
GEMINI_MODEL=gemini-1.5-flash
OPENAI_API_KEY=<your-openai-api-key>
OPENAI_MODEL=gpt-4o-mini
RAZORPAY_KEY_ID=<your-razorpay-key-id>
RAZORPAY_KEY_SECRET=<your-razorpay-key-secret>
RAZORPAY_HYBRID_MONTHLY_PLAN_ID=<your-razorpay-plan-id-for-rs-999>
KEEP_ALIVE_TIMEOUT_MS=65000
HEADERS_TIMEOUT_MS=66000

AZURE_STORAGE_CONNECTION_STRING=<your-azure-storage-connection-string>
AZURE_STORAGE_CONTAINER=orders-archive
ORDER_ARCHIVE_ENABLED=true
ORDER_ARCHIVE_INTERVAL_MINUTES=60
ORDER_ARCHIVE_DELAY_HOURS=6
ORDER_ARCHIVE_BATCH_SIZE=500
ORDER_ARCHIVE_PURGE_AFTER_UPLOAD=true

INVENTORY_V2_ROLLOUT_MODE=shadow
INVENTORY_STRICT_POLICY=soft
INVENTORY_ALLOW_LEGACY_FALLBACK=true
INVENTORY_BLOCK_ORDER_COMPLETION_ON_FAILURE=false
INVENTORY_ENABLE_RESERVATIONS_ON_ORDER_CREATE=true
INVENTORY_ALLOW_CLIENT_POLICY_OVERRIDE=false

VITE_API_BASE_URL=http://localhost:5000/api
VITE_FRONTEND_BASE_URL=http://localhost:5173
```

## Run Locally

Install dependencies:

```
npm install
```

Run backend (port 5000):

```
npm run server
```

Run frontend (port 5173) in a second terminal:

```
npm run dev
```

## ngrok Testing (QR Flow)

1. Start frontend on `5173`
2. Run:

```
ngrok http 5173
```

3. Copy generated https URL, then set:

```
VITE_FRONTEND_BASE_URL=<your-ngrok-url>
```

4. Restart frontend and regenerate table QR codes.

QR values will now point to your ngrok public URL.

## Required Flow

Owner flow:

1. Register account
2. Auto-create restaurant
3. Choose pricing: lifetime one-time or hybrid (setup + monthly autopay)
4. Add categories and menu items
5. Add tables and generate QR
6. View incoming orders in dashboard

Customer flow:

1. Open scanned QR URL `/r/:restaurantSlug/t/:tableNumber`
2. Browse categories/menu
3. Add items to cart
4. Checkout and place order

Orders persist to MongoDB and appear in owner dashboard polling.

## Order Lifecycle + S3 Archival

- Owner sees active orders in dashboard from MongoDB.
- When an order reaches `Served` or `Completed`, owner can move it to `Recent Orders`.
- A background scheduler archives `Recent Orders` older than `ORDER_ARCHIVE_DELAY_HOURS` to S3.
- Archive objects are tenant-bounded by restaurant path, compressed as `json.gz`.
- After successful upload, archived orders are purged from MongoDB when `ORDER_ARCHIVE_PURGE_AFTER_UPLOAD=true`.

### Order Status API Idempotency

- `PATCH /api/orders/:orderId/status` treats stale client retries as idempotent.
- If an order is already `Completed` and a delayed/stale request attempts to move it back to an active status, API returns `200` with the current order state instead of `409`.
- Client expectation: always trust the returned order payload as source of truth after status updates.

### Inventory Index Rollout Note

- Inventory reverse-consumption queries depend on a compound index in `InventoryLedger`:
	`{ restaurantId, referenceType, referenceId, direction, type, metadata.cycle }`.
- On server startup, a non-blocking readiness check logs whether this index is present.
- If startup logs show `startup_check_inventory_ledger_cycle_index_missing`, deploy can still run, but monitor index build completion to avoid temporary query slowdowns.

### Inventory Rollout Controls (SaaS Safe Defaults)

- `INVENTORY_V2_ROLLOUT_MODE` supports `off`, `shadow`, `enforced`.
- Recommended phased rollout:
	1. `off` for immediate rollback if needed.
	2. `shadow` for non-blocking v2 reservation/consume plus legacy fallback.
	3. `enforced` once reconciliation confidence is high.
- `INVENTORY_STRICT_POLICY` controls `soft|hard` policy under `enforced` mode.
- `INVENTORY_ALLOW_LEGACY_FALLBACK` allows legacy ledger fallback when v2 reservation consumption does not apply.
- `INVENTORY_BLOCK_ORDER_COMPLETION_ON_FAILURE` blocks `Completed` status transition on inventory policy failures when enabled.
- Health endpoint `/api/health` now exposes current inventory rollout and policy flags for runtime verification.

## AI Menu Import (Owner → Menu)

- Open Menu section in owner dashboard.
- Upload a menu text file (`.txt`, `.csv`, `.md`, `.json`).
- Click **Analyze with AI** to auto-generate categories + items + prices.
- Review and manually edit the generated draft.
- Click **Import to Menu** to save into MongoDB categories/items.

Provider priority:

- If `GEMINI_API_KEY` is set, backend uses Gemini first (recommended free-tier testing path).
- If Gemini is not set but OpenAI is set, backend uses OpenAI.
- If neither key is set, text input still works via local heuristic parser.

Performance notes:

- Hot GET routes (`/api/menu/:restaurantSlug`, `/api/analytics/*`) use short-TTL in-memory response caching.
- Cache is invalidated automatically on menu/order writes.
