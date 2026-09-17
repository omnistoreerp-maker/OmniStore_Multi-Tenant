# Phase 24 Gate C6 — Test Execution Plan

**Date:** 2026-08-05  
**Gate:** C6 — Webhooks, Event Bus, ETag, Observability Foundation  
**Status:** PLANNING

---

## 1. Test Strategy

| Test Type | Scope | Target |
|-----------|-------|--------|
| Unit | Service logic, middleware, utilities | 100% path coverage |
| Integration | HTTP endpoints, cross-system | All endpoints |
| Regression | Existing 350 tests | 350/350 pass |
| Security | Auth, signature, injection | Zero vulnerabilities |
| Backward Compatibility | All existing endpoints | No breaking changes |

---

## 2. New Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `tests/eventBus.test.js` | 6 | Event Bus pub/sub, validation, history |
| `tests/eventBus.integration.test.js` | 2 | Event→webhook integration |
| `tests/webhook.test.js` | 7 | CRUD, dispatch, signature, retry |
| `tests/webhook.integration.test.js` | 2 | Full webhook lifecycle |
| `tests/etag.test.js` | 5 | ETag generation, 304 handling |
| `tests/etag.integration.test.js` | 3 | GET with ETag headers |
| `tests/metrics.test.js` | 4 | Counter, histogram, gauge, Prometheus |
| `tests/metrics.integration.test.js` | 2 | /metrics endpoint |
| **Total new** | **31** | |

---

## 3. Regression Test Matrix

| Suite | Tests | Must Pass |
|-------|-------|-----------|
| auth.test.js | 15 | Yes |
| authorize.test.js | 12 | Yes |
| mfa.test.js | 20 | Yes |
| oauth.test.js | 18 | Yes |
| apiKey.test.js | 21 | Yes |
| apiKey.integration.test.js | 17 | Yes |
| audit.test.js | 14 | Yes |
| audit.integration.test.js | 8 | Yes |
| sales.test.js | 25 | Yes |
| purchases.test.js | 22 | Yes |
| inventory.test.js | 20 | Yes |
| users.test.js | 18 | Yes |
| health.test.js | 8 | Yes |
| security.test.js | 12 | Yes |
| helpers.test.js | 10 | Yes |
| All other suites | 118 | Yes |
| **Total existing** | **350** | **350/350** |

---

## 4. Execution Order

| Step | Command | Expected |
|------|---------|----------|
| 1 | `npx jest tests/eventBus.test.js` | 6 pass |
| 2 | `npx jest tests/webhook.test.js` | 7 pass |
| 3 | `npx jest tests/etag.test.js` | 5 pass |
| 4 | `npx jest tests/metrics.test.js` | 4 pass |
| 5 | `npx jest tests/eventBus.integration.test.js` | 2 pass |
| 6 | `npx jest tests/webhook.integration.test.js` | 2 pass |
| 7 | `npx jest tests/etag.integration.test.js` | 3 pass |
| 8 | `npx jest tests/metrics.integration.test.js` | 2 pass |
| 9 | `npx jest --forceExit` | 381+ pass (350 + 31 new) |

---

## 5. Security Test Checklist

| Check | Method |
|-------|--------|
| Webhook secret never returned in API | GET /webhooks returns no `secret` field |
| Signature verification prevents forgery | Tampered signature rejected |
| Rate limiting on webhook registration | Existing rate limiter applies |
| No SQL/No injection in webhook URL | URL validation |
| Auth required on all new endpoints | 401 without token |
| ETag does not leak sensitive data | Hash is truncated SHA-256 |

---

## 6. Performance Validation

| Check | Target |
|-------|--------|
| Event Bus publish latency | < 1ms |
| Webhook dispatch (non-blocking) | < 10ms initial |
| ETag generation | < 1ms |
| Metrics collection overhead | < 0.1ms per request |
| Memory overhead | < 5MB |

---

## 7. Gate C6 Test Sign-Off Criteria

- [ ] All 350 existing tests pass
- [ ] All 31 new tests pass
- [ ] Total: 381+ tests, 0 failures
- [ ] Security checklist complete
- [ ] Performance within targets
- [ ] No breaking changes verified
