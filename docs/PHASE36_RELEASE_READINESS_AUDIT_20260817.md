# Phase 36 — Release Readiness / Production Hardening Audit

**Date:** 2026-08-17
**Mode:** READ-ONLY audit. No source/test/config changes, no commits, no pushes.
**HEAD:** `b99591a`

---

## 1. Executive Summary

OmniStore ERP is in a **strong production-readiness position**:

- **Full test matrix green:** Jest 86 suites / 1175 tests, modulePlatform 10/10, pluginSdk 16/16, uat 1/1, uatFeedback 1/1. Every previously red suite is fixed (Phases 35.2/35.3).
- **Security architecture is sound:** server-authoritative JWT auth with token versioning, tenant-carry in signed claims (never client input), AsyncLocalStorage request-scoped tenant store, repository-level tenant filtering/stamping, server-side `requirePlatformAdmin` independent of tenant roles, suspended-company login rejection, helmet CSP, body sanitization, rate limiting.
- **Tenant isolation proven by tests:** cross-tenant read/mutation blocking and data-loss protection are explicitly tested (`companyProvision.test.js`, `cairoTechIsolation.test.js`).
- **Update machinery is real and matches code:** SHA-256 verification → backup → atomic swap → restart → health check → rollback, with release-candidate validation documented for 1.0.0/1.0.1/1.0.2.
- **Documented gap:** the release artifacts predate Phase 34/35 — a fresh release including the navigation architecture, dashboard builder, and consolidated platform work has not been built/validated.

**Verdict: GO WITH CONDITIONS.** No P0 blockers. A small set of P1/P2 production-configuration and hygiene items should be resolved before or with the next release build.

## 2. Git Baseline

- HEAD: `b99591a` (`fix(uat): update service-worker version assertions to v45`) — verified.
- History intact: `b99591a` → `c35831c` → `a6b28f5` → `8d4ce3d` → `50833cb` → `dfdfa59` → `9715fce` → `b6ea7a3` → …
- `git status`: clean for tracked files (no modifications, nothing staged).
- Untracked (8 expected exclusions, all present, none deleted):
  `.freebuff/`, `.freebuffpreview-*.log.err`, `PHASE72_DISCOVERY.txt`, `backend/data/users.json`, `diffnames.txt`, `diffstat.txt`, `docs/PHASE35_DISCOVERY_AND_PLAN_20260817.md`, `docs/PHASE35_1_PREEXISTING_WORK_STAGING_REPORT_20260817.md`.

## 3. Test Matrix (independently re-verified this phase)

| Suite | Result |
|---|---|
| Full Jest (backend) | **86 suites / 1175 tests PASS** |
| services/modulePlatform | **10 / 10 PASS** |
| services/pluginSdk | **16 / 16 PASS** |
| services/uat | **1 / 1 PASS** |
| services/uatFeedback | **1 / 1 PASS** |

All suites green — no regressions, no environment issues, no stale tests discovered.

## 4. Security Audit

### Authentication / JWT
- `authMiddleware` populates `req.user` only from a verified, non-revoked access token; route protection is opt-in via `requireAuth`/`requireRole`. ✔
- JWT claims: `sub`, `username`, `role`, unique `jti` (per-issuance, supports token-level revocation), optional `tenantId` (Phase 19) and `ver` (Phase D token version). ✔
- Token-version enforcement: a token signed before a password change/reset is rejected against the stored record. ✔
- Refresh tokens signed with a separate secret, type-flagged. ✔

### Tenant resolution / propagation
- `tenantStore` = AsyncLocalStorage-backed, fresh empty context per request (no cross-request leakage); `tenantCarry` reconstructs `req.tenantContext` **only from the signed token claim** — never query/body/header. ✔
- `companyContext` (multi-company login) resolves the tenant at login POST only; unknown/inactive companies fall back without inventing a tenant. ✔
- `authorize.resolveTenantRoleForRequest`: effective role from the REAL user record, gated on token-claim ↔ context agreement (never escalates; falls back to global role). ✔
- Suspended companies cannot be logged into (`403 COMPANY_SUSPENDED` in auth controller). ✔

### Repository tenant isolation (BaseRepository)
- Read filtering: records with `tenantId === current` visible; other-tenancy hidden; legacy records (no tenantId) remain visible (documented backward-compatible behavior). ✔
- Write stamping: new records get the current tenant stamped; a record claiming a different tenantId is rejected. ✔
- Caveat (documented, pre-existing): cross-tenant safety depends on the feature flags (`ENABLE_TENANT_*`); the isolation tests cover the enabled path. ✔

### Platform admin
- `requirePlatformAdmin` runs after `requireAuth`, checks the REAL user record against the server-side `platformAdmins.json` store; never reads client tenant input; `PLATFORM_ADMINS` env seeds `MASTER_OWNER` only when the store is empty. ✔
- A tenant Owner/Admin is NOT a platform admin unless their username is in the store. ✔
- Platform scope is separate from tenant scope; frontend cannot flip it (`platformRole` is script-scoped, server-authoritative). ✔

### Frontend tenant storage / company switching
- `getDbStorageKey()` prefers the JWT tenant claim and auto-corrects a tampered `ACTIVE_TENANT_ID`; scoped `cairo_db_v7_<tenantId>` stores. ✔
- `renderCompanyOptions` + `setActiveTenantId` drive company switching client-side, but backend authorization remains authoritative (navigation hiding is UX-only). ✔
- No authorization bypass through `showPage`/navigation found (Phase 34.2 verified; direct-`showPage` reachability of platform pages for a plain Admin is a **documented pre-existing** behavior, backend-gated). ✔

### Service worker / update
- `sw.js` v45 cache invalidation (skips old `digitronics-pwa-*` / `omnistore-erp-*` caches), `skipWaiting`, background-sync version message. ✔

**No tenant-isolation or authorization bypass found.**

## 5. Secret Audit

- `git grep` over tracked content for private keys / live API keys / service-role values / GitHub tokens / cloud keys: **clean**. The only matches are `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` environment lookups in `supabase/functions/*` (references, not values). ✔
- No hardcoded machine-specific absolute paths in tracked source. ✔
- `backend/data/users.json` (untracked) contains a **bcrypt password hash** (`$2b$10$…`) — credential-bearing runtime store. It is **NOT staged/committed**, but it is **NOT in `.gitignore`** (only `apiKeys.json` and `auditLog.json` are). → **P1: add to `.gitignore`** so it can never be committed accidentally.
- `.env*` files are gitignored; `.env.example` files exist at root and `backend/` with clear "never commit" instructions. ✔
- Runtime data present in working tree: `users.json` only (blocked from staging); no other credential stores found.

## 6. Configuration Audit

| Item | Status |
|---|---|
| `JWT_SECRET` | Env-driven; **boot warning in production if left as `dev-secret`** (server.js:302). Production must set it. ✔ (config) |
| `JWT_REFRESH_SECRET` | Defaults to `JWT_SECRET + ':refresh'`; override available. ✔ |
| `AUTH_REQUIRED` | Defaults **false** (legacy open behavior). **Production must set `AUTH_REQUIRED=true`** → P1 (config). |
| `CORS_ORIGINS` | Defaults to **open CORS** when unset. Production must set the allowlist → P1 (config). |
| Helmet CSP | Locked down (no eval/frames/objects; script-src includes cdnjs/jsdelivr; inline allowed for the legacy single-file app). **Includes a legacy Supabase host** (`fkcaexpuagvxaljremzm.supabase.co`) in `connectSrc` — the frontend no longer uses legacy Supabase keys (emptied in Phase 33 work). Leftover reference → **P2: remove** (hardening). |
| Body limit / rate limits | `10mb`, `1000` per IP per 15 min (apiKey: 500) — reasonable defaults. ✔ |
| Error handling | Production returns generic 500 without internals; errors captured by error tracker. ✔ |
| Logging | Dev-only morgan; slow-request logger always on; `LOG_FILE` optional. ✔ |
| `NODE_ENV` | `development` default; production must set `NODE_ENV=production`. ✔ (config) |

## 7. Update / Release System Audit

- **Contract matches code:** `generate-manifest.js` builds `backend/data/updateManifest.json` (version, HTTPS URL, sha256, notes — never secrets); `update.service.js` reads it; `apply-update.js` performs: download → **SHA-256 verify** → backup (last 2 retained) → atomic swap → restart → health check → **auto-rollback** on failure. ✔
- `apply` route is Owner/Admin/Manager-gated; `manifest` is public (no secret leak). ✔
- `config.update.appRoot` / `manifestPath` / `checkIntervalMs` env-configurable. ✔
- Release candidate validation (`RELEASE_CANDIDATE_REPORT.md`) proves 1.0.0 install / provision / use / update to 1.0.1 / rollback from broken 1.0.2 on Windows with zero data loss. ✔
- **Gap:** artifacts (1.0.0/1.0.1/1.0.2) predate Phase 34/35. A new release including the navigation architecture, dashboard builder, and consolidated platform/tenant work has **not** been built or re-validated → **P1/P2: build + validate a fresh release**.

## 8. Provisioning Audit

- `companyProvision.service.js`: validates companyId/branch/admin inputs server-side; generates/validates tenantId; creates company, Owner admin with company-scoped membership + tenantRoles; bcrypt-hashes admin password (never logged/returned); stamps the **new tenantId only** — no data inheritance. ✔
- `provision-company.js` CLI is idempotent (existing company reused, existing password never changed). ✔
- Tests prove cross-tenant mutation is blocked and the other tenant survives (`companyProvision.test.js:244`; `cairoTechIsolation.test.js`). ✔
- **No path found by which a newly provisioned company inherits another company's data.**

## 9. Module Platform Audit (dashboardBuilder)

- Post-fix `dashboardBuilder.js`: collects module widgets (`moduleId = module.id`) from active modules + plugin dashboardCards (`moduleId = 'plugin:<id>'`) from active plugins; renders `data-module-widget`-tagged `.stat-card` markup into `#omniDynamicDashboardWidgets`; all interpolated values escaped (`escapeHtml`); routes become `showPage('<route>')` onclick; `updateVisibility()` preserved; returns the widget array; public API `{ build, updateVisibility }` unchanged. ✔
- Empty state: no widgets → empty innerHTML, no crash. ✔
- Disabled modules excluded via `getActiveModules()`; disabled plugins excluded via `getActivePlugins()`. ✔
- Malformed definitions guarded (`(module.widgets || [])`, `(plugin.dashboardCards || [])`, metadata null-checks). ✔
- ModuleLoader + moduleAdapters both re-invoke `OmniDashboardBuilder?.build()` on state changes. ✔
- **No defect found; not rewritten.**

## 10. Frontend / UX Production Check

- Login (`doLogin`), company selection (`loginCompany` + `renderCompanyOptions`), scope switching (Company/Master/Internal pills), Settings Hub + live search, mobile drawer, navigation — all verified live in prior phases; preview healthy (HTTP 200 at 127.0.0.1:3003 this audit). ✔
- Registration modal: `startUserRegistrationTimer()` is a **no-op** (never auto-shows after login); `saveUserRegistration()` + `#userRegOverlay` markup + explicit entry points fully preserved. ✔
- Unauthorized navigation: master/internal hidden for tenant users; `platform-master` gated in `canAccessPage`; backend remains authoritative. ✔
- Placeholders render clean alerts (see §11). ✔

## 11. Placeholder Assessment

- **PlayStation** and **Car Rental** are intentional roadmap placeholders: nav entries + `page-*` divs with a "وحدة قادمة — متاحة حالياً كمكان مؤقت فقط" (coming later, placeholder only) notice; registered in `moduleRegistry` with `engineEnabled: false`, mapped to `manageSettings`. No engines, routes, or data models.
- **Determination: intentionally deferred, NOT production blockers.** They are clearly labeled and do not affect any other functionality. Recommendation: keep as placeholders; implement only when business demand justifies full modules.

## 12. Documentation Audit

Present and substantive: `GO_LIVE.md`, `KOYEB_DEPLOYMENT.md`, `DEPLOYMENT.md`, `OPERATIONS.md`, `DISASTER_RECOVERY.md`, `PRODUCTION_CHECKLIST.md`, `SECURITY_CHECKLIST.md`, `FIRST_COMPANY_ACCEPTANCE.md`, `RELEASE_CANDIDATE_REPORT.md`, plus `docs/` phase reports and `Documentation/` architecture/ADR folders.

**Contradictions found:**
1. `RELEASE_CANDIDATE_REPORT.md` validates artifacts that predate Phase 34/35 — the documented release does not contain the current HEAD's frontend/navigation/platform work (same as §7 gap).
2. Docs reference ports 3001 (backend) / 3100 (update test server); the live preview runs on 3003 — a session/preview artifact, not a doc error, but worth noting.
3. `GO_LIVE.md` describes the PWA flow and ports accurately; no functional contradictions with code found in the audited sections.

## 13. Findings (P0/P1/P2/P3)

**P0 (0):** none.

**P1 (3):**
1. `backend/data/users.json` (bcrypt credential store) not in `.gitignore` — add next to `apiKeys.json`/`auditLog.json`.
2. Production config documentation/enforcement: `AUTH_REQUIRED=true` and `CORS_ORIGINS` allowlist must be set in production (both default to open/legacy behavior).
3. Fresh release artifact including Phase 34/35 must be built and re-validated (update + rollback) before the release is declared current.

**P2 (3):**
1. Remove the legacy `fkcaexpuagvxaljremzm.supabase.co` host from the CSP `connectSrc` (dead reference after Phase 33 key removal) — hardening.
2. Decide on PlayStation / Car Rental: keep documented placeholders (recommended) or scope full modules; either way, add them to the roadmap doc.
3. Align release documentation (RELEASE_CANDIDATE_REPORT / GO_LIVE) with a new build once produced.

**P3 (3):**
1. Triage leftover untracked diagnostics: `PHASE72_DISCOVERY.txt`, `diffnames.txt`, `diffstat.txt`, `.freebuff/`, preview logs (archive or delete per policy; do not commit).
2. Root-level README missing (docs live in `docs/` + `Documentation/`).
3. Pre-existing trailing whitespace in `scripts/async-*.js`, `scripts/fix-services.js`, `FIRST_COMPANY_ACCEPTANCE.md` (cosmetic).

## 14. Recommended Next Phases

1. **Phase 36.1 (P1, small):** `.gitignore` for `backend/data/users.json` + CSP legacy-Supabase-host removal + whitespace cleanup. Tiny, test-safe.
2. **Phase 36.2 (P1, config):** Production hardening doc/checklist — assert `AUTH_REQUIRED`, `CORS_ORIGINS`, `JWT_SECRET`, `NODE_ENV` at boot (fail-fast or loud warnings), matching the existing `JWT_SECRET` warning pattern.
3. **Phase 36.3 (P1, release):** Build a fresh release artifact from HEAD (build-release.js + generate-manifest) and re-run the release-candidate validation (install/update/rollback) including Phase 34/35 content.
4. **Phase 36.4 (P3):** Diagnostics triage + root README.

## 15. Explicit GO / NO-GO Recommendation

**GO WITH CONDITIONS.**

- The codebase is security-sound, fully tested (all suites green), tenant-isolated, and the update/provision machinery is real and validated.
- Conditions before declaring a production release current:
  1. Set production env (`AUTH_REQUIRED=true`, `CORS_ORIGINS`, strong `JWT_SECRET`, `NODE_ENV=production`).
  2. Gitignore `backend/data/users.json`.
  3. Build and validate a fresh release artifact from HEAD (includes Phase 34/35).
- These are config/hygiene/release items — **no P0 blockers and no code-level security defects** were found.
