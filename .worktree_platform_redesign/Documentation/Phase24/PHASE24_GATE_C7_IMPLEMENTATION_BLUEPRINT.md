# Phase 24 Gate C7 — Implementation Blueprint

**Date:** 2026-08-05  
**Gate:** C7 — Background Jobs, Scheduler, Advanced Health, Error Tracking  
**Status:** PLANNING

---

## 1. Implementation Overview

Four additive subsystems, all in-process, zero new npm dependencies, no deployment change. Implementation order respects dependencies.

### Dependency Graph

```
Job Service (C7a) ──→ Scheduler (C7b) uses Job Service
Health Service (C7c) ←── independent (reads job/audit/metrics)
Error Tracker (C7d) ←── independent
```

**Order:** C7a → C7b → C7c → C7d

---

## 2. C7a — Background Job Framework

### 2.1 Files

| File | Action |
|------|--------|
| `services/job.service.js` | CREATE |
| `tests/job.test.js` | CREATE |
| `tests/job.integration.test.js` | CREATE |

### 2.2 Design

```javascript
// services/job.service.js
const STORE_NAME = 'jobs';
// Job: { id, type, payload, status, priority, attempts, maxAttempts,
//        createdAt, startedAt, finishedAt, error, result }

enqueue(type, payload, { priority=0, delayMs=0, maxAttempts=3 })
  → persists job { status: 'queued' }

startWorker({ concurrency=1, pollMs=500 })
  → setInterval loop: pick highest-priority queued job, run processor
  → processor: async (job) => Promise
  → on success: status 'completed'; on error: attempts++, retry or 'failed'
  → emits job.completed / job.failed via eventBus

getStats() → { queued, running, completed, failed, total }
```

### 2.3 Events (extend eventBus EVENT_TYPES)

- `job.completed`
- `job.failed`

### 2.4 Concurrency Constraint

Worker concurrency **1** by default — safe with JSON fileStore (single writer). Configurable but recommended locked to 1.

---

## 3. C7b — Task Scheduler

### 3.1 Files

| File | Action |
|------|--------|
| `services/scheduler.service.js` | CREATE |
| `tests/scheduler.test.js` | CREATE |

### 3.2 Design

```javascript
// services/scheduler.service.js
// Supports: interval (ms), cron-like via 'every X unit', or '@daily'/'@hourly'
register(name, spec, handler) → validates spec
start() → schedules all registered tasks using setTimeout/setInterval
stop() → clears all timers (called from gracefulShutdown)
listTasks() → { name, spec, nextRunAt, lastRunAt, lastStatus }
```

### 3.3 Built-in Scheduled Task (additive example)

- **Audit log retention** — no-op default; demonstrates registration only.

### 3.4 Shutdown Integration

`server.js` gracefulShutdown hook calls `schedulerService.stop()` before `finish()`.

---

## 4. C7c — Advanced Health Monitoring

### 4.1 Files

| File | Action |
|------|--------|
| `services/health.service.js` | CREATE |
| `routes/health.routes.js` | CREATE |
| `tests/health.service.test.js` | CREATE |
| `tests/health.integration.test.js` | CREATE |

### 4.2 Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health/deep` | All component checks (aggregate) |
| GET | `/api/v1/health/deep/:component` | Single component check |

### 4.3 Component Checks

| Component | Check |
|-----------|-------|
| `persistence` | fileStore writability probe (reuse /ready logic) |
| `audit` | auditLog.json parseable; entry count sane |
| `jobs` | job store readable; queue depth reported |
| `eventbus` | eventBus alive; history count |
| `metrics` | metrics service returns snapshot |
| `webhooks` | webhook store readable |

### 4.4 Response Format

```json
{
  "status": "degraded",
  "checks": {
    "persistence": { "status": "ok" },
    "audit": { "status": "ok" },
    "jobs": { "status": "ok", "queued": 0 },
    "eventbus": { "status": "ok", "history": 12 },
    "metrics": { "status": "ok" }
  }
}
```

---

## 5. C7d — Error Tracking Foundation

### 5.1 Files

| File | Action |
|------|--------|
| `services/errorTracker.service.js` | CREATE |
| `controllers/errorTracker.controller.js` | CREATE |
| `routes/errorTracker.routes.js` | CREATE |
| `tests/errorTracker.test.js` | CREATE |
| `tests/errorTracker.integration.test.js` | CREATE |

### 5.2 Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/errors` | List errors (filter by status/level) |
| GET | `/api/v1/errors/:id` | Get error detail |
| PUT | `/api/v1/errors/:id` | Update status (acknowledge/resolve) |

### 5.3 Design

```javascript
// services/errorTracker.service.js
capture(err, context={}) → 
  fingerprint = sha256(stackHead + message)
  if open issue with same fingerprint → increment count, update lastSeen
  else create new error issue { id, fingerprint, message, stack, level,
        occurrences, status: 'open', firstSeen, lastSeen }
```

### 5.4 Sanitization

- Stack traces stripped of absolute paths? Keep paths (useful), but no request bodies/secrets.
- Integrates with `middleware/errorHandler.js` — additive call in `serverError()`.

---

## 6. Configuration Changes

| File | Change |
|------|--------|
| `services/eventBus.js` | Add `job.completed`, `job.failed` to EVENT_TYPES |
| `middleware/errorHandler.js` | Additive: call `errorTracker.capture()` in serverError |
| `server.js` | Mount health + error routes; start scheduler; stop scheduler in shutdown |

## 7. Files NOT Modified (verified)

- `ecosystem.config.js`, `Dockerfile`, `package.json`, `utils/fileStore.js`, `utils/logger.js`, all existing routes/controllers/services except the additive hooks above.

---

## 8. Test Projection

| Suite | Tests (est) |
|-------|-------------|
| job.test.js | 12 |
| job.integration.test.js | 4 |
| scheduler.test.js | 8 |
| health.service.test.js | 8 |
| health.integration.test.js | 6 |
| errorTracker.test.js | 10 |
| errorTracker.integration.test.js | 6 |
| **New total** | **~54** |
| **Projected suite total** | **406 + 54 ≈ 460** |

---

## 9. Gate C7 Blueprint Sign-Off

- [x] Additive-only, in-process
- [x] Zero new npm dependencies
- [x] No deployment changes
- [x] Backward compatible
- [x] Graceful shutdown integrated
- [x] All subsystems independently testable
