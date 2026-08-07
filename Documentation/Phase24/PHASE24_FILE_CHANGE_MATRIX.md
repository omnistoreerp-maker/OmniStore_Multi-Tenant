# PHASE24_FILE_CHANGE_MATRIX.md
## Phase 24 File Change Matrix

**Date:** 2026-08-05
**Status:** READY FOR IMPLEMENTATION
**Gate:** C0

---

## 1. MODIFIED FILES

| # | File | Modification Type | Reason | Risk | Rollback Method |
|---|------|-------------------|--------|------|-----------------|
| 1 | backend/server.js | ADD middleware, routes | Add session, passport, versioning, metrics, Swagger UI | MEDIUM | Remove added middleware/routes, revert to previous version |
| 2 | backend/routes/auth.routes.js | ADD MFA endpoints | Add MFA verification step to login | HIGH | Remove MFA middleware from login, revert to direct JWT flow |
| 3 | backend/services/auth.service.js | ADD MFA check | Add MFA verification after password validation | HIGH | Remove MFA check, revert to password-only validation |
| 4 | backend/config/index.js | ADD OAuth, MFA, API key config | Add new configuration sections | LOW | Remove new config sections |
| 5 | backend/package.json | ADD dependencies | Add passport, speakeasy, qrcode, swagger, prom-client | LOW | Remove new dependencies |

### 1.1 Detailed Modifications: backend/server.js

```
Current: 127 lines
After Phase 24: ~200 lines (estimated)

Added middleware (in order):
  1. express-session (for OAuth)
  2. passport.initialize()
  3. passport.session()
  4. versioning middleware
  5. metrics middleware
  6. Swagger UI (at /api-docs)

Added routes:
  1. OAuth routes (/auth/google, /auth/github)
  2. MFA routes (/auth/mfa/*)
  3. API key routes (/api-keys/*)
  4. Webhook routes (/webhooks/*)
  5. Service account routes (/service-accounts/*)
  6. Metrics routes (/metrics)
  7. Health routes (/health, /health/ready, /health/live)
  8. Versioned API routes (/api/v1/*)
```

### 1.2 Detailed Modifications: backend/routes/auth.routes.js

```
Current: Standard email/password login
After Phase 24: Add MFA verification step

Modification:
  - Before: POST /auth/login → validate credentials → return JWT
  - After: POST /auth/login → validate credentials → check MFA → if MFA enabled, return temp token → POST /auth/mfa/verify → return JWT
```

---

## 2. NEW FILES

### 2.1 OAuth2 Files

| # | File | Purpose | Risk | Rollback Method |
|---|------|---------|------|-----------------|
| 1 | backend/config/oauth.js | OAuth provider configuration | LOW | Delete file |
| 2 | backend/middleware/passport.js | Passport initialization + strategies | MEDIUM | Delete file, remove from server.js |
| 3 | backend/routes/oauth.routes.js | OAuth endpoints (4 routes) | MEDIUM | Delete file, remove from server.js |
| 4 | backend/controllers/oauth.controller.js | OAuth callback handlers | MEDIUM | Delete file |
| 5 | backend/services/oauth.service.js | OAuth business logic | MEDIUM | Delete file |

### 2.2 MFA Files

| # | File | Purpose | Risk | Rollback Method |
|---|------|---------|------|-----------------|
| 1 | backend/services/mfa.service.js | TOTP generation, verification, backup codes | HIGH | Delete file, remove from auth flow |
| 2 | backend/routes/mfa.routes.js | MFA endpoints (4 routes) | MEDIUM | Delete file, remove from server.js |
| 3 | backend/controllers/mfa.controller.js | MFA handlers | MEDIUM | Delete file |

### 2.3 OpenAPI Files

| # | File | Purpose | Risk | Rollback Method |
|---|------|---------|------|-----------------|
| 1 | backend/config/swagger.js | Swagger configuration | LOW | Delete file, remove from server.js |
| 2 | backend/docs/openapi.yaml | OpenAPI specification | LOW | Delete file |

### 2.4 API Versioning Files

| # | File | Purpose | Risk | Rollback Method |
|---|------|---------|------|-----------------|
| 1 | backend/middleware/versioning.js | Version detection middleware | LOW | Delete file, remove from server.js |

### 2.5 API Key Files

| # | File | Purpose | Risk | Rollback Method |
|---|------|---------|------|-----------------|
| 1 | backend/models/apiKey.model.js | API key schema and validation | MEDIUM | Delete file |
| 2 | backend/services/apiKey.service.js | API key CRUD + validation | HIGH | Delete file |
| 3 | backend/routes/apiKey.routes.js | API key endpoints (4 routes) | MEDIUM | Delete file, remove from server.js |
| 4 | backend/controllers/apiKey.controller.js | API key handlers | MEDIUM | Delete file |
| 5 | backend/middleware/apiKeyAuth.js | API key authentication middleware | HIGH | Delete file, remove from server.js |

### 2.6 Webhook Files

| # | File | Purpose | Risk | Rollback Method |
|---|------|---------|------|-----------------|
| 1 | backend/services/webhook.service.js | Webhook business logic | MEDIUM | Delete file |
| 2 | backend/routes/webhook.routes.js | Webhook endpoints (5 routes) | MEDIUM | Delete file, remove from server.js |
| 3 | backend/controllers/webhook.controller.js | Webhook handlers | MEDIUM | Delete file |
| 4 | backend/workers/webhook.worker.js | Async webhook delivery | HIGH | Delete file, stop worker |

### 2.7 Service Account Files

| # | File | Purpose | Risk | Rollback Method |
|---|------|---------|------|-----------------|
| 1 | backend/models/serviceAccount.model.js | Service account schema | LOW | Delete file |
| 2 | backend/services/serviceAccount.service.js | Service account logic | LOW | Delete file |
| 3 | backend/routes/serviceAccount.routes.js | Service account endpoints | LOW | Delete file, remove from server.js |
| 4 | backend/controllers/serviceAccount.controller.js | Service account handlers | LOW | Delete file |

### 2.8 Monitoring Files

| # | File | Purpose | Risk | Rollback Method |
|---|------|---------|------|-----------------|
| 1 | backend/middleware/metrics.js | Prometheus metrics collection | LOW | Delete file, remove from server.js |
| 2 | backend/routes/metrics.routes.js | /metrics endpoint | LOW | Delete file, remove from server.js |
| 3 | backend/utils/healthCheck.js | Health check utilities | LOW | Delete file |
| 4 | backend/routes/health.routes.js | Health endpoints (3 routes) | LOW | Delete file, remove from server.js |

### 2.9 Test Files

| # | File | Purpose | Risk | Rollback Method |
|---|------|---------|------|-----------------|
| 1 | backend/tests/oauth.test.js | OAuth unit tests | LOW | Delete file |
| 2 | backend/tests/oauth.integration.test.js | OAuth integration tests | LOW | Delete file |
| 3 | backend/tests/mfa.test.js | MFA unit tests | LOW | Delete file |
| 4 | backend/tests/mfa.integration.test.js | MFA integration tests | LOW | Delete file |
| 5 | backend/tests/apiKey.test.js | API key unit tests | LOW | Delete file |
| 6 | backend/tests/apiKey.integration.test.js | API key integration tests | LOW | Delete file |
| 7 | backend/tests/webhook.test.js | Webhook unit tests | LOW | Delete file |
| 8 | backend/tests/webhook.integration.test.js | Webhook integration tests | LOW | Delete file |
| 9 | backend/tests/serviceAccount.test.js | Service account tests | LOW | Delete file |
| 10 | backend/tests/monitoring.test.js | Monitoring tests | LOW | Delete file |
| 11 | backend/tests/versioning.test.js | Versioning tests | LOW | Delete file |

---

## 3. UNTOUCHED FILES (DO NOT MODIFY)

| # | File | Reason |
|---|------|--------|
| 1 | backend/utils/jwt.js | Existing JWT — preserved |
| 2 | backend/utils/password.js | Existing bcrypt — preserved |
| 3 | backend/middleware/authorize.js | Existing RBAC — preserved |
| 4 | backend/middleware/security.js | Existing rate limiting — preserved |
| 5 | backend/utils/fileStore.js | Existing persistence — preserved |
| 6 | backend/utils/tokenStore.js | Existing token store — preserved |
| 7 | docker-compose.yml | Existing Docker setup — preserved |
| 8 | nginx.conf | Existing nginx config — preserved |
| 9 | .github/workflows/ci.yml | Existing CI/CD — preserved |
| 10 | index.html | Existing frontend — preserved |
| 11 | sw.js | Existing service worker — preserved |
| 12 | manifest.json | Existing PWA manifest — preserved |
| 13 | All existing route files (auth, products, orders, etc.) | Existing routes — preserved |
| 14 | All existing controller files | Existing controllers — preserved |
| 15 | All existing service files | Existing services — preserved |
| 16 | All existing test files | Existing tests — preserved |

---

## 4. CHANGE SUMMARY

| Category | Count | Risk Level |
|----------|-------|------------|
| Modified files | 5 | MEDIUM-HIGH |
| New files (production) | 28 | MEDIUM |
| New files (tests) | 11 | LOW |
| Untouched files | 16+ | — |
| **Total changes** | **33** | — |

### 4.1 Risk Distribution

| Risk Level | Files | Action Required |
|------------|-------|-----------------|
| HIGH | 5 | Security review, comprehensive testing |
| MEDIUM | 18 | Standard testing, code review |
| LOW | 10 | Basic testing |

### 4.2 Rollback Summary

| Rollback Scope | Files Affected | Time to Rollback |
|----------------|----------------|------------------|
| Full rollback | 33 | 5 minutes (git revert) |
| OAuth only | 5 new + 1 modified | 10 minutes |
| MFA only | 3 new + 2 modified | 10 minutes |
| API keys only | 5 new | 5 minutes |
| Webhooks only | 4 new | 5 minutes |
| Monitoring only | 4 new + 1 modified | 5 minutes |

---

**Document Generated:** 2026-08-05
