# Phase 24 Gate C7 — Architecture Review & Gap Analysis

**Date:** 2026-08-05  
**Gate:** C7 — Background Jobs, Scheduler, Advanced Health, Error Tracking  
**Status:** PLANNING

---

## 1. Executive Summary

Gate C7 targets the next tier of enterprise capabilities: background job processing, task scheduling, advanced health monitoring, and error tracking. The prompt's candidate scope also lists Redis, OpenTelemetry, and Sentry — all of which require **external infrastructure that contradicts the certified single-instance PM2 + JSON fileStore deployment model**. This review separates what can be added in-process (safe, additive) from what requires a separate architecture approval.

---

## 2. Existing Implementation Verification

### 2.1 Deployment Model (verified)

| Component | Evidence |
|-----------|----------|
| PM2 fork mode, **single instance** | `ecosystem.config.js:16` — `instances: 1`, comment: "JSON fileStore persistence: single instance only" |
| JSON fileStore persistence | `utils/fileStore.js` — flat JSON, in-memory mtime cache |
| No Redis dependency | `package.json` — no `redis`, `bull`, `ioredis` |
| No scheduler/cron | `package.json` + codebase scan — zero matches |
| No OpenTelemetry/Sentry | `package.json` — zero matches |
| Graceful shutdown hook | `server.js:159` — `gracefulShutdown()` |
| In-process event bus | `services/eventBus.js` — C6, in-memory pub/sub |
| Webhook retry via setTimeout | `services/webhook.service.js:126,148` |

### 2.2 Confirmed Gaps

| Gap | Evidence | Classification |
|-----|----------|----------------|
| Background job framework | No queue/job code anywhere | **In-process — implementable** |
| Task scheduler | No cron/setInterval scheduler | **In-process — implementable** |
| Advanced health monitoring | Only basic `/health`, `/liveness`, `/ready` | **In-process — implementable** |
| Error tracking | Only logger.error + process handlers | **In-process — implementable** |
| Redis queue | Not deployed; single-instance model | **External infra — DEFER** |
| Distributed tracing (OTel) | No collector; single-instance | **External infra — DEFER** |
| Sentry integration | Requires external SaaS account | **External infra — DEFER** |

---

## 3. Critical Architecture Constraint

**The certified production baseline runs a SINGLE PM2 instance with JSON fileStore persistence.**

| External infra | Why it breaks the model |
|----------------|------------------------|
| **Redis/Bull** | Multi-process queue semantics; requires a Redis server, changes failure modes, adds deployment surface |
| **OpenTelemetry** | Requires a collector + backend (Jaeger/Tempo); no value in single-instance |
| **Sentry** | Requires external SaaS credentials + network egress; compliance review needed |

Per the Master Prompt: *"Redis Integration (only after architecture approval)."* These are **NOT approved for this gate**. They belong in a separate ADR + architecture decision.

---

## 4. Gate C7 Scope Decision

### 4.1 IN SCOPE — additive, in-process, zero new dependencies

| Feature | Rationale |
|---------|-----------|
| **Background Job Framework** | In-process job queue with persistence (JSON), concurrency limit, retry; consistent with single-instance model |
| **Task Scheduler** | Cron-expression or interval scheduler using Node timers; jobs persisted; integrates with graceful shutdown |
| **Advanced Health Monitoring** | Deep health: fileStore writability, audit log integrity, event bus health, job queue depth, metrics snapshot |
| **Error Tracking Foundation** | Persisted error registry (JSON), dedup by fingerprint, status workflow (open/acknowledged/resolved); reuses audit + logger |

### 4.2 OUT OF SCOPE — DEFERRED to Phase 25 (external infra approval required)

| Feature | Dependency | Gate |
|---------|-----------|------|
| Redis queue (Bull) | Redis server + ADR | Phase 25 |
| Distributed tracing (OTel) | Collector + backend | Phase 25 |
| Sentry integration | SaaS + credentials | Phase 25 |
| Multi-instance worker pool | Architecture change | Phase 25 |

---

## 5. Architecture Review

### 5.1 Background Job Framework

```
services/job.service.js
├── enqueue(type, payload, {priority, delay}) → persisted JSON job
├── process(job) — worker loop (concurrency limit, e.g. 1)
├── retry policy (maxAttempts, backoff)
├── status: queued → running → completed | failed
└── job log: data/jobs.json (via fileStore)
```

### 5.2 Task Scheduler

```
services/scheduler.service.js
├── register(name, cronExpr|interval, handler)
├── start() / stop() — integrated with gracefulShutdown
├── nextRunAt — persisted schedule metadata
└── runs persisted to job store
```

### 5.3 Advanced Health

```
routes/index.js (extend) or services/health.service.js
├── /api/v1/health/deep → component checks:
│     ├── fileStore writable
│     ├── auditLog parseable + integrity
│     ├── job queue depth
│     ├── event bus alive
│     └── metrics snapshot
└── /api/v1/health/deep/{component} → single check
```

### 5.4 Error Tracking

```
services/errorTracker.service.js
├── capture(err, context) → fingerprint by stack+message hash
├── dedup → increments occurrence count on existing open issue
├── status workflow: open / acknowledged / resolved
└── endpoints: list, get, update status
```

---

## 6. Backward Compatibility

| Concern | Verdict |
|---------|---------|
| Existing endpoints unchanged | ✅ All additive |
| `ecosystem.config.js` untouched | ✅ No deployment change |
| No new npm deps | ✅ Node built-ins + existing utils |
| fileStore format compatible | ✅ New store names only (`jobs`, `errors`) |
| Graceful shutdown preserved | ✅ Scheduler stop() added to hook |

---

## 7. Gate C7 Architecture Sign-Off

- [x] All existing components verified
- [x] No duplicate implementation
- [x] In-process scope only (external infra deferred)
- [x] Zero new dependencies
- [x] Backward compatibility preserved
- [x] Evidence-based gap analysis complete
