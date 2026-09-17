# Phase 24 Gate C7 — File Change Matrix

**Date:** 2026-08-05  
**Gate:** C7 — Background Jobs, Scheduler, Advanced Health, Error Tracking  
**Status:** PLANNING

---

## 1. Files Created

| # | File | Sub-system | Lines (est) |
|---|------|-----------|-------------|
| 1 | `services/job.service.js` | C7a | ~150 |
| 2 | `services/scheduler.service.js` | C7b | ~90 |
| 3 | `services/health.service.js` | C7c | ~80 |
| 4 | `routes/health.routes.js` | C7c | ~70 |
| 5 | `services/errorTracker.service.js` | C7d | ~90 |
| 6 | `controllers/errorTracker.controller.js` | C7d | ~40 |
| 7 | `routes/errorTracker.routes.js` | C7d | ~100 |
| 8 | `tests/job.test.js` | C7a | ~120 |
| 9 | `tests/job.integration.test.js` | C7a | ~60 |
| 10 | `tests/scheduler.test.js` | C7b | ~80 |
| 11 | `tests/health.service.test.js` | C7c | ~80 |
| 12 | `tests/health.integration.test.js` | C7c | ~60 |
| 13 | `tests/errorTracker.test.js` | C7d | ~100 |
| 14 | `tests/errorTracker.integration.test.js` | C7d | ~70 |

**Total new files: 14**

---

## 2. Files Modified (additive only)

| # | File | Change |
|---|------|--------|
| 1 | `services/eventBus.js` | Add `job.completed`, `job.failed` to EVENT_TYPES |
| 2 | `middleware/errorHandler.js` | Additive: call `errorTracker.capture()` in serverError |
| 3 | `server.js` | Mount health + error routes; start scheduler; scheduler stop in shutdown |
| 4 | `config/swagger.js` | Add health + error routes to apis; add tags |

---

## 3. Files NOT Modified (verified)

| File | Reason |
|------|--------|
| `ecosystem.config.js` | Single-instance deployment unchanged |
| `Dockerfile` | No new infra in image |
| `package.json` | Zero new dependencies |
| `utils/fileStore.js` | Persistence layer unchanged (new store names only) |
| `utils/logger.js` | Logging unchanged |
| `middleware/auth.js` | Auth unchanged |
| All existing routes/controllers/services | Except additive hooks listed above |

---

## 4. New Data Stores (via existing fileStore)

| Store | Purpose |
|-------|---------|
| `jobs.json` | Job records with status lifecycle |
| `errors.json` | Error issues with dedup fingerprint |

---

## 5. Impact Summary

| Category | Count |
|----------|-------|
| Created | 14 |
| Modified | 4 |
| Deleted | 0 |
| New dependencies | 0 |
| Breaking changes | 0 |
| Deployment changes | 0 |
