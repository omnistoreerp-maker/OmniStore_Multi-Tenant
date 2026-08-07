# Phase 24 Gate C6 — Implementation Blueprint

**Date:** 2026-08-05  
**Gate:** C6 — Webhooks, Event Bus, ETag, Observability Foundation  
**Status:** PLANNING

---

## 1. Implementation Overview

Gate C6 implements 4 independent sub-systems that compose into a cohesive observability and integration layer. Each sub-system is designed to be independently testable and deployable.

### Dependency Graph

```
Event Bus (C6a) ──→ Webhook Framework (C6b) ──→ Retry + Signature (C6c)
                                                        
ETag (C6d) ←── independent                            
                                                        
Metrics (C6e) ←── independent                          
```

**Implementation Order:**
1. **C6a** — Event Bus (foundation, no deps)
2. **C6b** — Webhook Framework (depends on Event Bus)
3. **C6c** — Webhook Retry + Signature (extends Webhook Framework)
4. **C6d** — ETag / Conditional Requests (independent)
5. **C6e** — Observability Foundation / Metrics (independent)

---

## 2. C6a — Event Bus

### 2.1 Files

| File | Action | Purpose |
|------|--------|---------|
| `services/eventBus.js` | CREATE | EventEmitter wrapper with type safety |
| `tests/eventBus.test.js` | CREATE | Unit tests |
| `tests/eventBus.integration.test.js` | CREATE | Integration tests |

### 2.2 Design

```javascript
// services/eventBus.js
const { EventEmitter } = require('events');

const EVENT_TYPES = [
  'sale.created', 'sale.updated', 'sale.deleted',
  'inventory.updated', 'inventory.low',
  'user.created', 'user.updated', 'user.deleted',
  'api_key.created', 'api_key.revoked',
  'webhook.delivery.failed'
];

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this._history = []; // last 1000 events
  }

  publish(eventType, data) {
    if (!EVENT_TYPES.includes(eventType)) {
      throw new Error(`Invalid event type: ${eventType}`);
    }
    const event = { type: eventType, data, timestamp: new Date().toISOString() };
    this._history.push(event);
    if (this._history.length > 1000) this._history.shift();
    this.emit(eventType, event);
    return event;
  }

  subscribe(eventType, handler) {
    if (!EVENT_TYPES.includes(eventType)) {
      throw new Error(`Invalid event type: ${eventType}`);
    }
    this.on(eventType, handler);
  }

  unsubscribe(eventType, handler) {
    this.removeListener(eventType, handler);
  }

  getHistory(limit = 50) {
    return this._history.slice(-limit);
  }
}

module.exports = new EventBus(); // singleton
```

### 2.3 Integration Points

- `services/audit.service.js` — emit `audit.created` after recording (optional)
- `server.js` — no changes needed (singleton, lazy-loaded)

### 2.4 Test Coverage

| Test | Type |
|------|------|
| publish dispatches to subscribers | Unit |
| publish rejects invalid event types | Unit |
| subscribe/unsubscribe works | Unit |
| event history maintained (max 1000) | Unit |
| concurrent subscribers receive same event | Unit |
| integration: sale.created triggers webhook dispatch | Integration |

---

## 3. C6b — Webhook Framework

### 3.1 Files

| File | Action | Purpose |
|------|--------|---------|
| `services/webhook.service.js` | CREATE | Webhook CRUD + dispatch |
| `controllers/webhook.controller.js` | CREATE | HTTP handlers |
| `routes/webhook.routes.js` | CREATE | REST endpoints with Swagger |
| `tests/webhook.test.js` | CREATE | Unit tests |
| `tests/webhook.integration.test.js` | CREATE | Integration tests |

### 3.2 Design

```javascript
// services/webhook.service.js
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const fileStore = require('../utils/fileStore');

const STORE_NAME = 'webhooks';
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 30000]; // ms

function register({ url, events, secret }) {
  const store = fileStore.read(STORE_NAME);
  if (!store.entries) store.entries = [];
  const webhook = {
    id: uuidv4(),
    url,
    events, // ['sale.created', 'inventory.low']
    secret: secret || crypto.randomBytes(32).toString('hex'),
    active: true,
    createdAt: new Date().toISOString()
  };
  store.entries.push(webhook);
  fileStore.write(STORE_NAME, store);
  return { ...webhook, secret: undefined }; // never return secret
}

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

async function dispatch(eventType, payload) {
  const store = fileStore.read(STORE_NAME);
  const hooks = (store.entries || []).filter(
    h => h.active && h.events.includes(eventType)
  );
  for (const hook of hooks) {
    _deliverWithRetry(hook, eventType, payload);
  }
}

async function _deliverWithRetry(hook, eventType, payload, attempt = 0) {
  const body = { event: eventType, data: payload, timestamp: new Date().toISOString() };
  const signature = signPayload(body, hook.secret);
  try {
    await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Event': eventType,
        'X-Webhook-Delivery': uuidv4()
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
  } catch (err) {
    if (attempt < MAX_RETRIES - 1) {
      setTimeout(() => _deliverWithRetry(hook, eventType, payload, attempt + 1), RETRY_DELAYS[attempt]);
    }
  }
}
```

### 3.3 Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/v1/webhooks` | Register webhook | Bearer JWT |
| GET | `/api/v1/webhooks` | List webhooks | Bearer JWT |
| GET | `/api/v1/webhooks/:id` | Get webhook | Bearer JWT |
| DELETE | `/api/v1/webhooks/:id` | Remove webhook | Bearer JWT |
| POST | `/api/v1/webhooks/:id/test` | Send test event | Bearer JWT |

### 3.4 Test Coverage

| Test | Type |
|------|------|
| register creates webhook | Unit |
| register never returns secret | Unit |
| signPayload produces valid HMAC | Unit |
| dispatch calls subscribed webhooks | Unit |
| dispatch ignores unsubscribed events | Unit |
| retry on failure (3 attempts) | Unit |
| integration: full webhook lifecycle | Integration |
| integration: test event delivery | Integration |

---

## 4. C6c — ETag / Conditional Requests

### 4.1 Files

| File | Action | Purpose |
|------|--------|---------|
| `middleware/etag.js` | CREATE | ETag generation + 304 handling |
| `tests/etag.test.js` | CREATE | Unit tests |
| `tests/etag.integration.test.js` | CREATE | Integration tests |

### 4.2 Design

```javascript
// middleware/etag.js
const crypto = require('crypto');

// Generate ETag from response body
function generateETag(body) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return `"${hash.substring(0, 16)}"`; // short hash
}

// Middleware: intercept res.json to add ETag + 304 handling
function etagMiddleware(req, res, next) {
  if (req.method !== 'GET') return next();

  const originalJson = res.json.bind(res);
  res.json = function(body) {
    const etag = generateETag(body);
    res.setHeader('ETag', etag);

    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === etag) {
      return res.status(304).end();
    }

    return originalJson(body);
  };
  next();
}

module.exports = { etagMiddleware, generateETag };
```

### 4.3 Exclusions

- `POST /api/v1/auth/*` — auth endpoints (tokens change frequently)
- `POST /api/v1/auth/login` — login responses
- `GET /api/v1/metrics` — metrics change every request
- `GET /api/v1/audit-log` — audit logs change frequently

### 4.4 Test Coverage

| Test | Type |
|------|------|
| generateETag produces consistent hash | Unit |
| ETag header set on GET responses | Unit |
| 304 returned when If-None-Match matches | Unit |
| 200 returned when If-None-Match differs | Unit |
| POST requests skip ETag | Unit |
| integration: GET /api/v1/sales with ETag | Integration |
| integration: 304 on repeated request | Integration |

---

## 5. C6e — Observability Foundation (Metrics)

### 5.1 Files

| File | Action | Purpose |
|------|--------|---------|
| `services/metrics.service.js` | CREATE | In-process metrics collection |
| `middleware/metrics.js` | CREATE | Request metrics capture |
| `routes/metrics.routes.js` | CREATE | /metrics endpoint |
| `tests/metrics.test.js` | CREATE | Unit tests |
| `tests/metrics.integration.test.js` | CREATE | Integration tests |

### 5.2 Design

```javascript
// services/metrics.service.js
class MetricsService {
  constructor() {
    this.counters = {};
    this.histograms = {};
    this.gauges = {};
  }

  incrementCounter(name, labels = {}) {
    const key = this._key(name, labels);
    this.counters[key] = (this.counters[key] || 0) + 1;
  }

  observeHistogram(name, value, labels = {}) {
    const key = this._key(name, labels);
    if (!this.histograms[key]) this.histograms[key] = [];
    this.histograms[key].push(value);
    if (this.histograms[key].length > 1000) this.histograms[key].shift();
  }

  setGauge(name, value, labels = {}) {
    const key = this._key(name, labels);
    this.gauges[key] = value;
  }

  getMetrics() {
    return {
      counters: { ...this.counters },
      histograms: this._summarizeHistograms(),
      gauges: { ...this.gauges }
    };
  }

  toPrometheus() {
    // Prometheus text format
    let lines = [];
    for (const [key, val] of Object.entries(this.counters)) {
      lines.push(`# TYPE ${key} counter`);
      lines.push(`${key} ${val}`);
    }
    for (const [key, val] of Object.entries(this.gauges)) {
      lines.push(`# TYPE ${key} gauge`);
      lines.push(`${key} ${val}`);
    }
    return lines.join('\n');
  }
}
```

### 5.3 Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v1/metrics` | Prometheus text format | Bearer JWT |
| GET | `/api/v1/metrics/json` | JSON format | Bearer JWT |

### 5.4 Metrics Collected

| Metric | Type | Labels |
|--------|------|--------|
| `http_requests_total` | Counter | method, path, status |
| `http_request_duration_ms` | Histogram | method, path |
| `http_errors_total` | Counter | path, status |
| `memory_usage_bytes` | Gauge | — |
| `uptime_seconds` | Gauge | — |

### 5.5 Test Coverage

| Test | Type |
|------|------|
| incrementCounter increments correctly | Unit |
| observeHistogram tracks values | Unit |
| setGauge stores value | Unit |
| toPrometheus produces valid format | Unit |
| integration: /metrics returns metrics | Integration |
| integration: /metrics/json returns JSON | Integration |

---

## 6. Configuration Changes

| File | Change |
|------|--------|
| `config/index.js` | Add `webhookTimeout`, `webhookMaxRetries`, `metricsEnabled` |
| `server.js` | Import eventBus, mount webhook + metrics routes, wire event→webhook |
| `config/swagger.js` | Add webhook.routes.js + metrics.routes.js |

---

## 7. Gate C6 Blueprint Sign-Off

- [x] All designs are additive-only
- [x] No existing files modified (except config + server.js mount)
- [x] No breaking changes
- [x] No new npm dependencies (Node.js built-in only)
- [x] All components independently testable
- [x] Backward compatibility preserved
