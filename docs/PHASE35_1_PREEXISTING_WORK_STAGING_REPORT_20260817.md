# Phase 35.1 Pre-existing Work Staging Report

**Date:** 2026-08-17
**Mode:** Read-only audit + staging preparation. No commit, no push, no application-code modification.
**HEAD:** `8d4ce3d` — `feat(navigation): complete Phase 34 navigation and UX hardening`

---

## 1. Baseline

| Item | Value |
|---|---|
| HEAD | `8d4ce3d` (Phase 34 commit, unchanged) |
| Prior commits | `50833cb` (security/multi-tenant hardening), `dfdfa59` (Render PORT fix) |
| Modified files (pre-existing) | 38 |
| Untracked files (pre-existing + new) | 49 total → 44 staged, 5 blocked/kept out |
| Staged files | 82 (38 M + 44 A) |
| Full Jest | 86 suites / 1175 tests PASS (re-verified this phase) |
| Known non-Jest failures | 4 (modulePlatform, pluginSdk, uat, uatFeedback) — untouched, not fixed |

## 2. Modified Files Classification

All 38 modified files classified **A. PRE-EXISTING WORK — SAFE CANDIDATE FOR COMMIT**:

- **backend/ (35 files):** config, 9 controllers (auth, company, customers, inventory, inventoryTransactions, purchase, sales, treasury, users), data/companies.json (adds the `cairotech` company), 3 middleware (security, tenantStore), permissions/registry, 2 repositories (BaseRepository, storageAdapter), 9 routes, server.js, 9 services, utils/fileStore. Content verified via diff: async conversion (`*Async` methods, AsyncLocalStorage tenant store, asyncHandler wiring), tenant-scoped storage, backend-queue tenant tagging, authorization service refinements. No Phase 34 markers.
- **index.html:** only the pre-existing Phase 33/tenant/login/platform hunks remain unstaged (see §7).
- **package.json:** +3 scripts (`provision`, `update:manifest`, `build:release`) — all reference the pre-existing untracked scripts. Belongs to pre-existing project work.
- **sw.js:** version bump `v44-dashboard-v6-sw-reload-v2` → `v45-cairotech-isolation-v1`. Legitimate source change (cache-busting for the new build), consistent with prior committed version bumps.

## 3. Untracked Files Classification

**A. PRE-EXISTING WORK — SAFE (staged, 44 files):**

- **Backend platform/update/provision (12 source):** controllers/platform.controller.js, controllers/update.controller.js, middleware/platformAuth.js, routes/platform.routes.js, routes/update.routes.js, services/platform.service.js, services/platformAdmin.service.js, services/presence.service.js, services/update.service.js, services/companyProvision.service.js, scripts/provision-company.js, utils/asyncHandler.js
- **backend/scripts/update/ (3):** apply-update.js, generate-manifest.js, update-bootstrapper.cmd
- **backend/tests/ (17 suites):** cairoTechIsolation, companyProvision, companyUsers, customersAsync, frontendPlatformGating, frontendProvisionGating, frontendTenantScoping, frontendUsersGating, goLiveSmoke, inventoryAsync, platformMaster, purchasesAsync, repositoryAsync, salesAsync, tenantStoreAsync, treasuryAsync, update
- **scripts/ (7):** async-convert.js, async-convert-v3.js, async-convert-controllers.js, async-migrate.js, build-release.js, fix-services.js, install-windows.ps1
- **firebase.json:** hosting config (public root, rewrites, cache headers; ignores backend/docs/scripts/releases). No secrets.
- **Docs (4):** FIRST_COMPANY_ACCEPTANCE.md, GO_LIVE.md, KOYEB_DEPLOYMENT.md, RELEASE_CANDIDATE_REPORT.md

**B. GENERATED / TEMPORARY — NOT STAGED (4):**
- `.freebuff/` (26 files: logs, run scripts, preview artifacts, db) — local tooling
- `.freebuffpreview-*.log.err` — preview log
- `diffnames.txt`, `diffstat.txt` — UTF-16 diff dumps (temporary diagnostics)

**BLOCKED — NOT STAGED (1):**
- `backend/data/users.json` — runtime credential store containing a bcrypt password hash. Project convention (`.gitignore` comment) is that runtime JSON stores (`apiKeys.json`, `auditLog.json`) are "regenerated on every run — never version them". `users.json` is the same class and contains credential material → **left unstaged**.

**PHASE 35 (new, not pre-existing) — NOT STAGED (1):**
- `docs/PHASE35_DISCOVERY_AND_PLAN_20260817.md` — this phase's discovery report; belongs to a later Phase 35 commit, not the pre-existing-work commit.

## 4. Secret Scan

- Modified-file diff scan: no secrets (only benign identifiers: `apiKey.id`, `ipKeyGenerator`, `GLOBAL_STORES`, "secret-free audit" comment).
- Untracked backend source scan: no secrets (single match was an advice log line recommending a strong `JWT_SECRET` in production — not a value).
- Untracked tests: all use `TEST_JWT_SECRET` from `tests/helpers/testServer` (test-only constant).
- Full staged diff scan (`service-role`, `sk_live`, `AKIA…`, `BEGIN PRIVATE`, real Supabase URL, long JWT secret values): **no matches**.
- **`backend/data/users.json` blocked** because it contains a bcrypt hash (credential data), consistent with "runtime stores never versioned" convention.
- **Secrets detected: NO** (in staged content).

## 5. Files Staged

82 files: 38 modified + 44 untracked (full list in §2 and §3-A). Staged stat: **82 files changed, 11,828 insertions(+), 303 deletions(-)**.

## 6. Files Intentionally Unstaged

| File | Reason |
|---|---|
| `.freebuff/` | Local tooling/logs/db — never commit |
| `.freebuffpreview-*.log.err` | Temporary preview log |
| `diffnames.txt`, `diffstat.txt` | UTF-16 diagnostic dumps |
| `backend/data/users.json` | Runtime credential store (bcrypt hash) — **BLOCKED** |
| `docs/PHASE35_DISCOVERY_AND_PLAN_20260817.md` | Phase 35 deliverable, not pre-existing work |

## 7. index.html Hunk Split

- Staged index.html diff: **1,414 insertions / 48 deletions** — pre-existing hunks only.
- Verified **0** staged additions containing Phase 34 markers (`settingsGroupsGrid`, `omniScopeSwitch`, `mobileNavDrawer`, `PHASE 34` comments, `data-nav-scope`), and **35** staged additions with pre-existing markers (`provisionCompanyModal`, `DIGITRONICS_SUPABASE` legacy-key removal, `getDbStorageKey`, `ghGist`).
- The **2 documented mixed call-site lines** (`refreshPlatformRole().then(() => { try { window.OmniNavigationBuilder?.build(); applyNavScope(); applyPermissions(); } catch (e) {} })`) are staged — they carry the Phase 34 splice inside pre-existing Phase 33 `refreshPlatformRole` callbacks. Per the Phase 34.5 split decision these lines belong to the pre-existing commit (the Phase 34 commit `8d4ce3d` was intentionally committed without them, so committing them now is correct and required for the pre-existing frontend to invoke the navigation rebuild on role refresh).

## 8. Phase 34 Integrity

- `git show --stat 8d4ce3d` — unchanged: exactly the 11 Phase 34 files (2165+/59−).
- `git diff 8d4ce3d HEAD --stat` — empty (HEAD is still `8d4ce3d`, nothing amended).
- No Phase 34 file names appear in the staged set (`frontendNavigation`, `frontendUserRegPrompt`, `navigationBuilder`, `moduleRegistry`, `PHASE34` docs → **NONE staged**).
- **Phase 34 integrity: PASS**

## 9. Test Verification

- Full Jest re-run this phase: **86 suites / 1175 tests PASS** (working tree unchanged, staging is index-only).
- Known non-Jest failures remain the documented 4 (modulePlatform, pluginSdk, uat, uatFeedback) — untouched, out of scope for 35.1.

## 10. Commit Readiness

**READY FOR REVIEW** — the index now contains exactly the pre-existing work set. Notes for the reviewer:

1. The commit will carry **pre-existing trailing whitespace** in new files (`scripts/async-*.js`, `scripts/fix-services.js`, `FIRST_COMPANY_ACCEPTANCE.md:74`) — `git diff --cached --check` reports it; it is cosmetic, pre-existing, and was not introduced by this phase (read-only rule).
2. `backend/data/users.json` remains untracked and **should be added to `.gitignore`** (next to `apiKeys.json`/`auditLog.json`) in a later phase to keep it permanently out of version control.
3. Proposed commit message (not created): `refactor(frontend): consolidate async and tenant frontend changes` — or a broader message covering platform/update/provision/async/tenant work, at the reviewer's discretion.

## 11. Blocked/Unknown Files

- **Blocked (1):** `backend/data/users.json` — credential-bearing runtime store.
- **Unknown (0):** every remaining file was confidently classified.
