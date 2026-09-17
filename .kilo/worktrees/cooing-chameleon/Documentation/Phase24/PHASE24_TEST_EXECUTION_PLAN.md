# PHASE24_TEST_EXECUTION_PLAN.md
## Phase 24 Test Execution Plan

**Date:** 2026-08-05
**Status:** READY FOR IMPLEMENTATION
**Gate:** C0

---

## 1. TEST STRATEGY OVERVIEW

### 1.1 Test Pyramid

```
         /\
        /  \        E2E (5%)
       /    \       Smoke, Regression
      /------\
     /        \     Integration (25%)
    /          \    API, Service, Route
   /------------\
  /              \  Unit (70%)
 /                \ Function, Method, Module
/------------------\
```

### 1.2 Test Categories

| Category | Coverage | Tools | Execution |
|----------|----------|-------|-----------|
| Unit | 70% | Jest | Every commit |
| Integration | 25% | Jest + supertest | Every PR |
| API | 15% | Jest + supertest | Every PR |
| Security | 10% | Jest + custom | Weekly |
| Regression | 100% existing | Jest | Every PR |
| Performance | Baseline | Artillery | Pre-release |
| Smoke | Critical paths | Jest | Every deployment |
| Rollback | Recovery | Jest | Pre-release |

---

## 2. UNIT TESTS

### 2.1 OAuth Service Tests

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| U-OAuth-001 | generateGoogleAuthUrl returns valid URL | URL contains google.com | HIGH |
| U-OAuth-002 | handleGoogleCallback creates new user | User created with OAuth data | HIGH |
| U-OAuth-003 | handleGoogleCallback links existing user | User linked by email | HIGH |
| U-OAuth-004 | handleGoogleCallback generates JWT | Valid JWT returned | HIGH |
| U-OAuth-005 | handleGitHubCallback creates new user | User created with OAuth data | HIGH |
| U-OAuth-006 | handleGitHubCallback handles error | Error returned gracefully | MEDIUM |
| U-OAuth-007 | findOrCreateUser finds existing user | Existing user returned | MEDIUM |
| U-OAuth-008 | findOrCreateUser creates new user | New user created | MEDIUM |
| U-OAuth-009 | linkExistingUser links by email | User linked successfully | MEDIUM |
| U-OAuth-010 | linkExistingUser handles conflict | Conflict error returned | MEDIUM |

### 2.2 MFA Service Tests

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| U-MFA-001 | generateSecret returns valid secret | Base32 secret returned | HIGH |
| U-MFA-002 | generateSecret generates QR code | QR code data URL returned | HIGH |
| U-MFA-003 | verifyToken validates correct code | true returned | HIGH |
| U-MFA-004 | verifyToken rejects incorrect code | false returned | HIGH |
| U-MFA-005 | verifyToken handles expired code | Expired error returned | HIGH |
| U-MFA-006 | generateBackupCodes returns codes | Array of codes returned | MEDIUM |
| U-MFA-007 | validateBackupCode validates correct code | true returned | MEDIUM |
| U-MFA-008 | validateBackupCode rejects used code | false returned | MEDIUM |
| U-MFA-009 | enableMFA stores secret securely | Secret hashed and stored | HIGH |
| U-MFA-010 | disableMFA removes secret | Secret removed from user | MEDIUM |

### 2.3 API Key Service Tests

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| U-APIKey-001 | generateKey creates valid key | Key with prefix returned | HIGH |
| U-APIKey-002 | generateKey hashes key | Hashed key stored | HIGH |
| U-APIKey-003 | validateKey accepts valid key | true returned | HIGH |
| U-APIKey-004 | validateKey rejects invalid key | false returned | HIGH |
| U-APIKey-005 | validateKey rejects expired key | Expired error returned | HIGH |
| U-APIKey-006 | revokeKey marks key inactive | Key deactivated | MEDIUM |
| U-APIKey-007 | listKeys returns user keys | Array of keys returned | LOW |
| U-APIKey-008 | updateKey updates metadata | Metadata updated | LOW |

### 2.4 Webhook Service Tests

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| U-Webhook-001 | registerWebhook creates webhook | Webhook created | HIGH |
| U-Webhook-002 | registerWebhook validates HTTPS | HTTPS required error | HIGH |
| U-Webhook-003 | triggerWebhook queues delivery | Job queued | HIGH |
| U-Webhook-004 | verifyWebhook validates signature | true returned | HIGH |
| U-Webhook-005 | verifyWebhook rejects invalid sig | false returned | HIGH |
| U-Webhook-006 | listWebhooks returns webhooks | Array returned | LOW |
| U-Webhook-007 | deleteWebhook removes webhook | Webhook deleted | MEDIUM |

### 2.5 Versioning Middleware Tests

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| U-Version-001 | detects version from URL path | v1 detected | MEDIUM |
| U-Version-002 | detects version from header | v1 detected | MEDIUM |
| U-Version-003 | detects version from query | v1 detected | MEDIUM |
| U-Version-004 | defaults to v1 | v1 used | MEDIUM |
| U-Version-005 | handles invalid version | v1 fallback | MEDIUM |

### 2.6 Metrics Middleware Tests

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| U-Metrics-001 | records request duration | Histogram updated | LOW |
| U-Metrics-002 | records request count | Counter incremented | LOW |
| U-Metrics-003 | records status codes | Label set correctly | LOW |
| U-Metrics-004 | excludes health endpoints | Not recorded | LOW |

---

## 3. INTEGRATION TESTS

### 3.1 OAuth Integration Tests

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| I-OAuth-001 | GET /auth/google redirects to Google | 302 to google.com | HIGH |
| I-OAuth-002 | GET /auth/github redirects to GitHub | 302 to github.com | HIGH |
| I-OAuth-003 | callback creates user and returns JWT | User + JWT | HIGH |
| I-OAuth-004 | callback handles existing user | User linked | HIGH |
| I-OAuth-005 | callback handles error | Error response | HIGH |

### 3.2 MFA Integration Tests

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| I-MFA-001 | POST /auth/mfa/enable enables MFA | MFA enabled | HIGH |
| I-MFA-002 | POST /auth/mfa/verify validates code | JWT returned | HIGH |
| I-MFA-003 | POST /auth/mfa/disable disables MFA | MFA disabled | HIGH |
| I-MFA-004 | GET /auth/mfa/backup-codes returns codes | Codes returned | MEDIUM |
| I-MFA-005 | login flow with MFA required | temp_token returned | HIGH |
| I-MFA-006 | login flow without MFA | JWT returned directly | HIGH |
| I-MFA-007 | rate limiting on MFA verify | 429 after 5 attempts | MEDIUM |

### 3.3 API Key Integration Tests

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| I-APIKey-001 | POST /api-keys creates key | 201 + key | HIGH |
| I-APIKey-002 | GET /api-keys lists keys | 200 + array | MEDIUM |
| I-APIKey-003 | DELETE /api-keys/:id revokes key | 200 | MEDIUM |
| I-APIKey-004 | PUT /api-keys/:id updates key | 200 | LOW |
| I-APIKey-005 | API key auth works for protected route | 200 | HIGH |
| I-APIKey-006 | invalid API key returns 401 | 401 | HIGH |

### 3.4 Webhook Integration Tests

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| I-Webhook-001 | POST /webhooks creates webhook | 201 | HIGH |
| I-Webhook-002 | GET /webhooks lists webhooks | 200 + array | MEDIUM |
| I-Webhook-003 | DELETE /webhooks/:id deletes | 200 | MEDIUM |
| I-Webhook-004 | POST /webhooks/:id/test triggers | 200 | MEDIUM |
| I-Webhook-005 | webhook delivery on event | Delivery made | HIGH |

### 3.5 Health Check Integration Tests

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| I-Health-001 | GET /health returns healthy | 200 + status | HIGH |
| I-Health-002 | GET /health/ready returns ready | 200 + status | HIGH |
| I-Health-003 | GET /health/live returns alive | 200 + status | HIGH |

### 3.6 Versioning Integration Tests

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| I-Version-001 | /api/v1/products works | 200 | MEDIUM |
| I-Version-002 | /api/products defaults to v1 | 200 | MEDIUM |
| I-Version-003 | Accept-Version header works | 200 | MEDIUM |

---

## 4. SECURITY TESTS

### 4.1 OAuth Security Tests

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| S-OAuth-001 | CSRF state parameter validated | CSRF blocked | HIGH |
| S-OAuth-002 | Session cookies are HttpOnly | HttpOnly set | HIGH |
| S-OAuth-003 | Session cookies are Secure | Secure set | HIGH |
| S-OAuth-004 | Session cookies are SameSite | SameSite set | HIGH |
| S-OAuth-005 | OAuth callback validates code | Invalid code rejected | HIGH |
| S-OAuth-006 | OAuth prevents session fixation | Session regenerated | MEDIUM |

### 4.2 MFA Security Tests

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| S-MFA-001 | TOTP secret is hashed | Hashed storage | HIGH |
| S-MFA-002 | Backup codes are hashed | Hashed storage | HIGH |
| S-MFA-003 | MFA codes rate limited | 429 after 5 attempts | HIGH |
| S-MFA-004 | Temp token expires | Token expired | HIGH |
| S-MFA-005 | MFA bypass prevented | Cannot skip MFA | HIGH |

### 4.3 API Key Security Tests

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| S-APIKey-001 | API key is hashed | Hashed storage | HIGH |
| S-APIKey-002 | API key shown only once | Not retrievable | HIGH |
| S-APIKey-003 | API key cannot access own endpoints | JWT required | HIGH |
| S-APIKey-004 | API key permissions enforced | 403 for unauthorized | HIGH |
| S-APIKey-005 | API key expiration enforced | 401 for expired | HIGH |

### 4.4 General Security Tests

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| S-Gen-001 | All new endpoints rate limited | 429 on exceed | HIGH |
| S-Gen-002 | All new endpoints validate input | Invalid input rejected | HIGH |
| S-Gen-003 | No sensitive data in logs | Passwords not logged | HIGH |
| S-Gen-004 | No SQL injection | Input sanitized | HIGH |
| S-Gen-005 | No XSS in responses | Content-Type set | MEDIUM |
| S-Gen-006 | CORS headers correct | Proper CORS | MEDIUM |

---

## 5. REGRESSION TESTS

### 5.1 Existing Feature Regression

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| R-001 | Email/password login still works | JWT returned | CRITICAL |
| R-002 | JWT authentication still works | User authenticated | CRITICAL |
| R-003 | RBAC authorization still works | Role checked | CRITICAL |
| R-004 | Product CRUD still works | CRUD operations | HIGH |
| R-005 | Order CRUD still works | CRUD operations | HIGH |
| R-006 | User CRUD still works | CRUD operations | HIGH |
| R-007 | Rate limiting still works | 429 on exceed | HIGH |
| R-008 | File persistence still works | JSON files read/written | HIGH |
| R-009 | Token revocation still works | Token invalidated | HIGH |
| R-010 | Existing tests pass | All green | CRITICAL |

### 5.2 Performance Regression

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| P-001 | Login response time | < 200ms | HIGH |
| P-002 | Product list response time | < 100ms | HIGH |
| P-003 | Order list response time | < 100ms | HIGH |
| P-004 | Memory usage baseline | < 100MB | MEDIUM |
| P-005 | CPU usage baseline | < 50% idle | MEDIUM |

---

## 6. PERFORMANCE TESTS

### 6.1 Load Tests

| Test ID | Scenario | Users | Duration | Threshold |
|---------|----------|-------|----------|-----------|
| Perf-001 | Login load | 100 | 5 min | < 500ms avg |
| Perf-002 | Product list load | 100 | 5 min | < 200ms avg |
| Perf-003 | API key creation load | 50 | 5 min | < 500ms avg |
| Perf-004 | Webhook trigger load | 50 | 5 min | < 1s avg |
| Perf-005 | Mixed load | 200 | 10 min | < 500ms avg |

### 6.2 Stress Tests

| Test ID | Scenario | Users | Duration | Threshold |
|---------|----------|-------|----------|-----------|
| Stress-001 | Login stress | 500 | 5 min | < 2s p95 |
| Stress-002 | Concurrent writes | 100 | 5 min | No data loss |

---

## 7. SMOKE TESTS

### 7.1 Critical Path Smoke Tests

| Test ID | Test Case | Expected | Priority |
|---------|-----------|----------|----------|
| Smoke-001 | Server starts successfully | 200 on /health | CRITICAL |
| Smoke-002 | Existing auth works | Login succeeds | CRITICAL |
| Smoke-003 | New OAuth endpoints respond | 302 on /auth/google | HIGH |
| Smoke-004 | New MFA endpoints respond | 200 on /auth/mfa/enable | HIGH |
| Smoke-005 | New API key endpoints respond | 200 on /api-keys | HIGH |
| Smoke-006 | New webhook endpoints respond | 200 on /webhooks | HIGH |
| Smoke-007 | Health check works | 200 on /health | HIGH |
| Smoke-008 | Metrics endpoint works | 200 on /metrics | MEDIUM |
| Smoke-009 | Swagger UI works | 200 on /api-docs | MEDIUM |
| Smoke-010 | Versioned endpoints work | 200 on /api/v1/products | MEDIUM |

---

## 8. ROLLBACK TESTS

### 8.1 Rollback Scenario Tests

| Test ID | Scenario | Expected | Priority |
|---------|----------|----------|----------|
| Rollback-001 | Revert OAuth changes | Auth still works | HIGH |
| Rollback-002 | Revert MFA changes | Login still works | HIGH |
| Rollback-003 | Revert API key changes | JWT auth still works | HIGH |
| Rollback-004 | Revert webhook changes | Core features work | MEDIUM |
| Rollback-005 | Full rollback | All existing features work | HIGH |

### 8.2 Data Migration Tests

| Test ID | Scenario | Expected | Priority |
|---------|----------|----------|----------|
| Migration-001 | Existing users unaffected | Users can login | CRITICAL |
| Migration-002 | Existing tokens valid | Tokens not invalidated | CRITICAL |
| Migration-003 | Existing data intact | No data loss | CRITICAL |

---

## 9. TEST EXECUTION SCHEDULE

| Phase | Tests | Duration | Gate |
|-------|-------|----------|------|
| Unit tests | All U-* | Continuous | Every commit |
| Integration tests | All I-* | Continuous | Every PR |
| Security tests | All S-* | Weekly | Gate C |
| Regression tests | All R-* | Every PR | Gate C |
| Performance tests | All Perf-*, Stress-* | Pre-release | Gate D |
| Smoke tests | All Smoke-* | Every deployment | Gate E |
| Rollback tests | All Rollback-*, Migration-* | Pre-release | Gate F |

---

## 10. TEST ENVIRONMENTS

| Environment | Purpose | Data | Access |
|-------------|---------|------|--------|
| Development | Unit + integration | Mock/seed | Developers |
| CI/CD | All automated | Mock/seed | Automated |
| Staging | Full regression | Production clone | QA team |
| Pilot | Production-like | Anonymized | Pilot users |
| Production | Smoke only | Real data | Automated |

---

## 11. TEST REPORTING

### 11.1 Coverage Requirements

| Metric | Minimum | Target |
|--------|---------|--------|
| Line coverage | 80% | 90% |
| Branch coverage | 75% | 85% |
| Function coverage | 85% | 95% |
| Statement coverage | 80% | 90% |

### 11.2 Quality Gates

| Gate | Condition | Action |
|------|-----------|--------|
| Unit tests | 100% pass | Block merge |
| Integration tests | 100% pass | Block merge |
| Coverage | >= 80% | Block merge |
| Security tests | 0 critical | Block release |
| Performance | Within threshold | Block release |
| Regression | 100% pass | Block release |

---

**Document Generated:** 2026-08-05
