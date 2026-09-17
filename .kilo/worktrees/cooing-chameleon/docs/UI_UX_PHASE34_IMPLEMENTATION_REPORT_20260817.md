# UI/UX Phase 34.1 — Master/Company Navigation Architecture Report

Date: 2026-08-17
Based on: `docs/UI_UX_AUDIT_PHASE34.md` (audit) and `docs/UI_UX_PHASE34_IMPLEMENTATION_PLAN.md` (plan).

## 1. Objective

Redesign the navigation layer of OmniStore / DigiTronics ERP so Master (platform) and Company (tenant) functionality are visually and logically separated, without changing business logic and without regressing the backend test baseline (84 suites / 1159 tests).

## 2. Scope decisions

- Frontend navigation hiding is **UX-only**. The backend authorization layer is unchanged and remains the authoritative gate (`canAccessPage`, `backendApi.platform.*`, CSP, permission registry).
- PlayStation and Car Rental are delivered as **nav placeholders only** (page div `قريباً`, `manageSettings` placeholder permission). No business logic.
- Internal/dev tools (QA center, training center, command center, etc.) are hidden by default; only shown when dev tools are enabled (`window.__devToolsEnabled`).
- No production data was modified; nothing was committed/pushed.

## 3. Files changed

| File | Change |
| --- | --- |
| `services/modulePlatform/navigationBuilder.js` | Rewritten. 24 group metadata (`groups` map with `{ title, icon, scope }`); `MASTER_NAV` (~80) and `INTERNAL_NAV` (~75) route catalogs; `scopeVisible()`; `renderItem()` emits `id="platformMasterNav"` for the platform-master route and `data-nav-scope` on all items; `build()` merges module + plugin + catalog routes, dedupes by route, hides empty groups; frozen root export `{ build, groups, MASTER_NAV, INTERNAL_NAV, isPlatformMaster }`. |
| `services/modulePlatform/moduleRegistry.js` | `nav()` accepts optional 5th `scope` arg; `module()` defaults to `scope: 'tenant'`. Purchases group, treasury group incl. `transfers`, customers `customer-statement`, `platform_tools` split into master/internal scopes, `business_marketplace` → marketplace group, new placeholder modules `playstation` and `car_rental` (entertainment). |
| `index.html` | Sidebar: `data-nav-scope` on all company buttons; new company buttons (purchases, treasury, installments, marketplace, entertainment); 9 master buttons; 1 internal button; mobile hamburger trigger; `#omniScopeSwitch` Master/Company pills; `aria-label` on nav buttons. Dropdowns: `data-nav-scope` on existing; new tenant dropdowns; 9 empty `dropdown-master_*` + internal dropdowns filled by the builder; mobile drawer (`#mobileNavDrawer` + backdrop + `#mobileDrawerScope` + `#mobileNavDrawerSections`). Settings hub injected at top of `page-settings`: `#settingsSearch` + 7 permission-aware grouped sections. Placeholder pages `#page-playstation`, `#page-car-rental`. CSS for scope switch, master/internal scopes, settings hub, mobile drawer, focus-visible. JS: `isPlatformMaster()`, `applyNavScope()`, `setOmniNavScope()`, `buildMobileNavDrawerSections()`, `toggleMobileNavDrawer(force)`, `filterOmniSettings(query)`; `applyPermissions()` now calls `applyNavScope()`; both `refreshPlatformRole()` call sites re-run `OmniNavigationBuilder?.build()`; a11y (aria-expanded + Escape key closes dropdowns/drawer). |
| `backend/tests/frontendNavigation.test.js` | New. 12 regression tests over the navigation architecture. |

## 4. Architecture

### 4.1 Three scopes
- **tenant** — companies/ERP features (sales, purchases, inventory, reports, customers, admin, analytics, employees, treasury, installments, marketplace, entertainment, maintenance).
- **master** — master/company-management (master_home, companies, users, licenses, integrations, database, backups, audit, platform), shown only when the current role is a platform master (`isPlatformMaster()`); otherwise hidden regardless of tenant permissions.
- **internal** — dev tools (QA center, training center, command center, ops hub, ...), shown only when dev tools are explicitly enabled.

### 4.2 Rendering
- `navigationBuilder.build()` composes the sidebar from: module `nav()` registrations (scope-aware) + plugin navigation (`OmniPluginSDK.translate`) + the catalogs. Items are deduped by route per group; groups with no visible items receive no button.
- `scopeVisible(item)`: tenant scope → always; master scope → `isPlatformMaster()`; internal → `can('manageUsers')`.
- Master/company switching is UX only: `setOmniNavScope()` sets `window.__omniNavScope`, re-runs `applyPermissions()` (which calls `applyNavScope()`), and toggles pills/aria-pressed. Backend authorization never depends on this flag.

### 4.3 Settings hub
`page-settings` gained a searchable index (`#settingsSearch`) with 7 grouped sections (GENERAL, USERS & SECURITY, BUSINESS, FINANCE, INTEGRATIONS, MODULES, SYSTEM). Anchors are filtered live by query and toggled by `canAccessPage`-style permission checks.

### 4.4 Mobile
A right-slide drawer (`#mobileNavDrawer`) replaces the sidebar below 768 px, rebuilt by `buildMobileNavDrawerSections()` from the same builder output, with its own scope pills (`#mobileDrawerScope`).

## 5. Permissions handling

- Backend permission registry untouched; `backendApi.platform.*` and `usersManager*` preserved.
- Placeholder `playstation` / `car-rental` map to `manageSettings` in `canAccessPage`; both remain gated for platform-master too (verified by test).
- Test markers preserved and asserted: `id="platformMasterNav"`, `page-*` divs, `usersManagementCard`, scope helpers that never read tenant DB storage.

## 6. Tests & verification

| Check | Result |
| --- | --- |
| Backend Jest suite (full) | **85 suites / 1171 tests passed** (baseline 84/1159 + new suite 12/12). |
| `backend/tests/frontendNavigation.test.js` (npm test -- frontendNavigation) | 12/12 passed (markers, settings/placeholder presence, scope purity, `isPlatformMaster` extraction, master gating in tenant/master/no-backend contexts, tenant groups still render, internal never leaks into master, `canAccessPage` Owner/Admin/Viewer + platform gates). |
| `services/modulePlatform` node:test | 9 pass / 1 fail — pre-existing dashboard-widgets failure (HEAD `dashboardBuilder.js` is a stub `return []`; `git diff HEAD` empty). Unrelated to this work. |
| `services/pluginSdk` node:test | 5 pass / 1 fail — pre-existing plugin-dashboard-cards failure (same stub root cause). |
| `services/uat` / `services/uatFeedback` node:test | 1 fail each — pre-existing version-string staleness: tests pin `omnistore-erp-v24..v33` while `sw.js` declares `omnistore-erp-v45...`. Unrelated to this work. |
| `index.html` global syntax | 4 inline script blocks parse with 0 errors (`vm.Script`). |
| Live preview `http://127.0.0.1:3003/` | Served page contains `#omniScopeSwitch`, master/internal `data-nav-scope`, `#settingsSearch`, `#page-playstation`, `#page-car-rental`, `id="platformMasterNav"`; served `navigationBuilder.js`/`moduleRegistry.js` contain the new API surface. |

## 7. Remaining / follow-up work

- Manual browser pass for visual polish of master palette + mobile drawer on real devices.
- Remove placeholder gates and build PlayStation / Car Rental modules once requirements land.
- Update `services/uat`/`uatFeedback` version regexes to current version line when next bump happens (pre-existing gap, not part of this phase).
- Finalized report only; nothing committed. Any commit/deploy must be explicitly requested.

## 8. Non-goals (unchanged)

Business logic, backend controllers/services, RLS/security posture, version bump, deployment packaging, and DB state were intentionally not altered.