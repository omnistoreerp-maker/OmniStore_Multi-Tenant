# Phase 24 Gate C6 — File Change Matrix

**Date:** 2026-08-05  
**Gate:** C6 — Webhooks, Event Bus, ETag, Observability Foundation  
**Status:** PLANNING

---

## 1. Files Created (10)

| # | File | Sub-system | Lines (est) |
|---|------|-----------|-------------|
| 1 | `services/eventBus.js` | C6a | ~60 |
| 2 | `services/webhook.service.js` | C6b | ~120 |
| 3 | `controllers/webhook.controller.js` | C6b | ~50 |
| 4 | `routes/webhook.routes.js` | C6b | ~120 |
| 5 | `middleware/etag.js` | C6d | ~40 |
| 6 | `services/metrics.service.js` | C6e | ~80 |
| 7 | `middleware/metrics.js` | C6e | ~30 |
| 8 | `routes/metrics.routes.js` | C6e | ~60 |
| 9 | `tests/eventBus.test.js` | C6a | ~80 |
| 10 | `tests/eventBus.integration.test.js` | C6a | ~40 |

**Additional test files (5):**

| # | File | Sub-system |
|---|------|-----------|
| 11 | `tests/webhook.test.js` | C6b |
| 12 | `tests/webhook.integration.test.js` | C6b |
| 13 | `tests/etag.test.js` | C6d |
| 14 | `tests/etag.integration.test.js` | C6d |
| 15 | `tests/metrics.test.js` | C6e |
| 16 | `tests/metrics.integration.test.js` | C6e |

**Total new files: 16**

---

## 2. Files Modified (3)

| # | File | Change |
|---|------|--------|
| 1 | `server.js` | Import eventBus; mount webhook + metrics routes; wire event→webhook dispatch |
| 2 | `config/index.js` | Add `webhookTimeout`, `webhookMaxRetries`, `metricsEnabled` |
| 3 | `config/swagger.js` | Add webhook.routes.js + metrics.routes.js to apis list |

---

## 3. Files NOT Modified (verified)

| File | Reason |
|------|--------|
| `services/audit.service.js` | Audit logging already complete; event bus integration optional |
| `middleware/audit.js` | Correlation ID already complete |
| `utils/fileStore.js` | Persistence layer unchanged |
| `utils/logger.js` | Logging unchanged |
| `middleware/auth.js` | Auth unchanged |
| `middleware/apiKeyAuth.js` | API key auth unchanged |
| `middleware/security.js` | Rate limiting unchanged |
| `routes/*.routes.js` | Existing routes unchanged |
| `controllers/*.controllers.js` | Existing controllers unchanged |

---

## 4. New npm Dependencies

**NONE** — all implementations use Node.js built-in modules:
- `events` (EventEmitter) — C6a
- `crypto` (HMAC-SHA256) — C6b, C6d
- `node:fetch` or `undici` (HTTP) — C6b (outbound webhooks)

---

## 5. File Impact Summary

| Category | Count |
|----------|-------|
| Created | 16 |
| Modified | 3 |
| Deleted | 0 |
| **Total touched** | **19** |
| Existing files changed | 3 |
| Breaking changes | 0 |
