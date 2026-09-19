# Phase 35 Discovery & Plan

**Date:** 2026-08-17
**Mode:** Read-only discovery — no code modified, no commit, no push.
**HEAD:** `8d4ce3d` — `feat(navigation): complete Phase 34 navigation and UX hardening`
**Preview:** http://127.0.0.1:3003/ (HTTP 200, healthy, serving the committed Phase 34 frontend)

---

## 1. Current System State

- **Repo:** OmniStore Multi-Tenant (single-file RTL Arabic PWA frontend `index.html` ~42.7k lines / ~2.6 MB + Node Express backend `backend/`).
- **Git:** `main` at `8d4ce3d` (Phase 34 committed). Prior commits: `50833cb` (security/multi-tenant hardening), `dfdfa59` (Render PORT fix).
- **Working tree:** 38 modified files + 48 untracked files, all **pre-existing uncommitted work** (Phase 33 platform/provision/update/async/tenant frontend+backend changes). Verified not Phase 34 content; left untouched.
- **Tests:** Full Jest 86 suites / 1175 tests passed. 4 known pre-existing failures outside Jest (modulePlatform, pluginSdk, uat, uatFeedback — `node:test` suites in `services/`).
- **Backend surface:** 26 route files, 33 services, 24 controllers, permission registry, JWT auth (access+refresh, MFA pending flow), request-scoped tenant store (AsyncLocalStorage), platform admin gate (`requirePlatformAdmin`), rate limiting + body sanitization middleware.
- **Frontend surface:** 233+ `id="page-*"` containers, Phase 34 navigation architecture (24 groups, 3 scopes), Settings Hub (7 groups / 26 links), mobile drawer, module platform (`services/modulePlatform/`), plugin SDK (`services/pluginSdk/`).
- **Releases:** `releases/` holds OmniStore-1.0.0.zip (validated release candidate, SHA-256 checked, update+rollback proven), 1.0.1/1.0.2 artifacts, plus older DigiTronics archives.

## 2. Completed Phases

- **Phase 34.1** — Navigation architecture: 24 groups; MASTER_NAV (80 routes) / INTERNAL_NAV (73 routes); 3 scopes (tenant/master/internal); scope switch; Settings Hub + search; mobile drawer; placeholders (PlayStation, Car Rental); a11y (aria-expanded, Escape, focus-visible). Files: `navigationBuilder.js`, `moduleRegistry.js`, `index.html`, `frontendNavigation.test.js` (12 tests).
- **Phase 34.2** — Visual/nav QA + hardening: 26 Settings Hub anchors → semantic buttons, initial `aria-pressed` on scope pills, scope isolation verified, responsive verified (live mobile + static desktop), a11y verified. Verdict: PASS WITH NOTES.
- **Phase 34.3** — User-registration auto-prompt removal: `startUserRegistrationTimer()` neutralized (no-op), registration capability preserved. Verdict: PASS. New `frontendUserRegPrompt.test.js` (4 tests).
- **Phase 34.4** — Final consolidation/regression audit: 86/1175, security regression PASS, READY TO COMMIT (index.html bundles pre-existing changes — the one caveat).
- **Phase 34.5** — Safe two-commit staging + standalone validation: staged HEAD+Phase 34 proven functionally complete; `canAccessPage` gate reverted to the string pinned by the pre-existing Phase 33 test; `isPlatformMaster` + Settings Hub guards kept. All suites green (86/1175 + gating 10/10).
- **Commit** — `8d4ce3d` created with exactly the 11 Phase 34 files. Pre-existing work remains unstaged.
- **Earlier phases** (historical, prior to the current numbering): a documented multi-phase journey (Phases 5–36, 21–30 series, SUPABASE RLS, security hardening) — business modules, dashboards, multi-tenant architecture preview, UAT engine, release/update machinery. Docs live in `docs/` and `Documentation/`.

## 3. Remaining Work

1. **Commit the pre-existing uncommitted work** (38 modified + 48 untracked files: Phase 33 platform/update/provision controllers-routes-services-middleware, async conversion, tenant scoping, 17 untracked backend test suites, provision scripts, `sw.js` v45, `package.json` scripts). This is the single largest open item.
2. **PlayStation module** — nav placeholder only (`#page-playstation`, "وحدة قادمة"). No engine, no data model, no routes.
3. **Car Rental module** — nav placeholder only (`#page-car-rental`). Same status.
4. **4 known pre-existing test failures** (see §9) — dashboard builder stub, stale SW version regexes.
5. **Docs gaps** — no root README; `Documentation/` covers earlier phases only; no consolidated ops runbook beyond GO_LIVE.md / KOYEB_DEPLOYMENT.md (untracked).
6. **Production polish** — verify the untracked release machinery (update/provision/platform) is committed and covered; release 1.0.0 predates Phase 34 UI; a fresh release artifact including Phase 34 has not been built.

## 4. Security Findings

- **Positive:** JWT access/refresh with MFA-pending flow; tenant claim bound at login only for active companies; AsyncLocalStorage request-scoped tenant store (no cross-request leakage); `requirePlatformAdmin` is server-authoritative and never reads client tenant input; body sanitization (prototype-pollution / operator keys); rate limiting; permission registry with Owner/Admin bypass scoped per tenant.
- **Phase 34 impact:** navigation hiding is UX-only; backend authorization unchanged and authoritative. Master/internal nav hidden for tenant users; `platform-master` gated in `canAccessPage`; scope helpers never read tenant storage; `platformRole` is script-scoped (not console-flippable). No auth/authorization/JWT/membership/tenant-isolation change by Phase 34. Security regression: PASS.
- **Documented pre-existing (NOT Phase 34, NOT fixed):** several platform/dev pages (`self-platform-*`, `saas-*`, `go-live-center`, `qa-center`, etc.) remain reachable via direct `showPage()` for a plain Admin even though nav-hidden; backend `requirePlatformAdmin` remains the authoritative gate for the data APIs. This predates Phase 34.1 (34.1 removed them from tenant nav — an improvement).
- **No new findings** in this discovery pass that constitute an authorization or tenant-isolation bypass.

## 5. Multi-Tenant Findings

- Architecture report (`docs/MULTI_TENANT_ARCHITECTURE_REPORT_20260630.md`) describes a shared-Supabase + per-tenant-row topology; current runtime is the local-file tenant store (`cairo_db_v7`-style keys, `ACTIVE_TENANT_ID`, `getDbStorageKey`) with a backend `companyContext`/`tenantCarry` chain.
- The uncommitted pre-existing work includes significant tenant hardening: async conversion of repositories/services/controllers, `tenantStore` ALS middleware, tenant-scoped ghGist keys, backend-queue tenant tagging, `DB_PRISTINE_DEFAULTS`, multi-company login, `renderCompanyOptions` rename (formerly `renderCompanyList`), and 9 untracked tenant/async test suites (all passing).
- Company membership: `tenantMembership.service.js`, `tenantRole.service.js` — effective role = per-tenant role when present else global role.
- Master/Internal/Company scopes are UX-layer separation; real authorization is server-side. No tenant-isolation regression found.

## 6. UI/UX Findings

- **Navigation:** 24 groups: 14 tenant, 1 internal, 9 master. MASTER_NAV 80 items, INTERNAL_NAV 73 items. Scope switch (`#omniScopeSwitch`), mobile drawer (`#mobileNavDrawer`) with own scope pills, Settings Hub (`#settingsGroupsGrid`, 7 groups, 26 links, live search `filterOmniSettings`).
- **Placeholders:** exactly 2 module placeholders — PlayStation + Car Rental (both "وحدة قادمة" / "coming later" alerts, mapped to `manageSettings` permission). No business logic.
- **Mobile:** drawer verified live (565px viewport); desktop verified statically (1366/1440/1920 CSS only; no viewport-resize tooling).
- **Known notes:** scope pills cramped in the collapsed 76px icon rail (cosmetic, documented Phase 34.2 P3); Settings Hub links are buttons (Phase 34.2 fix); nav active state is legacy button-highlight behavior.

## 7. Backend Findings

- Architecture: routes → controllers → services → repositories; permission registry + `authorization.service.js` pure decision engine; JWT utils (`signAccessToken`, `signRefreshToken`, `verifyRefreshToken`); `platform.routes.js` (admin-gated platform APIs: companies, users, presence, licenses, integrations, audit, admins); `update.routes.js` (in-app update with SHA-256 + backup + atomic swap, rollback proven).
- The **uncommitted pre-existing backend changes** convert the data layer to async (BaseRepository `*Async` methods, AsyncLocalStorage tenant store, `asyncHandler`) — 200+ lines in BaseRepository alone, touching 30+ backend files. These are untracked/modified but untested-by-CI in the committed state (the 17 untracked suites cover them and pass).
- No backend TODOs/FIXMEs found via search (only test-fixture strings and doc placeholders).

## 8. Frontend Findings

- Single-file PWA (`index.html`, RTL Arabic, Cairo font). Service worker `sw.js` at `VERSION = 'omnistore-erp-v45-cairotech-isolation-v1'`.
- Module platform: `moduleRegistry.js` (immutable contracts, scope-aware `nav()`), `moduleLoader.js` (flags, dependency resolution, lifecycle), `moduleAdapters.js`, `navigationBuilder.js` (24 groups, catalogs, scopeVisible, frozen export), `dashboardBuilder.js` (**stub returning `[]`** — see §9).
- Plugin SDK (`services/pluginSdk/`): registry → loader → form → validation; 12 business plugins; contributes Sidebar nav (passes) but Dashboard cards fail (dashboardBuilder stub).
- No frontend TODO/FIXME markers found.

## 9. Testing Findings

- **Full Jest: 86 suites / 1175 tests PASS** (baseline 85/1171 + Phase 34.3 suite 4 tests).
- **Phase 34 focused:** navigation 12/12, user-registration prompt 4/4, Phase 33 gating 10/10, provision gating (untracked, passes), users gating, tenant scoping (untracked, passes).
- **4 known pre-existing failures** (all in `services/`, `node:test`, NOT Jest, NOT caused by Phase 34, confirmed untouched):
  1. `modulePlatform` — `dashboardBuilder.js` stub returns `[]`; test expects `widgets.some(w => w.moduleId === 'sales')`.
  2. `pluginSdk` — same stub: "active plugin contributes Dashboard cards" fails (Sidebar nav passes).
  3. `uat` — stale SW version regex `omnistore-erp-v(22-uat-readiness|…|33-customer-provisioning)` vs actual `v45…`; also `cacheVersion: 'v22'`.
  4. `uatFeedback` — top-level assertion failure in the feedback engine test.
- **Fix candidates (Phase 35, P1/P2):** implement `dashboardBuilder.build()` to return enabled-module widgets (fixes 2 failures); bump the uat/u atFeedback version regexes to v45 (fixes 2 failures). Both are contained, low-risk, and previously out of scope only because they predated Phase 34.

## 10. Production Readiness

- **Strong:** release candidate 1.0.0 validated on Windows (install, provision, end-to-end, restart, two-tenant isolation, in-app update to 1.0.1 with SHA-256 + backup + atomic swap, auto-rollback from broken 1.0.2, zero data loss). GO_LIVE.md + KOYEB_DEPLOYMENT.md guides exist (untracked).
- **Gaps:**
  1. Pre-existing platform/update/provision/async work is **uncommitted** — a fresh clone would not contain it; production readiness of the repo itself is blocked until committed.
  2. Release artifacts predate Phase 34 UI — a new release including Phase 34 has not been built.
  3. 4 failing service-level tests remain red in the repo.
  4. No root README.
  5. The release/update pipeline (`scripts/build-release.js`, `backend/scripts/update/generate-manifest.js`, `provision-company.js`) exists only as untracked files + package.json scripts.

## 11. Recommended Phase 35 Scope

**Priority order:**

1. **P0 — Commit the pre-existing work** (second commit per Phase 34.5 plan): `refactor(frontend): consolidate async and tenant frontend changes` — the 38 modified + 48 untracked pre-existing files. This is the gate for everything else; without it the repo cannot be reproduced from commits.
2. **P1 — Dashboard builder implementation** — replace the `dashboardBuilder.js` stub with a real widget builder driven by enabled modules/plugins. Fixes 2 of 4 red suites (modulePlatform + pluginSdk). Small, contained, directly testable.
3. **P1 — uat/uatFeedback version-staleness fix** — update the SW version regex (and `cacheVersion`) to v45. Fixes the remaining 2 red suites. Pure test maintenance, zero runtime risk.
4. **P2 — PlayStation & Car Rental module decision** — either implement minimal engines (routes + data + page) or keep placeholders and document them as intentional roadmap items with a visible "coming later" state (already true). Recommend documenting + deferring implementation unless business demand exists.
5. **P2 — Fresh release artifact** — build a new release zip including Phase 34 + pre-existing work; re-run release-candidate validation.
6. **P3 — Docs/ops** — add root README; consolidate the untracked ops guides into committed docs.

## 12. Explicitly Out of Scope

- Any change to authentication, authorization, JWT, membership, tenant isolation, or database authorization.
- Sales/POS/accounting/inventory/treasury/purchases/payroll/employees/reports/dashboard business logic.
- The documented pre-existing direct-`showPage()` reachability of platform/dev pages (backend `requirePlatformAdmin` remains authoritative).
- Rebuilding the dashboard, redesigning the UI, broad refactors, dependency upgrades.
- Any Phase 34 file changes (Phase 34 is committed and frozen).

## 13. Execution Order

1. Commit pre-existing work (P0) — leaves working tree clean, then everything downstream is against committed code.
2. Fix `dashboardBuilder.js` stub + update `modulePlatform`/`pluginSdk` tests (P1) — run both `node:test` suites.
3. Fix uat/uatFeedback version regexes (P1) — run both suites.
4. Re-run full Jest (86/1175 → still green) + all 4 service suites (4/4 green expected).
5. Decide placeholder modules (P2) — document + defer unless requested.
6. Build fresh release + validate (P2).
7. Docs (P3): README, ops guide consolidation.

## 14. Acceptance Criteria

- `git status --short` clean (or only intended new files) after step 1.
- All 4 previously red `services/` suites pass (`node --test` in modulePlatform, pluginSdk, uat, uatFeedback).
- Full Jest remains 86 suites / 1175 tests passing.
- No security/authorization/tenant-isolation code touched.
- Phase 34 commit `8d4ce3d` untouched.
- Preview http://127.0.0.1:3003/ still healthy after changes.
- New release artifact (if built) passes install/update/rollback validation.

## 15. Risks

- **Committing the pre-existing work** risks bundling unrelated/incomplete changes; mitigated by Phase 34.4/34.5 forensics (all 38 modified + 48 untracked files were individually classified as pre-existing; 17 untracked test suites all pass).
- **dashboardBuilder rework** could affect dashboard visibility if `updateVisibility()` semantics change; keep the existing `updateVisibility()` behavior intact and only replace `build()`.
- **Version-regex updates** are test-only; low risk. Must not "fix" the tests by weakening assertions — update to the real v45 value.
- **Placeholder module decisions** — implementing engines would be a large scope increase; deferring is the conservative choice.
- **Release build** requires the release machinery to be committed first (step 1) or built from the working tree with care.
- Preview server (port 3003, pid 17500) is session-scoped; a new release build or server restart requires re-verification.
