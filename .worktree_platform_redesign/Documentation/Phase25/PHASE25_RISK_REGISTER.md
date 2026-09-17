# Phase 25 — Risk Register

**Type:** Evidence-based risk register · Planning only
**Date:** 2026-08-06

Definitions: Probability 1–5 (5=very likely), Impact 1–5 (5=critical). Risk score = P × I.

## 1. Implementation Risks (Phase 25 items)

| ID | Risk | Evidence | P | I | Score | Mitigation |
|---|---|---|---|---|---|---|
| R-01 | Rate-limiter change alters IPv4 keying | `security.js:60-79` shared keyGenerator path | 2 | 3 | 6 | Keep IPv4 path identical; add IPv6 normalization only; unit tests |
| R-02 | TRUST_PROXY mis-set skews client IPs/audit | `server.js` adds `app.set` gate | 2 | 4 | 8 | Default off; require explicit env; checkEnv validation; integration test |
| R-03 | JSON log format breaks log parsers | `logger.js` additive branch | 2 | 3 | 6 | Default `text`; JSON only via `LOG_FORMAT=json`; snapshot test |
| R-04 | Deprecation headers confuse clients | New middleware default no-op | 1 | 2 | 2 | No header unless route configured |
| R-05 | `cancelPending()` cancels active prod retries | `webhook.service.js` G27 lifecycle | 2 | 3 | 6 | Only call in shutdown; no-op when idle; unit test |
| R-06 | Ship uncommitted/untagged baseline | git latest=e8e638d (Gate C2) | 4 | 5 | 20 | **Commit + tag `phase24-release` first** |

## 2. Operational Risks (existing, monitored)

| Risk | Evidence | P | Impact | Score | Note |
|---|---|---|---|---|---|
| R-07 | Intermittent test flake (1 in 27 runs during C9) | C9 certification run | 2 | 3 | 6 | Identity uncaptured; monitor in CI; capture on recurrence |
| R-08 | JSON persistence single-writer contention at scale | `fileStore` single instance | 3 | 3 | 9 | Bounded by single-instance model; revisit only via ADR |

## 3. Architecture Decision Proposals (ADP) — deferred, NOT implemented

These require infrastructure not in the locked stack (mandate forbids implementation without a new ADR). Documented here for governance.

| ADP | Benefit | Risk | Migration | Ops impact | Rollback | Cost | Complexity | Enterprise justification |
|---|---|---|---|---|---|---|---|---|
| ADP-1 Redis + BullMQ (durable jobs) | distributed retry, persistence, Redis-backed | new infra, single-point Redis | medium (swap job.service) | Redis ops, HA | revert to in-process jobs | $$ | High | multi-instance scale |
| ADP-2 OpenTelemetry (tracing) | end-to-end trace across services | collector/exporter infra | high | collector ops | remove exporters | $$ | High | distributed observability |
| ADP-3 Sentry (error aggregation) | centralized error triage | SaaS data residency | low | vendor mgmt | disable integration | $ | Low | alert/SEV triage |
| ADP-4 PostgreSQL migration | ACID/relational, rich queries | large rework | very high | DB ops, backups | migrate back | $$$ | Very high | long-term data model |
| ADP-5 Kafka/RabbitMQ | event streaming | broker | very high | broker ops | revert | $$$ | Very high | async scale-out |

**Decision:** ADP-1…ADP-5 are NOT scheduled in Phase 25. No external service will be introduced.

## 4. Top Risk

**R-06 (Score 20)** — proceeding on an untagged/uncommitted baseline. Mandatory Phase 25.1 gate before any implementation.