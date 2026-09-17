# Phase 24 Gate C6 — Risk Register

**Date:** 2026-08-05  
**Gate:** C6 — Webhooks, Event Bus, ETag, Observability Foundation  
**Status:** PLANNING

---

## 1. Risk Matrix

| ID | Risk | Likelihood | Impact | Severity | Mitigation |
|----|------|-----------|--------|----------|------------|
| R1 | Webhook outbound HTTP fails (network, timeout) | High | Low | Medium | 3-attempt retry with backoff; fire-and-forget; no user-facing impact |
| R2 | Event Bus memory leak (history grows) | Low | Low | Low | Max 1000 entries; FIFO eviction |
| R3 | ETag hash collision (false 304) | Very Low | Medium | Low | SHA-256 truncated to 16 hex chars; 2^64 space |
| R4 | Metrics collection degrades performance | Low | Medium | Medium | In-memory counters only; < 0.1ms overhead per request |
| R5 | Webhook secret leaked in logs/response | Low | High | Medium | Secret never returned in API; never logged |
| R6 | Signature verification bypass | Very Low | High | Medium | HMAC-SHA256; timing-safe comparison |
| R7 | Event Bus singleton state leak between tests | Medium | Low | Low | Jest module reset; singleton per test |
| R8 | Express default ETag conflicts with custom ETag | Low | Low | Low | Custom middleware overrides at app level |

---

## 2. Risk Assessment Summary

| Category | Count |
|----------|-------|
| High risk | 0 |
| Medium risk | 4 |
| Low risk | 4 |
| Very Low risk | 0 |

**Overall Risk Level: LOW**

---

## 3. Mitigation Details

### R1 — Webhook Delivery Failure

- Exponential backoff: 1s → 5s → 30s
- 10-second timeout per attempt
- Failure logged but not propagated
- User operation completes regardless of webhook status
- Webhook delivery is asynchronous (non-blocking)

### R5 — Secret Leakage Prevention

- `webhook.service.register()` returns `{ ...webhook, secret: undefined }`
- Secret stored in fileStore only
- Never included in list/get responses
- Never logged by structured logger
- HMAC signing uses secret in memory only

### R6 — Signature Verification

- `crypto.createHmac('sha256', secret).update(payload).digest('hex')`
- Comparison uses `crypto.timingSafeEqual()` to prevent timing attacks
- Signature format: `sha256=<hex>`

---

## 4. Rollback Risk

| Scenario | Risk Level | Rollback Time |
|----------|-----------|---------------|
| New routes fail to mount | Low | 2 min |
| Event Bus errors | Low | 2 min |
| Webhook dispatch fails | Low | 0 min (async) |
| ETag causes 304 loops | Medium | 2 min |
| Metrics overhead | Low | 2 min |

**Maximum rollback time: 5 minutes**
