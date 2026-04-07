# Janakas Isolated Benchmark Environment

This folder is a standalone simulation environment for load-testing the existing Janakas restaurant setup without modifying production application code.

## What this simulates

- Restaurant: `janakas` (via slug)
- Tables: configurable (`TABLE_MIN` to `TABLE_MAX`, default 1-25)
- Daily traffic target: 300-600 orders/day behavior profile
- Explicit traffic modes:
  - Steady profile (normal service): configurable around 5-10 req/sec
  - Peak profile (rush window): configurable around 50-100 concurrent users
- QR-first customer flow:
  - QR entry page: `/r/janakas/t/:table?floor=:floor`
  - Menu fetch: `GET /api/menu/:restaurantSlug`
  - Cart/offer preview: `POST /api/offers/preview/:restaurantSlug`
  - Place order: `POST /api/orders`
  - Order polling:
    - `GET /api/orders/track/:restaurantSlug/:tableNumber`
    - `GET /api/orders/track/:restaurantSlug/:tableNumber/:orderId`
  - Optional admin board reads (if token + restaurant id provided)

## Folder structure

- `k6/janakas-flow.js`: realistic flow script
- `scripts/run-benchmark.mjs`: orchestrates steady and peak k6 runs + infra samplers + report generation
- `scripts/sample-infra.mjs`: samples MongoDB, Redis, and Node process memory/CPU
- `scripts/build-report.mjs`: builds JSON + Markdown summary with endpoint attribution and per-order costing
- `config/scenario.json`: steady/peak traffic profiles
- `config/endpoint-attribution.json`: estimated reads/writes/compute weights per endpoint
- `config/pricing.json`: editable cost assumptions

## Setup

1. Install dependencies in this folder:

```bash
cd simulations/janakas-benchmark
npm install
```

2. Copy env template and fill values:

```bash
cp .env.example .env
```

Recommended:
- Set `MONGO_URI` and `REDIS_URL` for DB/Redis metrics.
- Set `APP_PID` to backend Node PID for process memory metrics.
- Keep `BASE_WEB_URL` and `BASE_API_URL` pointing to local running app.

3. Ensure your app is running (frontend + backend) locally.

## Run benchmark

```bash
npm run bench:run
```

Outputs are created under:
- `outputs/<timestamp>/`
- `outputs/latest/` (latest copied artifacts)

Artifacts:
- `k6-summary-steady.json`
- `k6-summary-peak.json`
- `infra-samples.jsonl`
- `benchmark-report.json`
- `SUMMARY_REPORT.md`

## Metrics captured

### Database load
- Mongo op deltas from `serverStatus.opcounters`:
  - Reads/day (query + getmore + command)
  - Reads/sec avg + peak
  - Writes/day (insert + update + delete)
- Payload size average per request from k6 sent/received bytes
- Total data transferred (MB/GB)
- Per-endpoint estimated reads/writes and payload attribution

### Memory usage
- Node process memory (if `APP_PID` set)
- Redis memory usage (`INFO memory`)
- Mongo working set estimate (`wiredTiger cache bytes currently in cache`)

### API performance
- Average response time
- P95 / P99
- Error rate
- Side-by-side steady vs peak behavior

### Redis analysis
- Redis keyspace hit/miss deltas (`INFO stats`)
- Endpoint cache hit/miss counters (when cache headers are emitted)
- Estimated Mongo load reduction due to Redis cache

### Per-order cost model
- Reads/order, writes/order, data transfer/order
- Cost/order split: Mongo + Redis + compute + network

### Infra cost estimation
Using observed traffic + editable assumptions in `config/pricing.json`, estimates monthly costs for:
- 1 restaurant
- 10 restaurants
- 50 restaurants

Also outputs day-level and month-level cost breakdowns.

## Reproducibility notes

- All simulation scripts and config are isolated in this folder.
- No production code changes are required to execute this benchmark.
- Cost model assumptions are explicit and editable.

## Important notes

- This test compresses a day pattern into a single benchmark run. For higher confidence, run multiple times and compare.
- If Mongo/Redis credentials are not supplied, API metrics still work but DB/Redis sections will be partial.
- Optional admin reads are disabled unless both `ADMIN_BEARER_TOKEN` and `ADMIN_RESTAURANT_ID` are provided.
