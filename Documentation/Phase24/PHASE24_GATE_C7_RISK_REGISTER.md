# Phase 24 Gate C7 — Risk Register

**Date:** 2026-08-05  
**Gate:** C7 — Background Jobs, Scheduler, Advanced Health, Error Tracking  
**Status:** PLANNING

---

## 1. Risk Matrix

| ID | Risk | Likelihood | Impact | Severity | Mitigation |
|----|------|-----------|--------|----------|------------|
| R1 | In-process job lost on process restart | Medium | Medium | Medium | Jobs persisted to `jobs.json`; queued jobs re-processed on startup |
| R2 | Scheduler timer leaks on shutdown | Low | Low | Low | `stop()` clears all timers; called from gracefulShutdown |
| R3 | Job worker blocks event loop | Medium | Medium | Medium | Default concurrency 1; long jobs should yield; documented |
| R4 | JSON fileStore write contention (jobs + audit + webhooks) | Medium | Low | Low | Synchronous write-through already proven in production; job rate modest |
| R5 | Error tracker dedup collision | Very Low | Low | Low | SHA-256 fingerprint; near-zero collision |
| R6 | Error tracker floods with user errors | Medium | Low | Low | Dedup by fingerprint bounds growth; status workflow enables cleanup |
| R7 | Health deep-endpoint cost | Low | Low | Low | Checks are O(1) file reads; no heavy computation |

---

## 2. Deferred Infrastructure Risk (Phase 25)

| Item | Risk if rushed now |
|------|--------------------|
| Redis/Bull | Breaks single-instance model; requires server deployment; new failure mode |
| OpenTelemetry | Collector dependency; zero value at single instance |
| Sentry | External SaaS; secrets/credentials; compliance |

**Decision:** Deferred by design. Not an omission — a deliberate architecture gate.

---

## 3. Rollback Plan

| Scenario | Action | Time |
|----------|--------|------|
| Job service error | Comment out worker start in server.js | 2 min |
| Scheduler error | Comment out scheduler start | 2 min |
| Health route conflict | Remove health.routes mount | 1 min |
| Error tracker issue | Remove capture call in errorHandler | 1 min |
| **Maximum rollback** | | **5 min** |

No schema migrations. No deployment changes. No dependency changes.

---

## 4. Risk Assessment Summary

| Category | Count |
|----------|-------|
| High | 0 |
| Medium | 4 |
| Low | 3 |

**Overall Risk Level: LOW**
