# Phase 24 Gate C6 — Work Breakdown Structure

**Date:** 2026-08-05  
**Gate:** C6 — Webhooks, Event Bus, ETag, Observability Foundation  
**Status:** PLANNING

---

## 1. WBS Overview

| ID | Work Package | Owner | Est. Hours | Dependencies |
|----|-------------|-------|------------|--------------|
| C6a | Event Bus | Backend | 3h | None |
| C6b | Webhook Framework | Backend | 4h | C6a |
| C6c | Webhook Retry + Signature | Backend | 2h | C6b |
| C6d | ETag / Conditional Requests | Backend | 2h | None |
| C6e | Observability Foundation | Backend | 3h | None |
| C6T | Testing (all sub-systems) | QA | 4h | C6a–C6e |
| C6D | Documentation | Tech Writer | 2h | C6a–C6e |
| C6R | Release | Release Mgr | 1h | C6T, C6D |
| **Total** | | | **21h** | |

---

## 2. Detailed WBS

### C6a — Event Bus (3h)

| Task | Hours | Deliverable |
|------|-------|-------------|
| Create `services/eventBus.js` | 1h | Event Bus singleton |
| Write `tests/eventBus.test.js` | 1h | 6 unit tests |
| Write `tests/eventBus.integration.test.js` | 1h | 2 integration tests |

### C6b — Webhook Framework (4h)

| Task | Hours | Deliverable |
|------|-------|-------------|
| Create `services/webhook.service.js` | 1.5h | Webhook CRUD + dispatch |
| Create `controllers/webhook.controller.js` | 0.5h | HTTP handlers |
| Create `routes/webhook.routes.js` | 1h | 5 endpoints + Swagger |
| Write `tests/webhook.test.js` | 0.5h | 7 unit tests |
| Write `tests/webhook.integration.test.js` | 0.5h | 2 integration tests |

### C6c — Webhook Retry + Signature (2h)

| Task | Hours | Deliverable |
|------|-------|-------------|
| Implement retry with exponential backoff | 0.5h | 3-attempt retry |
| Implement HMAC-SHA256 signing | 0.5h | Signature generation |
| Implement `verifySignature()` | 0.5h | Verification utility |
| Write retry + signature tests | 0.5h | 4 unit tests |

### C6d — ETag / Conditional Requests (2h)

| Task | Hours | Deliverable |
|------|-------|-------------|
| Create `middleware/etag.js` | 0.5h | ETag middleware |
| Write `tests/etag.test.js` | 0.5h | 5 unit tests |
| Write `tests/etag.integration.test.js` | 1h | 3 integration tests |

### C6e — Observability Foundation (3h)

| Task | Hours | Deliverable |
|------|-------|-------------|
| Create `services/metrics.service.js` | 1h | Metrics collection |
| Create `middleware/metrics.js` | 0.5h | Request metrics capture |
| Create `routes/metrics.routes.js` | 0.5h | 2 endpoints |
| Write `tests/metrics.test.js` | 0.5h | 4 unit tests |
| Write `tests/metrics.integration.test.js` | 0.5h | 2 integration tests |

### C6T — Testing (4h)

| Task | Hours | Deliverable |
|------|-------|-------------|
| Full regression suite | 1h | 350+ existing pass |
| New test execution | 1h | All new tests pass |
| Security test verification | 1h | No regressions |
| Performance validation | 1h | No degradation |

### C6D — Documentation (2h)

| Task | Hours | Deliverable |
|------|-------|-------------|
| Gate C6 Implementation Report | 0.5h | Report |
| Gate C6 Security Report | 0.5h | Report |
| Gate C6 Test Report | 0.5h | Report |
| Update Documentation/INDEX.md | 0.5h | Index |

### C6R — Release (1h)

| Task | Hours | Deliverable |
|------|-------|-------------|
| Final test run | 0.5h | 350+ pass |
| Gate C6 approval report | 0.5h | Report |

---

## 3. Milestones

| Milestone | Target | Gate |
|-----------|--------|------|
| Event Bus complete | Day 1 | C6a |
| Webhook Framework complete | Day 1–2 | C6b |
| ETag complete | Day 2 | C6d |
| Metrics complete | Day 2 | C6e |
| All tests pass | Day 2 | C6T |
| Documentation complete | Day 2 | C6D |
| Gate C6 approved | Day 2 | C6R |
