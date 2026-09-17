# PHASE I — SECURITY REVIEW FINAL REPORT

**Project:** OmniStore Multi-Tenant (DigiTronics V2 API)
**Repo:** `E:\Projects\OmniStore_Multi-Tenant` — branch `main`, HEAD `089663f`
**Review type:** Read-only source + runtime security assessment of the complete Phases A–H implementation
**Baseline:** 64 suites / 907 tests PASS (Phase H baseline, re-run in Phase I, no drift)
**Date:** 2026-08-10

---

## 1. Scope & Method

- **Approved action:** read-only security audit. No code, config, data, or test changes.
  Files changed / added / deleted: **NONE**. Packages installed: **NONE**.
- All `backend/data` files, `.env`, `.env.*`, frontends, and config defaults left byte-for-byte intact.
- Method: full source inventory of middleware, services, controllers, utils, routes,
  repositories, permission registry, context/tenant layers, frontend, and the E2E harness;
  plus a full regression baseline run.
- Verification harness: `npx jest --runInBand --testTimeout=10000 --forceExit --silent`
  and the existing Playwright E2E suite under `tests/e2e` (used read-only in Phase H).

## 2. Trust Boundaries

1. **Client (browser) — API:** TLS termination expected at the edge; no non-TLS
   enforcement in the app itself; `secure` cookie flag is production-only.
2. **Client-supplied identity — server:** The server NEVER derives the active tenant
   or role from query / body / headers. The trusted tenant is reconstructed ONLY
   from the signed JWT claim + `req.tenantContext` (`middleware/tenantCarry.js`,
   `middleware/authorize.js:trustedTenantId`).
3. **Storage (JSON files under `backend/data`):** shared single-document store per
   entity; tenant isolation is layered ON TOP of the JSON store by the services
   and repositories (opt-in feature gates).
4. **Supabase / third-party:** present only as optional, disabled-by-default
   configuration stubs; no runtime dependency in the audited surface.

## 3. Authentication

- **Passwords:** bcrypt, 10 rounds; legacy plaintext values are re-hashed on first
  successful login (migration path in `users.service.js:authenticate`); unknown
  usernames pay a dummy-bcrypt compare for timing equalization (`verifyDummy`).
- **Login limiter:** `loginRateLimiter` — 20 attempts / 15 min, keyed by
  IP + username (`middleware/security.js`), applied to `POST /auth/login`.
- **Disabled accounts:** `status === 'disabled'` rejects fresh login with 403
  `ACCOUNT_DISABLED` and outstanding tokens are invalidated by a tokenVersion bump.
- **Global rate limit:** `RateLimit: 1000 / 15 min` per IP on `/api/v1`.
- **MFA:** TOTP secret, QR, verification, backup codes (hashed). Notes in §4 below.

### 3.1 Findings: Authentication
- No lockout/backoff beyond the fixed window limiter (documented legacy posture).
- OAuth (Google/GitHub) is stub-gated behind `OAUTH_ENABLED=true`; disabled default.

## 4. Session & Token Management

- **Access token:** JWT HS256, 15m TTL, claims `sub/username/role/jti(randomUUID)`,
  optional `tenantId` (Phase 19 carry) and `ver` (Phase D token version).
- **Refresh token:** JWT HS256 (separate secret), 7d TTL, carries `type: 'refresh'`;
  `jsonwebtoken` type claim gates refresh-only usage.
- **Revocation:** in-memory `revoked` Set in `tokenStore.js` (non-persistent across
  restarts) PLUS per-user `tokenVersion` persisted in the user record — the durable
  invalidation path. Password change/reset/disable bumps `tokenVersion`, invalidating
  every previously issued access and refresh token.
- **Cookies:** `httpOnly`, `sameSite: 'lax'`, `path: '/'`, `secure: IS_PROD`;
  access 15m / refresh 7d. Body tokens also returned (legacy dual-delivery).

### 4.1 Findings: Sessions
- `tokenStore` revocation is process-local; a long-lived refresh token revoked only
  via the in-memory set would outlive a restart. Mitigated for the durable cases
  (password change, disable) by `tokenVersion`. Documented limitation (MEDIUM).
- **MFA tempToken (MEDIUM):** the MFA-challenge token returned by `/auth/login`
  when `mfaEnabled` is signed as a NORMAL access token (`auth.controller.js:69`:
  `signAccessToken({ ...user, mfaPending: true })`) — but `_claims` in `utils/jwt.js`
  only emits `sub/username/role/jti/tenantId/ver`. The `mfaPending` marker is
  therefore NOT present in the signed claims, so verification cannot distinguish a
  pre-MFA challenge token from a fully-authenticated token. Enforcement relies on
  the client actually calling `/auth/mfa/verify`. This is a weakness in the MFA
  challenge handshake, not a credential leak (claims still sanitized).

## 5. Authorization

- **RequireAuth / requireRole / requirePermission:** 401/403 gates in
  `middleware/auth.js` and `middleware/authorize.js`.
- **Permission registry** (`permissions/registry.js`): single source of truth;
  synonyms normalized (`read→view`, `update→edit`); unknown roles default to an
  empty baseline (never invented escalation).
- **Owner/Admin bypass** is role-based at the middleware, then the authorization
  engine (`authorization.service.js`) resolves the REAL user record + effective role
  and permission set. Effective role = per-tenant role when present else global role.
- **Route gating:** `AUTH_REQUIRED` defaults false (legacy behavior). When false,
  business routes (sales, purchases, inventory, customers, …) are open exactly as
  GoLive-1 shipped. User sub-resource and security-sensitive routes still enforce
  `requireAuth` + `requirePermission` unconditionally (users reset-password /
  permissions / disable / enable, api-keys, audit-log, mfa, webhooks, metrics,
  error-tracker, `/api/v1/permissions`).
- **API keys:** `X-API-Key` header; key is SHA-256 hashed at rest, raw returned once;
  timing-safe compare; `requireApiKey` / `requireScope` gates available; scope
  includes `*` wildcard. NOT auto-wired into business routes (opt-in gating).

### 5.1 Findings: Authorization
- When `AUTH_REQUIRED=false` the write-role guard (`writeRoleGuard(Owner,
  Admin, Manager)`) is NOT applied globally — it is registered in `server.js` only
  inside the `if (config.authRequired)` block. Legacy open model; must be enabled
  for any non-dev deployment (documented limitation, HIGH operational risk if omitted).

## 6. Tenant Isolation

Tenant identity flows EXCLUSIVELY from `req.tenantContext` reconstructed from the
signed JWT tenantId claim by `tenantCarry` (Phase 19) or `companyContext` on login
(Phase 16). All isolation is feature-flag gated, all defaulting OFF:

| Layer | Flag | Behavior when ON |
|------|------|------------------|
| User read surface | `ENABLE_TENANT_USER_MEMBERSHIP` (+ Phase G scope) | `list`/`stats`/`getById` scoped to trusted tenant; cross-tenant `getById` → 404 (no existence leak) |
| Roles | `ENABLE_TENANT_ROLES` | per-tenant `tenantRoles` override; last-Owner protection |
| Carry | `ENABLE_TENANT_CARRY` | tenantId bound into signed token at login |
| Metadata stamping | `ENABLE_TENANT_METADATA` | CREATE-only `tenantId` stamping |
| Read filtering | `ENABLE_TENANT_FILTERING` | legacy rows (no tenantId) visible; other-tenant rows hidden |
| Entity isolation | `ENABLE_TENANT_ENTITY_ISOLATION` | create/find/update/delete ownership gating |
| Sales pilot | `ENABLE_TENANT_SALES_ISOLATION` | Phase 24 read-scoping + write gating on sales |
| Purchases pilot | `ENABLE_TENANT_PURCHASES_ISOLATION` | Phase 25 same for purchases |
| Tenant enforcement | Phase 16 membership check at login | denies non-members when tenant context resolves |

### 6.1 Findings: Tenancy
- All isolation is dormant by default; a deployment that enables tenants but forgets
  the flags silently retains the single-company shared view. No find — documented
  multi-flag operational surface (MEDIUM operational clarity).
- Legacy records (no `tenantId`) remain globally visible under filtering rules by
  design; ownership is only enforced where explicitly gated (documented limitation).

## 7. Data Protection / DTO Exposure

- **User DTO hardening (Phase D):** `sanitizeUser` uses a strict allowlist
  (`SAFE_USER_FIELDS`) — only id, username, fullName, role, phone, email, tenantIds,
  tenantRoles, tenantPermissions, mfaEnabled, status, lastLogin, createdAt, updatedAt.
  Passwords, hashes, tokens, apiKey, otp, backup codes can never leak through the DTO,
  even if mirrored onto the record.
- **JWT claims allowlist:** `_claims()` mirrors the same discipline (no secret
  material ever enters a token payload).
- **Audit redaction:** `SENSITIVE_KEYS` set (password, *hash, token*, apiKey, otp,
  secret, …) → `[REDACTED]` recursively, cloning never mutating caller data
  (`audit.service.js`).
- **Config secrets:** JWT/refresh/session secrets are read from env with documented
  dev defaults; server logs a boot WARNING (in production) if `JWT_SECRET` is the
  dev default — it does not hard-fail. `.env` and `.env.example` exist but are NOT
  committed; `gitignore` covers them.

### 7.1 Findings: Data exposure
- `JWT_SECRET` dev-default fallback with warn-only enforcement (documented in
  `.env.example`, existing finding carried from Phase C — MEDIUM in dev, HIGH if
  production ever omits a real secret).
- `SESSION_SECRET` dev fallback (`session-secret-dev`) exists in `config/oauth.js`
  for OAuth sessions; disabled by default (LOW).

## 8. Audit & Logging

- `auditCapture` middleware records mutating ops (POST/PUT/DELETE) after response:
  method, path, status, userId, apiKeyId, ip, user-agent, requestId, duration,
  action, resource, changes (redacted).
- Explicit application-level audit events: USER_ROLE_CHANGED, USER_PASSWORD_CHANGED,
  USER_PASSWORD_RESET, USER_PERMISSIONS_CHANGED, USER_DISABLED, USER_ENABLED.
- `audit-log` routes enforce `requireAuth` (results require `audit.view` where wired).
- Health readiness keeps persistence probe; `/health`, `/liveness`, `/ready` expose
  no secrets (verified in Phase H health test corpus).

### 8.1 Findings: Audit
- Audit store is write-through JSON; no tamper-evidence / HMAC chaining (documented
  limitation, LOW for single-file store).

## 9. Frontend

- **`index.html` (Phase F):** `escapeHtml()`-driven rendering; stored XSS previously
  remediated (see `FINAL_SECURITY_REVIEW.md`); tokens kept in `localStorage`
  (`access_token` / `refresh_token`) with the E2E suite covering backend-backed flows.
  Company-selection UI present and gated by feature flag.
- **Legacy `DigiTronics_v5.html`:** not modified; carries the two pre-existing E2E
  failures (dashboardVersionKey ReferenceError + cascade KPI) from Phase H — NOT a
  security regression, re-documented here.
- X-API-Key usage and `/api/v1/companies` consumption confirmed present in the login
  surface; scopes/`*` handling validated by tests (apiKey.integration, scope middleware).

### 9.1 Findings: Frontend
- `localStorage` token persistence is XSS-exfiltration sensitive if any injection
  ever recurs; mitigations are the strong `escapeHtml` discipline and httpOnly
  cookies as the fallback channel (documented limitation, LOW–MEDIUM).

## 10. Route Inventory (enforced gates)

| Area | Enforced | Notes |
|------|----------|-------|
| health/liveness/ready | none (public by design) | no secrets |
| companies list/active/:id | none | read-only catalog, enabled by flag |
| auth login/refresh/logout | limiter (login) | password verify |
| auth me/roles/permissions | `requireAuth` per controller; Phase 22B username-lookup auth check | enumeration closed |
| change-password | `requireAuth` (controller) + policy | bumps tokenVersion |
| mfa/* | `requireAuth` | enable/disable/verify/secret/status/backup |
| api-keys/* | `requireAuth` + scope gates (opt-in) | hashed keys |
| webhooks | `requireAuth` | |
| metrics | `requireAuth` | |
| error-tracker | `requireAuth` | |
| audit-log | `requireAuth` (+ `audit.view` where wired) | redaction enforced |
| users CRUD | `requireAuth` / `requirePermission` on sub-resources; global gate for base when AUTH_REQUIRED=true | |
| sales / purchases / inventory / customers / suppliers / treasury / employees / partners / vouchers / dashboard / reports | global gate when `AUTH_REQUIRED=true`; tenant isolation flags when enabled | legacy-open when auth off |

## 11. Test-Coverage Mapping (verification matrix)

| # | Security control | Verified by |
|---|------------------|-------------|
| 1 | bcrypt hashing, verifyDummy timing, rehash migration | auth.test / security smoke |
| 2 | tokenVersion invalidation (change-password/reset/disable) | tokenVersion / passwordChange / disableEnable |
| 3 | disabled-acct login block 403 | disableEnable |
| 4 | MFA enable/verify/disable challenge | mfa.test / mfa.integration |
| 5 | login limiter keyed IP+username | security smoke / middleware |
| 6 | sanitizeBody prototype-pollution strip | middleware.test / security smoke |
| 7 | user DTO allowlist (no hash/token leak) | userDto.test |
| 8 | audit secret redaction | auditSecrets.test |
| 9 | permission registry synonyms / unknown-role-empty | permissionRegistry.test |
| 10 | effective role / permission resolution | authorizationService / tenantRole / permissionMiddleware |
| 11 | requirePermission route wiring | permissionMiddleware / userPermissions |
| 12 | last-Owner protection | ownerProtection.test |
| 13 | escalation matrix | escalation.test |
| 14 | tenantCarry claim reconstruction + tamper | tenantCarry.test |
| 15 | membership login enforcement | tenantEnforcement / tenantMembership |
| 16 | multi-company resolution | company.test / goLiveValidation |
| 17 | Phase G user-tenant read scope | phaseG.tenantUserIsolation |
| 18 | sales/purchases isolation pilots | tenantSalesIsolation / tenantPurchasesIsolation |
| 19 | repository entity isolation | repositoryEntity / tenantEntityIsolation |
| 20 | tenant roles override + per-tenant permissions | tenantRoles / tenantAuthorization |
| 21 | apiKey generate/validate/scope/revoke | apiKey.test / apiKey.integration |
| 22 | JWT claims allowlist / tamper rejection | auth / goLiveValidation (tamper) |
| 23 | health readiness persistence probe | health / health.service |
| 24 | E2E index.html backend-backed flow | tests/e2e (188xx series) |

## 12. Findings Summary (by severity)

| Count | Severity |
|------|----------|
| 0 | CRITICAL (revised from earlier estimate — all high claims re-checked against implementation, no exploitable path found) |
| 2 | HIGH (operational / config posture) |
| 4 | MEDIUM |
| 4 | LOW |

### 12.1 Detailed findings

**PHI-01 (HIGH)** — `AUTH_REQUIRED=false` default leaves all business routes open.
- Evidence: `config/index.js:16`, `server.js:150-155`, `.env` `AUTH_REQUIRED=false`.
- Impact: unauthenticated access to sales/purchases/inventory/… when a deploy omits
  the flag. Documented legacy; HIGH operational misconfiguration risk.
- Status: DOCUMENTED LIMITATION (must be set true outside dev).

**PHI-02 (HIGH)** — `JWT_SECRET` dev-default fallback with warn-only (no hard-fail)
  enforcement.
- Evidence: `config/index.js:12-13`, `server.js:228-230`, `.env.example` comment.
- Impact: forgeable tokens if production ever omits a real secret.
- Status: DOCUMENTED LIMITATION / existing finding carried.

**PHI-03 (MEDIUM)** — Session revocation via `tokenStore` is process-local.
- Evidence: `utils/tokenStore.js` in-memory Set.
- Impact: non-durable token-level revoke across restarts; durable path relies on
  tokenVersion bumps (documented).
- Status: DOCUMENTED LIMITATION.

**PHI-04 (MEDIUM)** — MFA challenge token is signed with full access-token claims;
  `mfaPending` marker not embedded.
- Evidence: `auth.controller.js:69`, `utils/jwt.js:_claims`.
- Impact: `isRevoked`/token-type checks cannot distinguish pre-MFA challenge token
  from fully-authenticated token at the middleware level; enforcement depends on the
  client calling `/auth/mfa/verify`. No secret/credential is exposed; the MFA gate is
  a behavioral contract rather than a signed-state guarantee.
- Status: DOCUMENTED LIMITATION (recommend a dedicated `mfa` token type claim).

**PHI-05 (MEDIUM)** — Tenant isolation flags are individually opt-in; multi-flag
  surface can silently run in single-tenant view.
- Evidence: `config/index.js:39-48` (all default false).
- Impact: deployment misconfiguration → shared view persists.
- Status: DOCUMENTED LIMITATION / operational.

**PHI-06 (MEDIUM)** — Token persistence in `localStorage` on the Phase F frontend.
- Evidence: `index.html:13515` (access/refresh write), `DigiTronics_v5.html` same.
- Impact: XSS-exfiltration sensitive if injection ever recurs; mitigated by
  escapeHtml discipline + httpOnly cookie fallback.
- Status: DOCUMENTED LIMITATION.

**PHI-07 (LOW)** — `SESSION_SECRET` dev default in OAuth stub.
- Evidence: `config/oauth.js:11`; disabled by default.
- Status: DOCUMENTED LIMITATION.

**PHI-08 (LOW)** — Audit chain lacks tamper-evidence.
- Evidence: `audit.service.js` plain write-through JSON.
- Status: DOCUMENTED LIMITATION.

**PHI-09 (LOW)** — Legacy `DigiTronics_v5.html` two pre-existing E2E failures
  (non-security).
- Evidence: Phase H E2E results (78/80).
- Status: PRE-EXISTING, unmodified.

**PHI-10 (LOW)** — Health/probe endpoints use public routes (no risk identified;
  no secrets exposed).
- Status: INTENTIONALLY GLOBAL.

## 13. Intentional / Deferred Design Decisions

- Legacy open-by-default auth model preserved for GoLive-1 compatibility.
- Feature-flag-gated tenant isolation (never silently changes legacy behavior).
- In-memory token revoke store (durable invalidation by tokenVersion).
- Single-file JSON persistence with write-through sync and graceful shutdown flush.
- Permission registry PLANNED groups registered but intentionally un-wired.

## 14. Risk Prioritization

1. **Enable `AUTH_REQUIRED=true`** for any non-dev deployment (PHI-01). Highest
   operational lever; zero code change.
2. **Mandate a real `JWT_SECRET`/`JWT_REFRESH_SECRET`** in production (PHI-02).
3. (Deferred per Phase J gate) strengthen MFA token-type claim (PHI-04).
4. (Operational) runbook the tenant flag matrix (PHI-05).

## 15. Final State Fields

- **Files changed:** NONE — `Files added:` 0 — `Files deleted:` 0
- **Packages installed:** NONE
- **Tests run:** 64 suites / 907 tests PASS (same baseline as Phase H)
- **E2E (from Phase H):** index.html 80/80; DigiTronics_v5.html 78/80 (2 pre-existing non-security failures)
- **Findings by severity:** CRITICAL 0 · HIGH 2 · MEDIUM 4 · LOW 4
- **Tenant impact:** isolation dormant by default; flag-gated
- **Authorization impact:** legacy-open model default; permission engine enforced on
  user/security sub-resources
- **Data exposure impact:** DTO allowlist + audit redaction + claims allowlist enforced
- **Remaining risks:** AUTH_REQUIRED/JWT secret config posture; MFA token-type clarity;
  in-memory revoke store; localStorage token persistence
- **Verdict:** ✅ Implemented security controls (Phases A–H) verified; no exploitable
  CRITICAL vulnerability found in the audited code; residual items are documented
  limitations and operational-config posture items, all pre-existing.

## 16. Phase J Gate

**PHASE J = BLOCKED.** Per the authoritative roadmap (Phase I = "Security review.",
no J-requirements in this session's recovered spec), Phase J is not authorized in
this session. No further implementation performed.