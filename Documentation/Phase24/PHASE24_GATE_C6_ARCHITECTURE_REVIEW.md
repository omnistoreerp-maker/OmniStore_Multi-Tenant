# Phase 24 Gate C6 — Architecture Review & Gap Analysis

**Date:** 2026-08-05  
**Gate:** C6 — Webhooks, Event Bus, ETag, Observability Foundation  
**Status:** PLANNING

---

## 1. Executive Summary

Gate C6 addresses five confirmed gaps in the DigiTronics V2 Enterprise backend: Webhook Framework, Event Bus, HTTP ETag/Conditional Requests, Webhook Retry Strategy with Signature Verification, and Observability Foundation. All gaps verified via evidence-based codebase audit. No existing functionality will be modified or replaced.

---

## 2. Existing Implementation Verification

### 2.1 What EXISTS (verified)

| Component | Location | Evidence |
|-----------|----------|----------|
| Express.js backend | `server.js` | 175 lines, production stable |
| JWT auth | `utils/jwt.js` | Token generation + verification |
| RBAC | `middleware/authorize.js` | Role-based access control |
| OAuth2 | `middleware/passport.js` | Google + GitHub providers |
| MFA | `services/mfa.service.js` | TOTP + backup codes |
| API Keys | `services/apiKey.service.js` | SHA-256 hashed, lifecycle mgmt |
| Audit logging | `services/audit.service.js` | POST/PUT/PATCH/DELETE capture |
| Request correlation | `middleware/audit.js` | X-Request-Id on all responses |
| Health probes | `routes/index.js:23-79` | /health, /liveness, /ready |
| Structured logger | `utils/logger.js` | File + console, 5 levels |
| Slow-request logger | `middleware/errorHandler.js:18-30` | Configurable threshold |
| Swagger/OpenAPI | `config/swagger.js` | swagger-jsdoc + UI |
| JSON persistence | `utils/fileStore.js` | mtime+size cache |
| Graceful shutdown | `server.js:134-148` | SIGINT/SIGTERM handlers |

### 2.2 What is CONFIRMED MISSING

| Gap | Evidence |
|-----|----------|
| Webhooks | Zero files, zero routes, zero references in codebase |
| Event Bus | Zero EventEmitter usage, zero pub/sub patterns |
| ETag/Conditional Requests | Only Express default; `docs/PERFORMANCE_REVIEW.md:17` explicitly rejected as out of scope |
| Background Jobs | No queue, no cron, no scheduler packages |
| Error Tracking | Console/file logging only; no Sentry, Bugsnag, or aggregation |
| Metrics Collection | No Prometheus, StatsD, or request-level metrics |
| Distributed Tracing | No OpenTelemetry, Jaeger, or span tracking |

---

## 3. Gate C6 Scope Definition

### 3.1 In Scope

| Feature | Priority | Dependencies |
|---------|----------|--------------|
| Event Bus (internal pub/sub) | P0 — foundational | None |
| Webhook Framework | P0 | Event Bus |
| Webhook Retry Strategy | P0 | Webhook Framework |
| Webhook Signature Verification | P0 | Webhook Framework |
| HTTP ETag / Conditional Requests | P1 | None |
| Observability Foundation (metrics) | P1 | None |

### 3.2 Out of Scope (explicitly excluded)

| Feature | Reason |
|---------|--------|
| Distributed Tracing (OpenTelemetry) | Requires external collector; defer to Phase 25 |
| Background Job Queue | Requires Redis/Bull; defer to Phase 25 |
| Error Tracking (Sentry) | Requires external service; defer to Phase 25 |
| Dashboard/Visualization | Requires Grafana/Prometheus stack; defer to Phase 25 |
| WebSocket/Real-time | Requires connection management; defer to Phase 25 |

---

## 4. Architecture Review

### 4.1 Event Bus Design

**Pattern:** In-process EventEmitter (Node.js built-in)

**Rationale:**
- No external dependencies (Redis, RabbitMQ)
- Compatible with JSON file persistence
- Single-process deployment (PM2 fork mode)
- Can be upgraded to external broker later

**Architecture:**
```
services/eventBus.js
├── EventEmitter (Node.js built-in)
├── Event types: enum of allowed event names
├── subscribe(event, handler) — register listener
├── publish(event, data) — dispatch to all listeners
├── unsubscribe(event, handler) — remove listener
└── Event history (in-memory, last 1000 events)
```

**Event Types (Phase 1):**
- `sale.created`, `sale.updated`, `sale.deleted`
- `inventory.updated`, `inventory.low`
- `user.created`, `user.updated`, `user.deleted`
- `api_key.created`, `api_key.revoked`
- `webhook.delivery.failed`

### 4.2 Webhook Framework Design

**Pattern:** Outbound HTTP webhooks with signature verification

**Architecture:**
```
services/webhook.service.js
├── register(url, events, secret) — store webhook endpoint
├── unregister(id) — remove webhook
├── dispatch(event, payload) — send to all subscribed URLs
├── verifySignature(payload, secret) — HMAC-SHA256 verification
└── Retry with exponential backoff (3 attempts)

middleware/webhookAuth.js
├── Verify incoming webhook signatures (for webhook consumers)

routes/webhook.routes.js
├── POST /api/v1/webhooks — register
├── GET /api/v1/webhooks — list
├── GET /api/v1/webhooks/:id — get
├── DELETE /api/v1/webhooks/:id — remove
└── POST /api/v1/webhooks/:id/test — send test event
```

### 4.3 ETag / Conditional Requests Design

**Pattern:** ETag generation + If-None-Match handling

**Architecture:**
```
middleware/etag.js
├── generateETag(body) — SHA-256 hash of response body
├── setETagHeader(res, etag) — set ETag header
├── checkIfNoneMatch(req, etag) — compare If-None-Match
└── 304 Not Modified response when match

Applied to: GET /api/v1/* routes only
Excluded: POST, PUT, PATCH, DELETE, auth endpoints
```

### 4.4 Observability Foundation Design

**Pattern:** In-process metrics collection + /metrics endpoint

**Architecture:**
```
services/metrics.service.js
├── Counter: request_count (method, path, status)
├── Histogram: request_duration (method, path)
├── Counter: error_count (path, status)
├── Gauge: active_connections
├── Gauge: memory_usage
├── getMetrics() — return all metrics
└── Prometheus-compatible text format

routes/metrics.routes.js
├── GET /api/v1/metrics — Prometheus text format
└── GET /api/v1/metrics/json — JSON format for dashboards
```

---

## 5. Gap Analysis Summary

| Gap | Exists | Proposed | Impact |
|-----|--------|----------|--------|
| Event Bus | No | In-process EventEmitter | Low — no external deps |
| Webhooks | No | Outbound HTTP + HMAC signing | Medium — outbound HTTP |
| ETag | No (Express default) | Custom middleware for GET routes | Low — additive only |
| Retry Strategy | No | Exponential backoff (3 attempts) | Low — in webhook service |
| Signature Verification | No | HMAC-SHA256 | Low — crypto built-in |
| Metrics | No | In-process counters + /metrics | Low — no external deps |
| Error Tracking | No | **DEFERRED** — Phase 25 | — |
| Distributed Tracing | No | **DEFERRED** — Phase 25 | — |

---

## 6. Gate C6 Architecture Sign-Off

- [x] All existing components verified
- [x] No duplicate implementations proposed
- [x] No breaking changes
- [x] Additive-only design
- [x] Backward compatibility preserved
- [x] Evidence-based gap analysis complete
