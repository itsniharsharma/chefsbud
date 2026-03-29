# Production Hardening Guide - v2.0

## Overview
This document outlines the production-grade hardening improvements to the ChefsBud inventory system. The system now features distributed orchestration, fault tolerance, comprehensive monitoring, and operational safety mechanisms.

## Key Features

### 1. Distributed Scheduler Leadership
Prevents duplicate background jobs when running multiple instances

**How it works:**
- Only one process per deployment runs reconciliation jobs
- Automatic leader election using Redis with TTL heartbeat
- Automatic failover if leader dies
- No duplicate work, no wasted resources

**Environment Variables:**
```env
Process_ROLE=all|worker|jobs  # Determines which processes run schedulers
INVENTORY_RECONCILIATION_INTERVAL_MINUTES=60  # Reconciliation frequency
```

### 2. Circuit Breaker Pattern
Prevents cascading failures by stopping calls to failing services

**How it works:**
- Tracks failure rate of critical operations
- Automatically "opens" after threshold reached
- Fails fast without trying operation
- "Half-opens" to test recovery
- Automatically closes when healthy

**Configuration:**
```env
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5      # Failures before opening
CIRCUIT_BREAKER_SUCCESS_THRESHOLD=2      # Successes in half-open to close
CIRCUIT_BREAKER_TIMEOUT_MS=60000         # Time before retry in open state
```

**Monitored Operations:**
- `inventory_reconciliation` - Main reconciliation service
- `inventory_validation` - Order validation against inventory

**API Endpoints:**
```
GET  /api/inventory/monitoring/circuit-breakers
POST /api/inventory/monitoring/circuit-breakers/:name/reset
POST /api/inventory/monitoring/circuit-breakers/reset-all
```

### 3. Timeout Protection
Prevents long-running operations from blocking servers

**How it works:**
- Reconciliation processes have 30-second timeout
- If operation takes longer, automatically fails
- Prevents scheduler stalls
- Logs detailed information for debugging

**Configuration:**
```env
RECONCILIATION_TIMEOUT_MS=30000  # Max time for single reconciliation cycle
```

### 4. Authorization & Security
All reconciliation endpoints require admin/owner access

**Protected Endpoints:**
- GET  `/api/inventory/reconciliation/report` (Owner only)
- GET  `/api/inventory/reconciliation/violations-analytics` (Owner only)
- GET  `/api/inventory/reconciliation/orders` (Owner only)
- POST `/api/inventory/reconciliation/orders/:orderId/clear` (Owner only)

### 5. Batch Query Optimization
Fixed N+1 query problem in order validation

**Before:**
```javascript
for (const item of order.items) {
  const balance = await InventoryBalance.findOne(...);  // N queries!
}
```

**After:**
```javascript
const balances = await InventoryBalance.find({
  restaurantId,
  itemId: { $in: itemIds }  // 1 query!
});
const balanceMap = new Map(...);  // O(1) lookups
```

### 6. Startup Validation
Comprehensive inventory consistency checks on startup

**Validates:**
- No negative balances exist
- No orphaned reservations
- Ledger consistency (consumption <= purchases + reservations)
- Orders with old unresolved violations

**Configuration:**
- Runs automatically on startup
- Non-blocking (warnings only, doesn't prevent server start)
- Results logged at `info` and `error` levels

### 7. Audit Logging
All manual reconciliation actions are logged for compliance

**Logged Actions:**
- Order inconsistency clearance
- Reconciliation API requests
- Circuit breaker resets
- Startup validation results

**Log Format:**
```json
{
  "timestamp": "2026-03-29T10:30:45.123Z",
  "level": "info",
  "event": "order_reconciliation_completed",
  "orderId": "507f1f77bcf86cd799439011",
  "userId": "507f1f77bcf86cd799439012",
  "violationCount": 2,
  "restaurantId": "507f1f77bcf86cd799439013"
}
```

## Monitoring Dashboard

A comprehensive admin dashboard for real-time monitoring:

**Location:** `/admin/monitoring` (React component at `src/pages/MonitoringPage.jsx`)

**Features:**
- Real-time circuit breaker status
- Violation analytics (30-day view)
- Order inconsistency tracking
- Manual reconciliation actions
- Auto-refresh every 60 seconds

**Accessing the Dashboard:**
```javascript
import MonitoringPage from './pages/MonitoringPage'

// Add to your React Router
<Route path="/admin/monitoring" element={<MonitoringPage />} />
```

## API Reference

### Get Circuit Breaker Status
```bash
curl -X GET http://localhost:5000/api/inventory/monitoring/circuit-breakers \
  -H "Authorization: Bearer <token>"
```

**Response:**
```json
{
  "timestamp": "2026-03-29T10:30:45.123Z",
  "breakers": {
    "inventory_reconciliation": {
      "name": "inventory_reconciliation",
      "state": "CLOSED",
      "failureCount": 0,
      "successCount": 5,
      "lastError": null,
      "nextAttempt": null
    },
    "inventory_validation": {
      "name": "inventory_validation",
      "state": "HALF_OPEN",
      "failureCount": 3,
      "successCount": 1,
      "lastError": "Timeout exceeded",
      "nextAttempt": "2026-03-29T10:35:45.123Z"
    }
  }
}
```

### Reset Specific Circuit Breaker
```bash
curl -X POST http://localhost:5000/api/inventory/monitoring/circuit-breakers/inventory_reconciliation/reset \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json"
```

### Get Reconciliation Report
```bash
curl -X GET "http://localhost:5000/api/inventory/reconciliation/report?limit=50" \
  -H "Authorization: Bearer <token>"
```

**Response:**
```json
{
  "restaurantId": "507f1f77bcf86cd799439011",
  "generatedAt": "2026-03-29T10:30:45.123Z",
  "totalOrdersWithInconsistencies": 12,
  "summary": {
    "criticalViolations": 2,
    "warningViolations": 10,
    "totalRecommendations": 12
  },
  "orders": [
    {
      "orderId": "507f1f77bcf86cd799439012",
      "tableNumber": 5,
      "floorNumber": 2,
      "completedAt": "2026-03-28T15:30:00.000Z",
      "inconsistencyCount": 2,
      "latestInconsistency": {
        "cycle": 1,
        "timestamp": "2026-03-28T15:35:00.000Z",
        "error": "insufficient_available_stock"
      },
      "severity": "warning"
    }
  ]
}
```

### Get Violation Analytics
```bash
curl -X GET "http://localhost:5000/api/inventory/reconciliation/violations-analytics?daysBack=30" \
  -H "Authorization: Bearer <token>"
```

### Clear Order Inconsistencies
```bash
curl -X POST http://localhost:5000/api/inventory/reconciliation/orders/507f1f77bcf86cd799439012/clear \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json"
```

## Production Deployment Checklist

### Pre-Deployment
- [ ] Set up Redis for distributed locking
- [ ] Configure MongoDB indexes
- [ ] Set environment variables (see `.env.production.example`)
- [ ] Test circuit breaker reset endpoints
- [ ] Verify startup validation passes
- [ ] Enable audit logging

### Deployment
- [ ] Deploy code to all instances
- [ ] Wait for all instances to start
- [ ] Verify leader election is working
- [ ] Check reconciliation runs on schedule
- [ ] Monitor circuit breaker status

### Post-Deployment
- [ ] Access monitoring dashboard
- [ ] Review startup validation logs
- [ ] Monitor first reconciliation cycle
- [ ] Set up alerting on critical violations
- [ ] Test manual reconciliation action

## Troubleshooting

### Circuit Breaker Stuck in OPEN
**Symptom:** Reconciliation not running, circuit breaker shows OPEN

**Solution:**
```bash
curl -X POST http://localhost:5000/api/inventory/monitoring/circuit-breakers/inventory_reconciliation/reset \
  -H "Authorization: Bearer <token>"
```

**Root Cause Investigation:**
1. Check logs for `circuit_breaker_failure` events
2. Review `lastError` in circuit breaker status
3. Check if Redis is accessible
4. Verify database connections

### Reconciliation Timeout
**Symptom:** Logs show `reconciliation_timeout_approaching` warnings

**Solution:**
- Increase `RECONCILIATION_TIMEOUT_MS`
- Reduce `INVENTORY_RECONCILIATION_INTERVAL_MINUTES` for less data per cycle
- Check database query performance

### Orphaned Reservations
**Symptom:** Startup validation shows orphaned reservations

**Solution:**
1. Review inconsistent orders
2. Check order status in database
3. Manually clear inconsistencies for old orders
4. Contact support if pattern continues

## Performance Optimization

### Query Performance
- Batch queries use single database roundtrip
- Reduced from O(n) to O(1) lookups
- Memory efficient with Map-based lookup tables

### Network Optimization
- Distributed locking reduces redundant work
- Circuit breaker fails fast without retry storms
- Timeout prevention prevents hanging connections

### Resource Usage
- Single leader prevents resource duplication
- Batch processing reduces memory footprint
- Timeout protection prevents runaway processes

## Security & Compliance

### Access Control
- All monitoring endpoints require owner/admin role
- Audit logging for all manual actions
- Role-based authorization enforced

### Data Protection
- All violations stored in InventoryViolation model
- Audit trail preserved for compliance
- Error messages sanitized in API responses

### Fault Tolerance
- Circuit breaker prevents cascading failures
- Retry logic with exponential backoff
- Graceful degradation under load

## Support & Monitoring

### Key Metrics to Monitor
- Circuit breaker state changes
- Reconciliation cycle duration
- Violation counts trend
- Order inconsistency resolution rate
- Database query performance

### Alerts to Set Up
- Circuit breaker opens (indicate service issue)
- Unresolved violations > 100 (data quality issue)
- Orphaned reservations > 10 (potential system issue)
- Reconciliation timeout (performance issue)

### Contact Support
If you encounter issues:
1. Collect logs from last 24 hours
2. Screenshot monitoring dashboard
3. Provide circuit breaker status
4. Share any error messages
