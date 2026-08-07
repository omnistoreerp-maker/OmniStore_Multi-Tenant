# Phase 24 Gate C6 — Release Plan

**Date:** 2026-08-05  
**Gate:** C6 — Webhooks, Event Bus, ETag, Observability Foundation  
**Status:** PLANNING

---

## 1. Release Scope

| Component | Status | New Files | Modified Files |
|-----------|--------|-----------|----------------|
| Event Bus | New | 1 | 0 |
| Webhook Framework | New | 3 | 0 |
| ETag Middleware | New | 1 | 0 |
| Observability Metrics | New | 3 | 0 |
| Tests | New | 8 | 0 |
| Config/Server | Modified | 0 | 3 |
| Documentation | New | 5 | 1 |

---

## 2. Pre-Release Checklist

| Step | Status | Owner |
|------|--------|-------|
| All 350 existing tests pass | Pending | QA |
| All 31 new tests pass | Pending | QA |
| Security review complete | Pending | Security |
| Swagger docs updated | Pending | Tech Writer |
| No breaking changes verified | Pending | Architect |
| Rollback plan defined | Pending | Release Mgr |
| Documentation updated | Pending | Tech Writer |

---

## 3. Release Strategy

**Approach:** Additive-only release

- All new files are independently loadable
- No existing behavior changed
- Server.js mounts new routes (additive)
- Config adds new keys (additive, optional)
- Event Bus is optional (graceful degradation if not wired)

---

## 4. Rollback Plan

| Scenario | Action |
|----------|--------|
| New routes fail to mount | Comment out 3 lines in server.js |
| Event Bus errors | Remove eventBus import + wire |
| Webhook dispatch fails | Webhooks are async/fire-and-forget; no user impact |
| ETag causes issues | Remove etagMiddleware from server.js |
| Metrics overhead | Remove metricsMiddleware from server.js |

**Rollback time:** < 5 minutes (comment out imports + middleware)

---

## 5. Post-Release Monitoring

| Check | Frequency | Action |
|-------|-----------|--------|
| Test suite | Every commit | 381+ pass |
| Memory usage | Daily | < 512MB |
| Error rate | Daily | < 0.1% |
| Webhook delivery rate | Daily | > 99% |
| Audit log integrity | Weekly | JSON valid |

---

## 6. Release Notes (Draft)

### Gate C6 — Webhooks, Event Bus, ETag, Observability Foundation

**New Features:**
- **Event Bus:** In-process pub/sub event system for decoupled component communication
- **Webhook Framework:** Register HTTP endpoints to receive events; HMAC-SHA256 signature verification
- **Webhook Retry:** Exponential backoff (3 attempts) for failed deliveries
- **ETag / Conditional Requests:** GET responses include ETag header; 304 Not Modified for cached responses
- **Observability Metrics:** /metrics endpoint with request counts, durations, and memory usage

**New Endpoints:**
- `POST /api/v1/webhooks` — Register webhook
- `GET /api/v1/webhooks` — List webhooks
- `GET /api/v1/webhooks/:id` — Get webhook
- `DELETE /api/v1/webhooks/:id` — Remove webhook
- `POST /api/v1/webhooks/:id/test` — Send test event
- `GET /api/v1/metrics` — Prometheus metrics
- `GET /api/v1/metrics/json` — JSON metrics

**Backward Compatibility:** All existing endpoints unchanged. No breaking changes.
