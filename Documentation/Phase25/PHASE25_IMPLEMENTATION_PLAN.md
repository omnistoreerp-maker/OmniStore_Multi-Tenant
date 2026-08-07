# Phase 25 — Prioritized Implementation Plan (Approved Additive Improvements)

**Status:** ✅ Phase 24 certified (tag `phase24-release` @ `6b79bf9` baseline, 447/447 tests)
**Constraint:** additive only — no new infrastructure, no rewrites, preserve 447-test baseline.

---

## Priority 1 — Release hygiene & governance (do first, lowest risk)

| # | Item | Rationale | Risk | Est. effort |
|---|---|---|---|---|
| P1.1 | Complete `.env.example` (missing SESSION_SECRET, OAUTH_*, METRICS_ENABLED, ETAG_ENABLED, WEBHOOK_*, API_KEY_RATE_LIMIT_MAX, DIGITRONICS_DATA_DIR, BASE_URL, PORT) | onboarding/ops accuracy | None | S |
| P1.2 | Add `backend/data/*.json` + `jest-results.json` to `.gitignore` | prevent runtime state from ever being committed | None | S |
| P1.3 | CI gate: run 447-test suite on PR / before tag (GitHub Actions workflow) | guards future uncommitted-work incidents | Low | M |

## Priority 2 — Security hardening (per Phase 25 audit G1, G2)

| # | Item | Rationale | Risk | Effort |
|---|---|---|---|---|
| P2.1 | IPv6-aware rate-limiter key generation (`middleware/security.js:60-79`) | closes `ERR_ERL_KEY_GEN_IPV6` bypass | Low | S |
| P2.2 | `TRUST_PROXY` env config (off by default) | correct client IPs behind proxy | Medium (default off) | S |

## Priority 3 — Reliability & API governance (G5, G4)

| # | Item | Rationale | Risk | Effort |
|---|---|---|---|---|
| P3.1 | Webhook retry-timer lifecycle tracking (`cancelPending`) | removes latent timer retention | Low | M |
| P3.2 | Deprecation/Sunset header middleware (config-driven) | API lifecycle governance, foundation for v2 | Low | S |

## Priority 4 — Observability (G3)

| # | Item | Rationale | Risk | Effort |
|---|---|---|---|---|
| P4.1 | Structured JSON logging via `LOG_FORMAT=json` (default text) | machine-parseable ops logs | Low | M |

## Priority 5 — Operations documentation (G6, G8)

| # | Item | Rationale | Risk | Effort |
|---|---|---|---|---|
| P5.1 | Runbook + incident-response docs | ops readiness | None | S |
| P5.2 | Backup scheduling/rotation ops procedure | DR readiness | None | S |

---

## Verification requirement (all items)

- Full suite **447/447, 35/35** must remain green after each item.
- `--detectOpenHandles` clean.
- Each item default-inactive / backward compatible.

## Explicitly excluded

Redis, PostgreSQL, Kafka, RabbitMQ, BullMQ, OpenTelemetry, Sentry, microservices — deferred as ADPs (see PHASE25_RISK_REGISTER.md). No external infrastructure in Phase 25.