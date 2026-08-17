# Phase 34 — UI/UX & Information Architecture Implementation Plan (Phase 34.1: Navigation Architecture)

**Phase:** 34 — UI/UX + Information Architecture redesign
**File:** `docs/UI_UX_PHASE34_IMPLEMENTATION_PLAN.md`
**Status:** Part 32 deliverable — the implementation plan for Phase 34.1 (navigation architecture).
**Predecessor:** `docs/UI_UX_AUDIT_PHASE34.md` (Step 1 audit — findings F1–F10 referenced below).
**Scope:** navigation architecture ONLY. No business-logic changes. PlayStation / Car Rental /
OmniMarket / full Installments engines are **placeholders only** in this phase.

---

## 0. Executive summary

Phase 34.1 delivers a clean **Master (platform) vs Company (tenant) navigation separation**, a
collapsed, role-filtered sidebar, a single **Settings Hub** with search, and an
**internal/dev area** that keeps all existing `page-*` divs reachable without cluttering the
business navigation. The navigation is driven by the existing module platform
(`services/modulePlatform/*`) with static HTML as a pre-boot fallback, so the architecture
change is centralized in three places:

1. `services/modulePlatform/moduleRegistry.js` — group scopes + nav item placement.
2. `services/modulePlatform/navigationBuilder.js` — group metadata (title/icon/scope) + scope-aware rendering.
3. `index.html` — sidebar markup, scope switch, settings hub, `applyNavScope()`, responsive/a11y CSS.

Backend authorization is untouched and remains authoritative.

---

## 1. MASTER sidebar (platform scope)

- **Visibility rule:** only rendered when `isPlatformMaster()` = `!!platformRole && USE_BACKEND`
  (mirrors the existing `canAccessPage('platform-master')` gate at `index.html:15147`). Never
  dependent on `tenantId`; never reachable for a tenant-only user even if `currentUser.role` is
  Owner/Admin (the `manageUsers` fallback in `canAccessPage` for `self-platform-*`/`saas-*`
  pages must NOT leak them into tenant nav — scope gating is enforced structurally in the nav).
- **Marker/class:** every master icon button and dropdown carries `data-nav-scope="master"`.
  `applyNavScope()` (new, called from `applyPermissions()` and `refreshPlatformRole()`) toggles
  these groups. `#platformMasterNav` and `id="page-platform-master"` stay untouched.

| # | Group id | Title | Contents (existing `page-*` routes) |
|---|---|---|---|
| 1 | `master-home` | لوحة تحكم المنصة | `platform-master`, `platform-dashboard`, `monitoring-center` |
| 2 | `master-companies` | الشركات | `self-platform-customers`, `saas-all-customers`, `current-customers`, `customer-details`, `customer-status`, `workspace-health`, `customer-health`, `customer-provisioning`, `customer-provision-report`, `provision-history`, `provision-rollback`, `workspace-audit` |
| 3 | `master-users` | المستخدمون والجلسات | `auth-preview-users`, `self-platform-reports` (users/presence surfaces inside `platform-master`) |
| 4 | `master-licenses` | التراخيص والاشتراكات | `license-center`, `license-audit`, `subscription-plans`, `subscription-dashboard`, `customer-statistics`, `revenue-preview`, `self-platform-subscriptions`, `self-platform-licenses` |
| 5 | `master-integrations` | التكاملات | `supabase-diagnostic`, `supabase-health`, `supabase-setup-preview`, `schema-installer-preview`, `rls-preview`, `edge-function-setup-plan` |
| 6 | `master-database` | قاعدة البيانات | `database-installer`, `migration-progress`, `installation-report`, `verification-report` |
| 7 | `master-backups` | النسخ الاحتياطي والاستعادة | `backup-center`, `self-platform-backups`, `recovery-platform-center`, `recovery-platform-backups`, `recovery-platform-restore-wizard`, `recovery-platform-snapshot-browser`, `recovery-platform-update-center`, `recovery-platform-installed-versions`, `recovery-platform-rollback-history`, `recovery-platform-recovery-health`, `recovery-platform-recovery-audit` |
| 8 | `master-audit` | الأمان والتدقيق | `audit-dashboard`, `security-dashboard`, `security-scan`, `vulnerability-report`, `production-security-checklist`, `self-platform-audit-logs`, `workspace-audit`, `license-audit` |
| 9 | `master-platform` | منصة OmniStore | `self-platform-dashboard`, `self-platform-deployments`, `self-platform-updates`, `self-platform-monitoring`, `self-platform-system-health`, `self-platform-notifications`, `self-platform-jobs-queue`, `self-platform-workers`, `self-platform-storage-usage`, `self-platform-database-usage`, `self-platform-api-usage`, `self-platform-edge-functions`, `self-platform-automation`, `self-platform-reports`, `update-center`, `error-dashboard`, `saas-admin-center`, `saas-customer-details`, `saas-customer-status`, `saas-billing-preview`, `saas-notifications`, `workspace-usage`, `production-execution-*` (6) |

`#platformMasterNav` (currently a `.nav-dropdown-item` inside `dropdown-admin`, `index.html:2087`)
remains present so `refreshPlatformRole()` (`index.html:14077`) can still set its `style.display`
without breaking `frontendPlatformGating.test.js`. It becomes the entry that switches scope to MASTER.

---

## 2. COMPANY sidebar (tenant scope)

Visible for every authenticated tenant user. Items rendered through `canAccessPage()` only.
Only enabled modules show (module state from `OmniModuleLoader.isRouteEnabled`).

| # | Group id | Title | Contents |
|---|---|---|---|
| 1 | `main` | الرئيسية | `dashboard`, `smart-business`, `exec-dashboard`, `ai-owner`, `daily`, `serialsearch`, `accountstatement` |
| 2 | `sales` | الفواتير والمبيعات | `pos`, `invoices`, `amanat`, `installments`, `returns`, `quotations`, `rep-mobile` (New-invoice stays a direct action, not a route) |
| 3 | `purchases` | المشتريات | `purchases` (new group — pulls `purchases` out of `inventory`, F1) |
| 4 | `inventory` | المخزون | `products`, `master-data`, `warehouses`, `stockcount`, `stocktransfer`, `stockmovement` |
| 5 | `customers` | العملاء والموردون | `customers`, `suppliers`, `customer-accounts`, `supplier-accounts`, `accountstatement`, `crm`, `broadcast`, `customer-statement` |
| 6 | `treasury` | الخزنة | `treasury`, `vouchers`, `expenses`, `transfers` (new group — F1 split from `reports`) |
| 7 | `reports` | التقارير والمالية | `reports`, `financial`, `financial-center`, `fixed-assets`, `capital-partners`, `accounting-audit`, `accounting-configuration` |
| 8 | `analytics` | التحليلات | `analytics`, `top-products`, `inventory-analysis`, `forecast` |
| 9 | `maintenance` | الصيانة والضمان | `maintenance`, `warranty`, `devices` |
| 10 | `employees` | الموظفون | `hr`, `employees`, `employee-performance`, `emp-reports`, `partners` |
| 11 | `marketplace` | المتجر والإضافات | `business-marketplace`, `business-plugin-settings` (forward-looking placeholders, F7) |
| 12 | `entertainment` | خدمات إضافية | `playstation`, `car-rental` (lightweight "قريباً" placeholder page divs; engines NOT in this phase) |
| 13 | `admin` | الإدارة والنظام | `users`, `activitylog`, `audit`, `approvals`, `automation`, `alerts-center`, `health`, `branches`, `integrations`, `documents`, `recovery`, `backup`, `sync`, `live-sync`, `plugins`, `pwa`, `settings` |

Group ids `main, sales, inventory, reports, customers, admin, maintenance, analytics, employees`
are **preserved verbatim** — both `services/modulePlatform/tests/modulePlatform.test.js` and
`services/pluginSdk/tests/pluginPlatform.integration.test.js` build dropdowns for exactly these
ids and assert `products` in inventory, `pos` in sales, and `business-plugin-settings` in admin.

---

## 3. Permission mapping (backend authoritative)

Unchanged enforcement chain (documented for the nav work, NOT modified):

- **Backend:** `requireAuth` + `requirePermission('module.verb')` on tenant routes;
  `requirePlatformAdmin()` on platform routes (`backend/routes/platform.routes.js`).
- **Frontend decision function:** `canAccessPage(page)` (`index.html:15145`) — keep as the single
  source for whether an item renders (`navigationBuilder.canShow`) and whether `showPage()`
  proceeds.
- **New nav-specific rule (addition only):** `applyNavScope()` hides `[data-nav-scope="master"]`
  nav buttons/dropdowns unless `isPlatformMaster()`, and hides tenant-scope groups for
  platform-only sessions. This is **UX-only** — it never replaces the `canAccessPage`/backend check.
- **No relaxation:** the `manageUsers` default in `canAccessPage` for `self-platform-*`/`saas-*`
  pages means a tenant Owner/Admin *could* `canAccessPage` them today; Phase 34.1 removes them
  from tenant nav via scope, but does **not** weaken the backend. (Hardening those routes to
  `requirePlatformAdmin` is a separate, explicit security change — NOT in this phase.)
- New frontend test `backend/tests/frontendNavigation.test.js` (Step 15) must assert:
  (a) master-scope items hidden for non-Master, (b) tenant items hidden for platform-only,
  (c) no nav item reveals a page `canAccessPage` rejects, (d) `showPage` cannot cross tenants.

---

## 4. Module visibility

- `moduleRegistry.js`: add `scope: 'tenant' | 'master'` per module or per `navigation[]` item
  (default `'tenant'`). Extend `nav()` helper to accept an options object
  `nav(route, name, icon, group, { scope, dev })` without breaking existing positional calls.
- `navigationBuilder.js`:
  - `groups` map gains `{ title, icon, scope }` for every group id in §1/§2.
  - `canShow(item)` becomes `canShow(item)` + `scopeVisible(item)`:
    - `master` items require `root.isPlatformMaster()` (falls back to
      `!!root.platformRole && root.USE_BACKEND` when the helper is absent, so node:test sandboxes
      keep working).
    - `dev` items (`item.dev === true`) are excluded from the tenant nav build (still
      reachable via direct `showPage`).
    - tenant items still go through `canAccessPage`.
  - Existing behavior preserved: module routes + plugin navigation merged per group, deduped by
    route, group button hidden when empty, `alertsBellBtn`/`catchNumberModuleBtn`/pwa nav toggles.
- `moduleAdapters.js` / `moduleLoader.js`: no contract change (module `navigation[]` item shape
  grows optional fields only).
- Business plugins (`plugins/business/*/plugin.js`, via `pluginSdk`) keep contributing
  `navigation` with `group: 'admin'`; unchanged.

---

## 5. Settings architecture

- **One hub:** `page-settings` remains the single real settings surface (already has
  `omniSettingsTabs`: business, subscription, printing, barcode, localization, advanced).
- **Grouped sections** (permission-aware, using `can('manageSettings')` etc.) with section ids:
  - `settings-group-general` — الشركة والهوية، اللغة والمنطقة، المظهر
  - `settings-group-users` — المستخدمون والصلاحيات (opens `openUsersManager()`),
    تغيير كلمة المرور، الأمان والجلسات
  - `settings-group-business` — نوع النشاط والخصائص، الفروع، التقسيط، الإشعارات
  - `settings-group-finance` — الحسابات والخزينة، الضرائب، الطبع والفواتير، الباركود
  - `settings-group-integrations` — التكاملات والربط، مزامنة السحابة، النسخ الاحتياطي
  - `settings-group-modules` — الوحدات والإضافات (Marketplace / Plugin Center)
  - `settings-group-system` — الوحدة والمتجر (module flags), الإصدار والترقية
- **Settings search:** input `id="settingsSearchInput"` placeholder `"ابحث في الإعدادات..."`
  (F10). Live filter of section headings + shortcut cards by label/keywords; hides empty sections.
- All 11 `config-*` preview pages and the `configuration-center` remain reachable **only** via the
  internal/dev area (§6), not from the settings hub, resolving the six-entry fragmentation (F6).

---

## 6. Internal / dev-page separation

- Developer/preview/Go-Live/Release pages are **removed from tenant business nav** (F5) but keep
  their `page-*` divs and their `canAccessPage` rules so direct `showPage('...')` still works.
- They are collected under a single `internal` nav group (`data-nav-scope="internal"`, title
  `🧪 مركز المطورين والاختبار`), hidden by default. Revealed when
  `can('manageUsers')` (Owner/Admin) **and** a dev flag
  (`window.__devToolsEnabled` toggled in platform-master) — hidden for all other roles.
- Included routes: `go-live-*` (9), `erp-preview-center`, `posting-readiness-center`,
  `production-readiness`, `customer-acceptance`, `system-health-uat`, `deployment-checklist`,
  `customer-feedback`, `uat-issues`, `demo-notes`, `client-requests`, `client-demo-package`,
  `training-checklist`, `demo-scenarios`, `client-signoff`, `known-limitations`,
  `master-release-snapshot`, `customer-copy-checklist`, `new-customer-setup-guide`,
  `release-health`, `configuration-center`, `config-*` (11), `authentication-center`,
  `auth-preview-*` (7), `tenant-center`, `current-workspace`, `workspace-preview`,
  `multi-tenant-health`, `deployment-center`, `customer-deployment-wizard`, `deployment-status`,
  `deployment-logs`, `deployment-rollback`, `deployment-health`, `security-*`,
  `release-readiness`, `performance-scale-*` (10), `performance-engine`, `qa-center`,
  `training-center`, `command-center`, `opshub`, `production`, `production-*`.
- Placement rule: a route belongs to exactly one scope — **master** (§1), **tenant** (§2),
  or **internal** (§6). No route appears in two scopes (dedupes F3 duplicates).

---

## 7. Duplicate-page migration strategy (F3, F4)

- **Aliases stay aliases:** `capital-partners`, `customer-accounts`, `supplier-accounts` continue
  to map to `financial-center` inside `showPage()` (`index.html:18498-18499`). In the nav they are
  listed once under their owning group; the alias pages get no separate nav entry.
- **Dedupe:** remove the second `reports` inline entry (devices report) from `reports` dropdown;
  remove the duplicate `accountstatement` from `main` (single entry in `customers`).
- **Orphans get nav entries:** `transfers` → `treasury`; `customer-statement` → `customers`;
  `accounting-audit`/`accounting-configuration` → `reports`; `business-marketplace` /
  `business-plugin-settings` → `marketplace`; `cathnumber` keeps its dedicated `#catchNumberModuleBtn`.
- **Overlapping families collapse into one canonical page each:** audit/health/backup/user
  surfaces are represented once in the tenant nav (canonical page), with the platform-facing
  variants only in MASTER scope.

---

## 8. Responsive behavior (F9)

- **Desktop (≥ 992px):** icon rail stays; dropdowns open on hover/click; sidebar expandable.
- **Tablet (768–991px):** categories open as an overlay panel; tables scroll horizontally with a
  sticky first column; `.main-content` keeps full width.
- **Mobile (< 768px):** existing 5-button `#pwaBottomNav` remains. Add a **hamburger/drawer**
  (`#mobileNavDrawer`) listing the tenant groups as collapsible sections so all business pages are
  reachable on phones (today ~200 items are unreachable, F9). The drawer re-uses the same
  `applyPermissions`/`applyNavScope` visibility, so nothing is shown the user cannot access.
- Scope switch (الشركة ⇄ MASTER) appears in the sidebar header when `isPlatformMaster()` and in
  the mobile drawer, so a platform admin can switch context without a page reload.

---

## 9. Design system direction

- Extend `:root` tokens only (additive): `--master-accent` (gold/purple for MASTER scope),
  `--nav-group-hover`, `--focus-ring`, `--danger-soft`. Accent themes and `body.dark` keep their
  override mechanism (`body.accent-*`, `body.dark`).
- **Scope color coding:** MASTER nav buttons/dropdowns get `border-inline-start` in
  `--master-accent`; tenant items unchanged.
- **Accessibility:** `aria-label` on every `.nav-icon-btn` (from `title`), `aria-expanded` +
  `aria-controls` on dropdown toggles, `aria-current="page"` on the active item, `Escape` closes
  the open dropdown, focus moves into the dropdown when opened and returns to the trigger when
  closed, `role="menu"/menuitem` on dropdown containers/items.
- **Typography/contrast:** min interactive font size 0.75rem; verified contrast for
  `.nav-dropdown-item` and `.nav-icon-btn` against `--surface`/`--sidebar-bg` in both themes.
- **Marker safety:** the existing `nav-dropdown-item`, `data-page`, `.nav-icon-btn` classes and
  `#alertsBellBtn`/`#catchNumberModuleBtn`/`#platformMasterNav` ids are preserved so all frontend
  tests and the PWA bottom nav keep working.

---

## 10. Implementation checklist (Phase 34.1)

1. `docs/UI_UX_PHASE34_IMPLEMENTATION_PLAN.md` — this file.
2. `services/modulePlatform/moduleRegistry.js` — add `scope`/`dev` metadata; reassign nav items to
   §1/§2/§6 groups; add placeholder modules `playstation`, `car-rental` (scope tenant, minimal);
   add master-scope nav items (or a `platform` module).
3. `services/modulePlatform/navigationBuilder.js` — new `groups` map (title/icon/scope), scope +
   dev filtering in `build()`, keep `groups` export and node:test contracts.
4. `index.html` — sidebar markup (scope switch, master/internal buttons), settings hub search +
   grouped sections, `isPlatformMaster()`, `applyNavScope()`, updates to `applyPermissions()` and
   `refreshPlatformRole()` (call `applyNavScope()`), mobile drawer, CSS + a11y.
5. `backend/tests/frontendNavigation.test.js` — new test (Step 15) pinned to real extracted
   functions (master hidden for non-master, tenant hidden for platform-only, no leak, no cross-
   tenant `showPage`).
6. Run full backend suite (baseline 84 suites / 1159 tests must hold or increase) and the
   node:test suites under `services/modulePlatform`, `services/pluginSdk`, `services/uat`,
   `services/uatFeedback`.
7. Live isolated preview at `http://127.0.0.1:3003/` (do NOT start another server): verify
   Master-only items hidden for tenant users, tenant items not visible to Master-only, settings
   search works, category collapse resolves, no dead links.

---

## 11. Non-goals (explicitly out of Phase 34.1)

- No PlayStation / Car Rental / OmniMarket / full Installments engines — placeholders only.
- No Supabase/GitHub automation, no social integrations.
- No backend permission changes (routes, middleware, registry untouched).
- No removal of any `page-*` div or public function; no renaming of tested markers.
- No commits / pushes / zip / deploy. Never `git reset --hard` / `clean -fd` / `checkout .`.

---

## 12. Files to be changed (expected)

| File | Change |
|---|---|
| `docs/UI_UX_PHASE34_IMPLEMENTATION_PLAN.md` | this plan |
| `services/modulePlatform/moduleRegistry.js` | scopes, group reassignment, placeholder modules |
| `services/modulePlatform/navigationBuilder.js` | group metadata + scope/dev filtering |
| `index.html` | sidebar/scope switch, settings hub + search, `applyNavScope`, mobile drawer, CSS/a11y |
| `backend/tests/frontendNavigation.test.js` | new regression test |
| possibly `plugins/business/*/plugin.js` | only if plugin nav needs `scope`/`dev` metadata (default safe) |
