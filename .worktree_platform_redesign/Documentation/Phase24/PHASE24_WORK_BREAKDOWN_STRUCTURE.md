# PHASE24_WORK_BREAKDOWN_STRUCTURE.md
## Phase 24 Work Breakdown Structure (WBS)

**Date:** 2026-08-05
**Status:** READY FOR IMPLEMENTATION
**Gate:** C0

---

## 1. EPIC 1: OAUTH2 PROVIDER SUPPORT — 2 weeks, HIGH priority

| ID | Task | Effort | Deps | Risk | Owner |
|----|------|--------|------|------|-------|
| 1.1.1 | Create backend/config/oauth.js | 2h | — | LOW | Backend Dev |
| 1.1.2 | Define provider schemas + env validation | 2h | 1.1.1 | LOW | Backend Dev |
| 1.2.1 | Install passport, passport-google-oauth20, passport-github2, express-session | 1h | — | LOW | Backend Dev |
| 1.2.2 | Create backend/middleware/passport.js (Google+GitHub strategies, serialize/deserialize) | 8h | 1.1.1, 1.2.1 | MEDIUM | Backend Dev |
| 1.3.1 | Create backend/routes/oauth.routes.js (4 endpoints: google, google/callback, github, github/callback) | 4h | 1.2.2 | MEDIUM | Backend Dev |
| 1.4.1 | Create backend/controllers/oauth.controller.js (callbacks, error handling) | 4h | 1.3.1 | MEDIUM | Backend Dev |
| 1.5.1 | Create backend/services/oauth.service.js (findOrCreateUser, linkExistingUser) | 6h | 1.4.1 | HIGH | Backend Dev |
| 1.6.1 | Modify backend/server.js — add session, passport.init, passport.session, OAuth routes | 3h | 1.2.2, 1.3.1 | MEDIUM | Backend Dev |
| 1.7.1 | Unit tests for OAuth service | 4h | 1.5.1 | MEDIUM | QA Engineer |
| 1.7.2 | Integration tests for OAuth routes | 4h | 1.3.1 | MEDIUM | QA Engineer |
| 1.8.1 | Document OAuth configuration and setup | 2h | 1.1.1 | LOW | Tech Writer |

**Subtotal:** ~40h (1 week)

---

## 2. EPIC 2: MFA (TOTP) — 2 weeks, HIGH priority

| ID | Task | Effort | Deps | Risk | Owner |
|----|------|--------|------|------|-------|
| 2.1.1 | Install speakeasy, qrcode | 1h | — | LOW | Backend Dev |
| 2.2.1 | Create backend/services/mfa.service.js (generateSecret, verifyToken, enableMFA, disableMFA, backupCodes) | 12h | 2.1.1 | HIGH | Backend Dev |
| 2.3.1 | Create backend/routes/mfa.routes.js (enable, verify, disable, backup-codes) | 4h | 2.2.1 | MEDIUM | Backend Dev |
| 2.4.1 | Create backend/controllers/mfa.controller.js | 6h | 2.3.1 | MEDIUM | Backend Dev |
| 2.5.1 | Modify auth routes — add MFA verification step to login flow | 4h | 2.3.1 | HIGH | Backend Dev |
| 2.6.1 | Unit tests for MFA service | 6h | 2.2.1 | MEDIUM | QA Engineer |
| 2.6.2 | Integration tests for MFA routes + login flow | 4h | 2.3.1 | HIGH | QA Engineer |
| 2.7.1 | Document MFA setup, user guide, troubleshooting | 3h | 2.2.1 | LOW | Tech Writer |

**Subtotal:** ~40h (1 week)

---

## 3. EPIC 3: OPENAPI DOCUMENTATION — 1 week, HIGH priority

| ID | Task | Effort | Deps | Risk | Owner |
|----|------|--------|------|------|-------|
| 3.1.1 | Install swagger-jsdoc, swagger-ui-express | 1h | — | LOW | Backend Dev |
| 3.2.1 | Create backend/config/swagger.js (info, security schemes, server URLs) | 2h | 3.1.1 | LOW | Backend Dev |
| 3.3.1 | Create backend/docs/openapi.yaml — full API specification | 12h | 3.2.1 | MEDIUM | Tech Writer |
| 3.4.1 | Add JSDoc annotations to all route files (15 files) | 8h | 3.3.1 | LOW | Backend Dev |
| 3.5.1 | Add Swagger UI mount to backend/server.js | 2h | 3.2.1, 3.3.1 | LOW | Backend Dev |
| 3.6.1 | Validate OpenAPI spec + test Swagger UI | 2h | 3.5.1 | LOW | QA Engineer |
| 3.7.1 | Document OpenAPI usage guide | 2h | 3.3.1 | LOW | Tech Writer |

**Subtotal:** ~29h (4 days)

---

## 4. EPIC 4: API VERSIONING — 3 days, MEDIUM priority

| ID | Task | Effort | Deps | Risk | Owner |
|----|------|--------|------|------|-------|
| 4.1.1 | Create backend/middleware/versioning.js (URL path version detection, fallback to v1) | 4h | — | LOW | Backend Dev |
| 4.2.1 | Modify backend/server.js — add versioning middleware, /api/v1 prefix | 2h | 4.1.1 | LOW | Backend Dev |
| 4.3.1 | Unit tests for versioning middleware | 4h | 4.1.1 | LOW | QA Engineer |
| 4.4.1 | Document versioning strategy | 2h | 4.1.1 | LOW | Tech Writer |

**Subtotal:** ~12h (1.5 days)

---

## 5. EPIC 5: API KEY MANAGEMENT — 3 days, MEDIUM priority

| ID | Task | Effort | Deps | Risk | Owner |
|----|------|--------|------|------|-------|
| 5.1.1 | Create backend/models/apiKey.model.js (schema, validation, expiration) | 4h | — | MEDIUM | Backend Dev |
| 5.2.1 | Create backend/services/apiKey.service.js (generate, validate, revoke, hash) | 6h | 5.1.1 | HIGH | Backend Dev |
| 5.3.1 | Create backend/routes/apiKey.routes.js (CRUD) | 4h | 5.2.1 | MEDIUM | Backend Dev |
| 5.4.1 | Create backend/controllers/apiKey.controller.js | 4h | 5.3.1 | MEDIUM | Backend Dev |
| 5.5.1 | Create backend/middleware/apiKeyAuth.js (X-API-Key header extraction + validation) | 4h | 5.2.1 | HIGH | Backend Dev |
| 5.6.1 | Unit tests for API key service | 4h | 5.2.1 | MEDIUM | QA Engineer |
| 5.6.2 | Integration tests for API key routes + auth | 4h | 5.3.1 | MEDIUM | QA Engineer |
| 5.7.1 | Document API key usage guide | 2h | 5.2.1 | LOW | Tech Writer |

**Subtotal:** ~32h (4 days)

---

## 6. EPIC 6: WEBHOOKS — 1 week, MEDIUM priority

| ID | Task | Effort | Deps | Risk | Owner |
|----|------|--------|------|------|-------|
| 6.1.1 | Install bull (job queue) | 1h | — | LOW | Backend Dev |
| 6.2.1 | Create backend/services/webhook.service.js (register, trigger, verify, list) | 8h | 6.1.1 | HIGH | Backend Dev |
| 6.3.1 | Create backend/routes/webhook.routes.js (CRUD + test) | 4h | 6.2.1 | MEDIUM | Backend Dev |
| 6.4.1 | Create backend/controllers/webhook.controller.js | 4h | 6.3.1 | MEDIUM | Backend Dev |
| 6.5.1 | Create backend/workers/webhook.worker.js (delivery, retry, logging) | 8h | 6.2.1 | HIGH | Backend Dev |
| 6.6.1 | Unit tests for webhook service | 4h | 6.2.1 | MEDIUM | QA Engineer |
| 6.6.2 | Integration tests for webhook routes + delivery | 4h | 6.3.1 | MEDIUM | QA Engineer |
| 6.7.1 | Document webhook usage guide | 2h | 6.2.1 | LOW | Tech Writer |

**Subtotal:** ~35h (4.5 days)

---

## 7. EPIC 7: SERVICE ACCOUNTS — 2 days, LOW priority

| ID | Task | Effort | Deps | Risk | Owner |
|----|------|--------|------|------|-------|
| 7.1.1 | Create backend/models/serviceAccount.model.js | 4h | — | MEDIUM | Backend Dev |
| 7.2.1 | Create backend/services/serviceAccount.service.js (create, validate, revoke) | 6h | 7.1.1 | MEDIUM | Backend Dev |
| 7.3.1 | Create backend/routes/serviceAccount.routes.js | 4h | 7.2.1 | MEDIUM | Backend Dev |
| 7.4.1 | Create backend/controllers/serviceAccount.controller.js | 4h | 7.3.1 | LOW | Backend Dev |
| 7.5.1 | Unit + integration tests | 4h | 7.2.1 | MEDIUM | QA Engineer |
| 7.6.1 | Document service account usage | 2h | 7.2.1 | LOW | Tech Writer |

**Subtotal:** ~24h (3 days)

---

## 8. EPIC 8: MONITORING & OBSERVABILITY — 1 week, MEDIUM priority

| ID | Task | Effort | Deps | Risk | Owner |
|----|------|--------|------|------|-------|
| 8.1.1 | Install prom-client | 1h | — | LOW | Backend Dev |
| 8.2.1 | Create backend/middleware/metrics.js (request duration, count, status) | 4h | 8.1.1 | LOW | Backend Dev |
| 8.3.1 | Create backend/routes/metrics.routes.js (Prometheus /metrics endpoint) | 2h | 8.2.1 | LOW | Backend Dev |
| 8.4.1 | Create backend/utils/healthCheck.js (health, ready, live probes) | 4h | — | LOW | Backend Dev |
| 8.5.1 | Create backend/routes/health.routes.js | 2h | 8.4.1 | LOW | Backend Dev |
| 8.6.1 | Modify backend/server.js — add metrics middleware, health routes | 2h | 8.2.1, 8.3.1, 8.5.1 | LOW | Backend Dev |
| 8.7.1 | Unit tests for metrics + health checks | 4h | 8.2.1 | LOW | QA Engineer |
| 8.8.1 | Document monitoring setup | 2h | 8.2.1 | LOW | Tech Writer |

**Subtotal:** ~21h (2.5 days)

---

## 9. SUMMARY

| Epic | Effort | Risk | Priority |
|------|--------|------|----------|
| OAuth2 | 40h | MEDIUM | HIGH |
| MFA | 40h | MEDIUM | HIGH |
| OpenAPI | 29h | LOW | HIGH |
| API Versioning | 12h | LOW | MEDIUM |
| API Keys | 32h | MEDIUM | MEDIUM |
| Webhooks | 35h | MEDIUM | MEDIUM |
| Service Accounts | 24h | LOW | LOW |
| Monitoring | 21h | LOW | MEDIUM |
| **TOTAL** | **233h** | — | — |

### 9.1 Recommended Implementation Sequence

| Phase | Epics | Duration |
|-------|-------|----------|
| Phase A | OAuth2, MFA | 2 weeks |
| Phase B | OpenAPI, API Versioning, API Keys | 1.5 weeks |
| Phase C | Webhooks, Service Accounts, Monitoring | 1.5 weeks |

### 9.2 Critical Path

```
OAuth2 Config → Passport Middleware → OAuth Routes → OAuth Service → Server Integration
     ↓
MFA Service → MFA Routes → Auth Flow Modification
     ↓
API Key Service → API Key Middleware → Webhook Service → Webhook Worker
```

### 9.3 Risk Summary

| Risk | Mitigation |
|------|------------|
| OAuth callback errors | Comprehensive error handling, fallback to email/password |
| MFA user lockout | Backup codes, admin reset capability |
| API key exposure | bcrypt hashing, one-time display on creation |
| Webhook delivery failure | Bull retry mechanism, dead letter queue |
| Session store limitation | In-memory now, Redis planned for future |
