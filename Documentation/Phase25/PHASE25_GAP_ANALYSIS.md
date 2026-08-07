# Phase 25 — Gap Analysis

**Type:** Evidence-based gap analysis · Planning only
**Date:** 2026-08-06

Method: every candidate capability was checked against existing code. Verified findings only.

## 1. Verified Gaps (additive, safe)

| # | Gap | Evidence (missing) | Classification |
|---|---|---|---|
| G1 | IPv6-aware rate-limiter key generator | `middleware/security.js:60-79` uses raw `req.ip`; `ERR_ERL_KEY_GEN_IPV6` warning observed in test logs | SECURITY |
| G2 | `TRUST_PROXY` configuration | `server.js` sets no `app.set('trust proxy', …)`; grep → no match | OPERATIONS |
| G3 | Structured JSON logging (`LOG_FORMAT=json`) | `utils/logger.js:13` text-only lines; grep `LOG_FORMAT` → no match | OBSERVABILITY |
| G4 | Deprecation/Sunset header middleware | No `Deprecation|Sunset` application code | API GOVERNANCE |
| G5 | Webhook retry-timer lifecycle cleanup (`cancelPending`) | `services/webhook.service.js:148` untracked `setTimeout` | RELIABILITY |
| G6 | Ops / incident / deployment runbooks | `docs/` only has LOAD_TEST, PERFORMANCE, PERFORMANCE_REVIEW, STRESS_TEST | DOCUMENTATION |
| G7 | `.env.example` completeness | Missing `SESSION_SECRET`, `OAUTH_ENABLED`, `GOOGLE_*`, `GITHUB_*`, `METRICS_ENABLED`, `ETAG_ENABLED`, `WEBHOOK_*`, `API_KEY_RATE_LIMIT_MAX`, `DIGITRONICS_DATA_DIR`, `BASE_URL`, `PORT` | OPERATIONS |
| G8 | Automated backup scheduling/rotation (docs only; script exists but no retention policy doc) | `scripts/backup.js` exists; no ops procedure documented for scheduling/rotation | OPERATIONS |

## 2. Candidates Evaluated and REJECTED (already implemented)

| Candidate | Existing implementation | Result |
|---|---|---|
| Rate limiting | `middleware/security.js` apiRateLimiter/login/apiKey | ALREADY IMPLEMENTED |
| Audit logging + correlation | `middleware/audit.js`, `services/audit.service.js` | ALREADY IMPLEMENTED |
| Metrics/health/deep health | `services/metrics.service.js`, `health.service.js` | ALREADY IMPLEMENTED |
| Jobs, scheduler, error tracker | `services/job.service.js`, `scheduler.service.js`, `errorTracker.service.js` | ALREADY IMPLEMENTED |
| Webhooks + HMAC + retries | `services/webhook.service.js` | ALREADY IMPLEMENTED (retry lifecycle cleanup missing = G5) |
| ETag, CORS, helmet, body sanitize | `middleware/etag.js`, `server.js:32-47`, `security.js` | ALREADY IMPLEMENTED |
| Backup/restore/verify | `scripts/backup.js`, `restore.js`, `verify.js` | ALREADY IMPLEMENTED |
| Env validation at startup | `scripts/checkEnv.js`, `start-production.js` | ALREADY IMPLEMENTED |
| API versioning | `/api/v1` namespace | ALREADY IMPLEMENTED |

## 3. Candidates Requiring External Infrastructure — NOT IMPLEMENTED (per mandate)

| Candidate | Required infra | Status |
|---|---|---|
| Distributed job queue / BullMQ | Redis | DEFERRED — requires new ADR |
| Tracing / OpenTelemetry | Collector/exporter | DEFERRED — requires new ADR |
| Error aggregator / Sentry | SaaS | DEFERRED — requires new ADR |
| Event streaming / Kafka / RabbitMQ | Broker | DEFERRED — requires new ADR |
| RDBMS migration | PostgreSQL | DEFERRED — requires new ADR |

These are captured in `PHASE25_RISK_REGISTER.md` as architecture decision proposals (ADP), not implementation items.

## 4. Verified Non-Gaps

- **Graceful shutdown**: idempotent (`server.js:165-190`) — NOT a gap.
- **Health endpoints**: `/health`, `/liveness`, `/health/deep` — present.
- **Secrets handling**: JWT/refresh/session secrets never logged; API key raw value returned once — present.

## 5. Gap Summary

8 verified additive gaps (G1–G8), all backward compatible, none requiring new infrastructure. 12 candidates rejected as already implemented. 5 candidates deferred pending new ADRs.
