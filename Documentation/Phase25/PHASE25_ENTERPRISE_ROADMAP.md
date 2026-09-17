# Phase 25 — Enterprise Roadmap

**Type:** Prioritized roadmap · Planning only
**Date:** 2026-08-06

## 1. Roadmap Principles

- Additive and backward compatible only.
- No new ADR required for any Phase 25 item (all fit the locked stack).
- Each item verified as a genuine gap (see PHASE25_GAP_ANALYSIS.md).
- Certification baseline (447/447) preserved at every step.

## 2. Prioritized Items

### Phase 25.1 — Release Hygiene (Blocking, must precede Phase 25 work)
| Item | Evidence | Effort |
|---|---|---|
| Commit Phase 24 working tree (C3–C8) | latest commit = `e8e638d` (Gate C2) | S |
| Create `phase24-release` tag | no phase24 tag exists | S |
| Complete `.env.example` | missing 11+ keys vs `config/index.js` + `config/oauth.js` | S |

### Phase 25.2 — Security Hardening (High value)
| # | Item | Gap | Effort | Risk |
|---|---|---|---|---|
| H1 | IPv6-normalized rate-limiter key generator + `keyGeneratorIpFallback` validation | G1 | S | Low |
| H2 | `TRUST_PROXY` env-gated proxy config | G2 | S | Low (default off) |

### Phase 25.3 — Reliability & Governance (Medium)
| # | Item | Gap | Effort | Risk |
|---|---|---|---|---|
| R1 | Webhook retry-timer tracking + `cancelPending()` wired into `gracefulShutdown` | G5 | M | Low |
| Gv1 | Deprecation/Sunset header middleware (config-driven, default no-op) | G4 | S | Low |

### Phase 25.4 — Observability (Medium)
| # | Item | Gap | Effort | Risk |
|---|---|---|---|---|
| O1 | `LOG_FORMAT=json` structured log records (additive format) | G3 | M | Low |

### Phase 25.5 — Operations & Documentation (Low)
| # | Item | Gap | Effort | Risk |
|---|---|---|---|---|
| D1 | `docs/OPS.md`, `docs/INCIDENT_RESPONSE.md`, `docs/DEPLOYMENT_RUNBOOK.md` | G6 | S | None |
| D2 | Backup scheduling/rotation ops procedure | G8 | S | None |

## 3. Explicitly Out of Scope (deferred to future ADR)

Redis-based distributed jobs, OpenTelemetry tracing, Sentry, Kafka/RabbitMQ, PostgreSQL migration. These require new Architecture Decision Proposals (see PHASE25_RISK_REGISTER.md) and are NOT scheduled in Phase 25.

## 4. Sequencing & Certification Gates

1. 25.1 → re-run full suite (447 baseline), create tag.
2. 25.2 H1+H2 → new tests → full suite + 5× consecutive parallel runs.
3. 25.3 R1+Gv1 → new tests → full suite.
4. 25.4 O1 → format snapshot tests → full suite.
5. 25.5 D1+D2 → docs review only.

## 5. Enterprise Value

- H1/H2: closes a real rate-limit bypass vector behind proxies (enterprise security posture).
- R1: removes latent timer retention in a long-running PM2 process.
- Gv1: enables graceful API lifecycle (foundation for v2 without breaking v1).
- O1: machine-parseable logs → operational tooling readiness.
- D1/D2: incident-response and runbook readiness.
