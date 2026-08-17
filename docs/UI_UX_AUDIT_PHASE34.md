# Phase 34 — UI/UX & Information Architecture Audit

**Phase:** 34 — UI/UX + Information Architecture redesign (audit stage)
**File:** `docs/UI_UX_AUDIT_PHASE34.md`
**Status:** Step 1 deliverable — audit of the current frontend (no code changed yet)

---

## 1. Purpose

This document is the deliverable of **Step 1** of Phase 34. It inventories the
current frontend (`index.html`) and backend surfaces, and records every finding
the redesign must address. No code was modified to produce it; the audit was
read-only.

---

## 2. Audit method

- Read `index.html` (single-file RTL Arabic app, 42,459 lines / ~2.6 MB).
- Extracted machine-readable inventories with regex over the file:
  - 233 unique `id="page-*"` page containers.
  - 242 `.nav-dropdown-item` entries.
  - 11 `.nav-icon-btn` category buttons.
- Cross-checked nav items against page containers to find dead/orphan links.
- Read backend route files (`backend/routes/*.js`) and permission registry
  (`backend/permissions/registry.js`) to map UI to server enforcement.

---

## 3. Frontend inventory

### 3.1 Shell & design system

| Item | Current state |
|---|---|
| Language / direction | `lang="ar" dir="rtl"` throughout; Cairo font |
| Design tokens | CSS vars in `:root`: `--bg`, `--surface`, `--surface2`, `--border`, `--accent`, `--accent2`, `--green`, `--red`, `--text`, `--text2`, `--muted`, `--glow` |
| Accent themes | `body.accent-blue/green/purple/orange` override `--accent` |
| Dark mode | `body.dark` re-declares the tokens on the `#101828`-family palette |
| App shell | `.sidebar` icon-rail + `.nav-dropdown` panels outside the sidebar; `.main-content` hosts `.page` sections |
| Mobile | `.pwa-bottom-nav` fixed 5-button bar (الرئيسية / بيع / بحث / تنبيهات / PWA) |
| Company identity | `#omniCompanyHeader` (name banner) + company logo/name rendered into `.sidebar-logo` and `.login-logo`; `document.title` includes company name |

### 3.2 Navigation categories (icon rail)

11 category buttons: `main`, `sales`, `inventory`, `reports`, `customers`,
`admin`, `maintenance`, `analytics`, `employees`, plus direct buttons for
`alerts-center` and `cathnumber`.

Current per-category content (item titles abbreviated; full data in §5):

| Category | Count | Focus |
|---|---|---|
| main | 7 | dashboard, smart-business, exec-dashboard, ai-owner, daily, serialsearch, accountstatement |
| sales | 8 | pos, new invoice, invoices, amanat, installments, returns, quotations, rep-mobile |
| inventory | 7 | products, master-data, warehouses, stockcount, stocktransfer, stockmovement, purchases |
| reports | ~90 | business reports AND a huge tail of go-live, preview, config, auth, tenant, deployment, SaaS, security, performance pages |
| customers | 7 | customers, suppliers, customer-accounts, supplier-accounts, accountstatement, crm, broadcast |
| admin | ~60 | users, audit, approvals, automation, alerts, health, and the full platform/self-management/recovery/execution suite |
| maintenance | 3 | maintenance, warranty, devices |
| analytics | 16 | analytics, top-products, inventory-analysis, forecast, ai-copilot-* (12) |
| employees | 5 | hr, employees, employee-performance, emp-reports, partners |

### 3.3 Settings surfaces (fragmented)

1. `page-settings` — real settings page with `omniSettingsTabs` (business, subscription, printing, barcode, localization, advanced) + a stats grid of shortcuts (dark mode, sync, backup, provisioning wizard, users manager).
2. `page-configuration-center` + 11 separate `page-config-*` **preview** pages (business-profile, pos, inventory, accounting, print, theme, security, backup, export, import) — all "Preview / المحاكاة فقط".
3. Users & permissions: `page-users` page + `openUsersManager()` modal (`usersManagerTbody`, `umFullName`, `umUsername`, `umPassword`, `umPassword2`, `umRole` with Manager/Cashier options) + Settings shortcut card `usersManagementCard`.
4. Provisioning: `openProvisionWizard()` / `provisionCompanyCard` (company creation) + `page-customer-provisioning` (Create Customer) + `page-customer-provisioning-preview`.
5. No settings search anywhere.

### 3.4 Master (platform) surfaces — not separated from tenant nav

`page-platform-master` (مركز تحكم OmniStore) is correctly gated:
`canAccessPage('platform-master')` requires `platformRole && USE_BACKEND`, and
its nav item `#platformMasterNav` is `display:none` until `platformRole`
resolves. **However** the tenant-side `admin` dropdown also lists dozens of
platform-scope pages: `self-platform-*` (~20), `recovery-platform-*` (~8),
`production-execution-*` (~6), `saas-admin-*` (in `reports` dropdown),
`command-center`, `opshub`, `go-live-*` (~9). These are mixed into the normal
tenant navigation with no MASTER/شركة visual separation.

---

## 4. Page-to-permission mapping (backend authoritative)

### 4.1 Backend enforcement

- Tenant routes: `requireAuth` + `requirePermission('module.verb')`, permission
  names from `backend/permissions/registry.js` `REAL_GROUPS`:
  `sales`, `purchases`, `inventory`, `products`, `customers`, `suppliers`,
  `treasury`, `reports`, `dashboard`, `users`, `audit`, `company`, `settings`
  (each `*.view/create/edit/delete` etc.). `PLANNED_GROUPS` are registered but
  **not** wired to middleware.
- Platform routes (`backend/routes/platform.routes.js`): `requireAuth` +
  `requirePlatformAdmin()` — server-side Master-Admin-only, including
  `presence/heartbeat` which is authenticated-only for all clients.
- Roles: Owner/Admin short-circuit to full set; per-role baselines in
  `ROLE_DEFAULTS`; legacy aliases `Sales→Cashier`, `Support→Viewer`.

### 4.2 Frontend enforcement

- `can(action)` (index.html:15122): Owner/Admin bypass; else uses
  `currentUser.effectivePermissions` mapped via `REGISTRY_PERM_BY_ACTION`
  (e.g. `viewDashboard→dashboard.view`, `createInvoices→sales.create`,
  `viewReports→reports.view`, `manageSettings→settings.view`,
  `viewCompany→company.view`); falls back to `LEGACY_ROLE_PERMS` per role.
- `canAccessPage(page)` (index.html:15145): a large hand-maintained map of
  page→action rules plus special cases (platform-master, exec-dashboard,
  smart-business, ai-owner, automation, approvals, plugins, documents, recovery,
  performance-engine, qa-center, supabase-diagnostic, training-center,
  command-center, live-sync, pwa, backup, employees/hr, emp-reports).
- `showPage()` (index.html:18492) additionally hard-guards a subset of pages
  (employees/hr, employee-performance, approvals, alerts-center, crm,
  integrations, rep-mobile, opshub) and aliases `capital-partners`,
  `customer-accounts`, `supplier-accounts` → `financial-center`.
- Result: three places to keep in sync (page rules map + showPage guards +
  aliases). The nav items themselves are **not** filtered per user — items are
  shown to everyone and rejected on click.

---

## 5. Findings

### F1 — Information overload / category collapse (critical)

- `reports` dropdown mixes ~90 items: real business reports (reports, financial,
  financial-center, fixed-assets, capital-partners, treasury, vouchers,
  expenses) with go-live (9 items), ERP preview centers (erp-preview-center,
  posting-readiness-center, production-readiness, customer-acceptance,
  system-health-uat, deployment-checklist, customer-feedback, uat-issues,
  demo-notes, client-requests, client-demo-package, training-checklist,
  demo-scenarios, client-signoff, known-limitations, master-release-snapshot,
  customer-copy-checklist, new-customer-setup-guide, release-health),
  configuration previews (configuration-center + 11 `config-*`),
  auth previews (authentication-center + 7 `auth-*`),
  tenant previews (tenant-center + 7 `tenant-*`),
  deployment (deployment-center + 5), real installer (database-installer + 4),
  customer provisioning (6), SaaS admin (saas-admin-center + saas-all-customers +
  saas-customer-details + saas-customer-status + saas-billing-preview +
  saas-notifications + subscription-dashboard + subscription-plans),
  security dashboards (security-dashboard, audit-dashboard,
  production-security-checklist, security-scan, vulnerability-report,
  release-readiness), and performance-scale (10 items).
- `admin` dropdown similarly carries ~60 items spanning tenant admin AND the
  entire platform/self-management suite.
- User impact: impossible to scan; the real day-to-day business pages are
  buried; the app looks like a developer/demo console, not an ERP.

### F2 — No Master/Company separation in the sidebar

- Platform items (`self-platform-*`, `recovery-platform-*`,
  `production-execution-*`, `saas-admin-*`, `go-live-*`, `command-center`,
  `opshub`) appear inline with tenant items. Only `platform-master` is visually
  gated. Requirement: MASTER scope must be visually and structurally separate
  from الشركة scope.

### F3 — Duplicate / near-duplicate navigation entries

- `accountstatement` appears in both `main` and `customers`.
- `reports` appears twice in `reports` (تقرير المبيعات + تقارير الأجهزة via
  inline `onclick`).
- Audit/log surfaces: `activitylog`, `audit`, `audit-dashboard`,
  `self-platform-audit-logs`, `workspace-audit`, `auth-security-audit`,
  `recovery-platform-recovery-audit` — overlapping meanings with no IA story.
- Health surfaces: `health`, `system-health-uat`, `supabase-health`,
  `supabase-diagnostic`, `workspace-health`, `multi-tenant-health`,
  `deployment-health`, `self-platform-system-health`,
  `recovery-platform-recovery-health`.
- Backup/recovery: `backup`, `backup-center`, `self-platform-backups`,
  `recovery-platform-backups`, `config-backup`.
- Users: `page-users`, `auth-preview-users`, users manager modal, `um*` form
  fields, plus `self-platform-*` user administration.
- Companies/customers: `saas-all-customers`, `current-customers`,
  `customer-details`, `saas-customer-details`, `customer-status`,
  `saas-customer-status`, `workspace-health`, `customer-health`, `tenant-center`.

### F4 — Dead and orphan pages

- Nav items pointing at non-existent `page-*` divs: `capital-partners`,
  `customer-accounts`, `supplier-accounts` — but these are **intentional
  aliases** to `financial-center` handled in `showPage()` (not broken, but
  hidden navigation complexity).
- Page divs with **no** nav item (orphaned, reached only via buttons/links):
  `accounting-audit`, `accounting-configuration`, `business-marketplace`,
  `business-plugin-settings`, `cathnumber`, `customer-statement`, `transfers`.

### F5 — Developer/demo pages in production navigation

- `go-live-*` (9), `auth-preview-*` (8), `tenant-preview-*` (8),
  `config-*` (11), `deployment-*` (5), `erp-preview-center`,
  `posting-readiness-center`, `qa-center`, `performance-scale-*` (10),
  `performance-engine`, `supabase-diagnostic`, `revenue-preview`,
  `saas-billing-preview`, `customer-provisioning-preview`, `release-*`,
  `production-*`, `recovery-*` — dozens of "Preview/Mock/المحاكاة فقط" pages
  presented as first-class navigation to every tenant user.

### F6 — Settings Hub is fragmented

- Six different settings entry points (page-settings tabs, 11 `config-*` pages,
  users page + modal, provisioning wizard, sync/backup shortcuts) with no
  single hub, no search, no permission-aware grouping, and duplicate company/
  users cards (settings grid + `page-config-business-profile` +
  `page-auth-preview-users`).

### F7 — Inconsistent labels & duplication of meaning

- Mix of Arabic and English labels (Configuration Center, Go Live Center,
  Health Monitor, Business Profile, Self-Managed Platform, Platform Customers,
  etc.) under Arabic category headers.
- `business-marketplace` / `business-plugin-settings` exist but are gated behind
  `can('manageSettings')` and routed through `OmniModuleLoader` — a forward-
  looking "plugins/marketplace" concept the nav must keep available as a
  placeholder.
- `self-platform-*` uses a different naming scheme (`self-platform-` prefix)
  than `saas-admin-*` / `platform-master` for the same platform-management
  domain.

### F8 — Permission gating is three-fold and untested

- Page visibility is decided by `canAccessPage()` + `showPage()` guards + a
  mapping table, but **the nav markup is not filtered**; unauthorized items are
  visible and produce toast errors on click. The planned Phase 34 `frontendNavigation.test.js`
  must pin: (a) master items hidden for non-Master, (b) tenant-only items
  hidden for platform-only accounts, (c) no nav item reveals a page the user
  cannot access, (d) `showPage` cannot route across tenants.

### F9 — Responsive & accessibility baseline (current)

- Mobile relies on the 5-button PWA bar + sidebar collapse; no hamburger menu
  for the ~200 nav items on phones (items are effectively unreachable on mobile).
- Icon-only buttons rely on `title` attributes; little/no `aria-label`,
  `aria-expanded`, focus management for dropdowns, or keyboard navigation.
- Many font sizes are very small (0.68–0.82rem); contrast not verified.

### F10 — No settings search, no global page search

- `#d6GlobalSearch` exists on the dashboard but is a stub (`alert`). The
  settings hub has no search despite the Phase 34 requirement "ابحث في الإعدادات...".

---

## 6. What the redesign must keep intact (hard constraints)

- **Security wiring unchanged:** `getJwtTenantId()`, `getEffectiveTenantId()`,
  `getDbStorageKey()`, `setActiveTenantId()`, `jwtTenantId()`, `ACTIVE_TENANT_ID`;
  JWT `tenantId` stays authoritative; a frontend variable must never redirect a
  logged-in user across tenants.
- **Backend authoritative:** permission names must stay `REAL_GROUPS`-valid;
  `requirePermission` and `requirePlatformAdmin` routes untouched. Do not
  introduce `tenantId="*"`.
- **Platform scopes unchanged:** `platformAuth.js`, `requirePlatformAdmin`,
  `platformRole`, `PLATFORM_ADMINS`, `MASTER_OWNER`, `PLATFORM_ADMIN`.
  Master = PLATFORM scope, Company = TENANT scope; never merged.
- **No secrets in browser-readable stores:** never persist GitHub tokens,
  Supabase credentials, API keys, webhooks, passwords, or JWT secrets in
  `index.html`, localStorage, sessionStorage, or query params; masked status
  only.
- **Business logic untouched:** do not change sales/POS/inventory/treasury/etc.
  engines. PlayStation, Car Rental, OmniMarket, and full Installments engines
  are NOT part of Phase 34 — placeholders only.
- **Test baseline:** 84 suites / 1159 tests passing; must not regress. Add
  `backend/tests/frontendNavigation.test.js` (Step 15).
- **Git:** branch `main` head `50833cb`; working tree has intentional
  uncommitted changes. Never `reset --hard`, `clean -fd`, `checkout .`,
  `restore .`. No commits/push/zip/deploy.
- **Preview server:** use `http://127.0.0.1:3003/`; do not start another server.

---

## 7. Recommendation summary (feeding Steps 2–19)

1. **Rebuild the sidebar into 6 clear groups** (الرئيسية / إدارة الأعمال /
   الأنظمة / التواصل / الإدارة / MASTER), with MASTER visually distinct and
   platform-role-only.
2. **One Settings Hub** with permission-aware cards (الشركة والفروع،
   المستخدمون والصلاحيات، الأمان والجلسات، التكاملات والربط، الحسابات والخزينة،
   المبيعات والتقسيط، المنتجات والمخزون، الإشعارات، المظهر والهوية، النظام) +
   settings search "ابحث في الإعدادات...".
3. **Collapse developer/preview pages** out of tenant nav into a Developer/
   Diagnostics area reachable only by owners/admins (or a single hidden link),
   or remove from nav entirely while keeping their `page-*` divs.
4. **Deduplicate** overlapping surfaces (audit/log, health, backup/recovery,
   customers, users) into canonical pages; keep aliases as internal redirects.
5. **Wire nav rendering to `canAccessPage()`** so unauthorized items are hidden
   (not just blocked on click), keeping `showPage()` guard behavior intact.
6. **Add real nav/settings search** and improve responsive (hamburger for
   mobile) and accessibility (aria, focus, keyboard).
7. **Add the navigation test** and run the full suite to confirm no regression.

---

## 8. Appendix — route inventory (backend)

`backend/routes/`: apiKey, audit, auth, company, customers, dashboard,
employees, errorTracker, health, index, inventory, inventoryTransactions,
metrics, mfa, oauth, partners, platform, purchase, reports, sales, suppliers,
treasury, update, users, voucher, webhook.

Platform routes are Master-admin-gated server-side (`requirePlatformAdmin`);
all tenant routes are `requireAuth` (+ `requirePermission` where relevant).
