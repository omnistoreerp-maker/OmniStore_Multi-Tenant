# Phase 25 — Implementation Recommendations

**Type:** Evidence-based recommendations · Planning only · No code
**Date:** 2026-08-06

Each recommendation follows the mandated evaluation: exists? / duplicates? / ADR? / backward compat? / infra? / new ADR? / risk / complexity / rollback / value.

---

## REC-01 — IPv6-aware rate limiter key generation

| Criterion | Verdict |
|---|---|
| Already exists? | Partial — rate limiters exist (`middleware/security.js:41-82`); IPv6 key normalization does not |
| Duplicates existing work? | No |
| Violates ADR? | No |
| Backward compatible? | Yes — IPv4 keying unchanged |
| Requires infrastructure? | No |
| Requires new ADR? | No |
| Risk | Low |
| Complexity | S |
| Rollback | Revert one keyGenerator block |
| Enterprise value | Closes IPv6 rate-limit bypass (evidence: `ERR_ERL_KEY_GEN_IPV6` in test logs) |

## REC-02 — `TRUST_PROXY` configuration (env-gated)

| Criterion | Verdict |
|---|---|
| Already exists? | No (`grep 'trust proxy'` → no match) |
| Duplicates existing work? | No |
| Violates ADR? | No |
| Backward compatible? | Yes — off by default |
| Requires infrastructure? | No |
| Requires new ADR? | No |
| Risk | Medium (mis-config misreads IPs) — default off |
| Complexity | S |
| Rollback | Unset env |
| Enterprise value | Correct client-IP for rate limits/audit behind proxy |

## REC-03 — Structured JSON logging (`LOG_FORMAT=json`, additive)

| Criterion | Verdict |
|---|---|
| Already exists? | No (`utils/logger.js` text-only; `LOG_FORMAT` grep → none) |
| Duplicates? | No |
| ADR? | No |
| Backward compatible? | Yes — default remains text |
| Infrastructure? | No |
| New ADR? | No |
| Risk | Low |
| Complexity | M |
| Rollback | Unset env |
| Value | Machine-parseable ops logs |

## REC-04 — Deprecation/Sunset header middleware (config-driven)

| Criterion | Verdict |
|---|---|
| Already exists? | No (`Deprecation|Sunset` grep → no app code) |
| Duplicates? | No |
| ADR? | No |
| Backward compatible? | Yes — no-op when empty config |
| Infrastructure? | No |
| New ADR? | No |
| Risk | Low |
| Complexity | S |
| Rollback | Remove middleware line |
| Value | API lifecycle governance; foundation for v2 |

## REC-05 — Webhook retry-timer lifecycle (`cancelPending`)

| Criterion | Verdict |
|---|---|
| Already exists? | Retry logic yes (`webhook.service.js:148`); timer tracking no |
| Duplicates? | No |
| ADR? | No |
| Backward compatible? | Yes — no-op when idle |
| Infrastructure? | No |
| New ADR? | No |
| Risk | Low |
| Complexity | M |
| Rollback | Remove tracking set |
| Value | Removes latent timer retention in long-running process |

## REC-06 — Operations documentation pack

| Criterion | Verdict |
|---|---|
| Already exists? | Partial (`docs/` perf/load/stress only) |
| Duplicates? | No |
| ADR? | No |
| Backward compatible? | Yes |
| Infrastructure? | No |
| New ADR? | No |
| Risk | None |
| Complexity | S |
| Rollback | Delete docs |
| Value | Runbook/incident readiness |

## REC-07 — Complete `.env.example` (mandatory housekeeping)

| Criterion | Verdict |
|---|---|
| Already exists? | `.env.example` present but incomplete (missing SESSION_SECRET, OAUTH_*, METRICS_ENABLED, ETAG_ENABLED, WEBHOOK_*, API_KEY_RATE_LIMIT_MAX, DIGITRONICS_DATA_DIR, BASE_URL, PORT) |
| Duplicates? | No |
| ADR? | No |
| Backward compatible? | Yes |
| Infrastructure? | No |
| New ADR? | No |
| Risk | None |
| Complexity | S |
| Rollback | Revert file |
| Value | Onboarding/ops accuracy |

## REC-08 — Backup scheduling/rotation ops procedure (docs)

| Criterion | Verdict |
|---|---|
| Already exists? | `scripts/backup.js` present; no ops procedure doc |
| Duplicates? | No |
| ADR? | No |
| Backward compatible? | Yes |
| Infrastructure? | No |
| New ADR? | No |
| Risk | None |
| Complexity | S |
| Rollback | Revert docs |
| Value | DR readiness (DISASTER_RECOVERY.md exists at root; procedure formalization) |

---

## Rejected / Deferred

- Redis/BullMQ, OpenTelemetry, Sentry, Kafka/RabbitMQ, PostgreSQL → **deferred as ADPs** (see PHASE25_RISK_REGISTER.md). Not scheduled in Phase 25.
- Features verified as ALREADY IMPLEMENTED are excluded (see PHASE25_GAP_ANALYSIS.md §2).

## Recommended Order

25.1 release hygiene (commit + tag + .env.example) → REC-01/02 → REC-05/04 → REC-03 → REC-06/08.
