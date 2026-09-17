# Phase 35.2 Dashboard Builder Restoration Report

**Date:** 2026-08-17
**Commits:** `a6b28f5` (pre-Phase-34 consolidation) + `8d4ce3d` (Phase 34) — both untouched.
**Mode:** Implementation of the dashboard builder only.

---

## 1. Original Stub Behavior

`services/modulePlatform/dashboardBuilder.js` (unchanged since the GoLive-1 baseline commit `089663f`) exposed:

```js
function updateVisibility() { /* hides stat-cards whose route is disabled */ }
function build() { updateVisibility(); return []; }
root.OmniDashboardBuilder = Object.freeze({ build, updateVisibility });
```

- `build()` **always returned `[]`** — no widgets were ever collected.
- `updateVisibility()` worked (hides legacy `.stat-card[onclick*="showPage"]` whose route is disabled), but nothing was ever rendered.
- The backup file `dashboardBuilder.js.backup-dashboard-v5-20260708-161836` is byte-identical to the stub (verified) — no historical implementation exists.

## 2. Discovered Intended Contract

Derived from the two failing tests (no historical source to recover):

**`services/modulePlatform/tests/modulePlatform.test.js` — "dashboard builder uses widgets from enabled modules":**
- Loads `moduleRegistry.js` + `moduleLoader.js`, boots the loader (`businessType = computer_shop`).
- Stubs `document.getElementById('omniDynamicDashboardWidgets')` → host `{ innerHTML: '' }`.
- Asserts `build()` returns widgets where **`widgets.some(w => w.moduleId === 'sales')`**.
- Asserts the host receives rendered HTML matching **`data-module-widget="products"`**.

**`services/pluginSdk/tests/pluginPlatform.integration.test.js` — "active plugin contributes Dashboard cards":**
- Loads businessEngine + moduleRegistry + moduleLoader + pluginSdk, boots active plugins (`businessType = pharmacy`).
- Same host stub.
- Asserts `Array.from(widgets).some(w => w.moduleId === 'plugin:pharmacy')`.
- Asserts host HTML matches **`plugin:pharmacy`**.

**Contract summary:**
- `build()` returns an **array** of widget objects.
- Each widget carries at least `moduleId`:
  - module widgets → `moduleId = <module.id>` (from `OmniModuleLoader.getActiveModules()` → each definition's `widgets[]`)
  - plugin cards → `moduleId = 'plugin:<plugin.metadata.id>'` (from `OmniPluginSDK.getActivePlugins()` → each plugin's `dashboardCards[]`)
- `build()` renders into `#omniDynamicDashboardWidgets` with `data-module-widget="<moduleId>"` per widget.
- `build()` still calls `updateVisibility()`; public API `{ build, updateVisibility }` is preserved.

## 3. Historical Source Used

**NOT FOUND** — the file has exactly one commit (`089663f`, GoLive-1 baseline) and the backup is identical to the stub. The implementation was derived from the test contracts + the module registry/plugin SDK contracts.

## 4. Implementation Summary

Rewrote `services/modulePlatform/dashboardBuilder.js` (62 insertions / 1 deletion):

- `escapeHtml()` — safety for all interpolated widget fields (moduleId, label, icon, route).
- `moduleWidgets()` — collects `{...widget, moduleId: module.id}` from every **active** module (`OmniModuleLoader.getActiveModules()`) that declares `widgets[]`.
- `pluginWidgets()` — collects `{...card, moduleId: 'plugin:<id>', pluginId: id}` from every **active** plugin (`OmniPluginSDK.getActivePlugins()`) that declares `dashboardCards[]`.
- `render(host, widgets)` — renders each widget as `.stat-card.omni-dashboard-widget` with `data-module-widget`, an optional `onclick="showPage('<route>')"`, icon + label.
- `build()` — combines module + plugin widgets, renders into `#omniDynamicDashboardWidgets` (no-op if the host element is absent), calls `updateVisibility()`, returns the widget array.
- Public API unchanged: `Object.freeze({ build, updateVisibility })`.

Scope notes:
- Only `dashboardBuilder.js` changed. No auth, tenant isolation, RBAC, navigation, index.html, package, SW, uat, or plugin-architecture changes.
- No test files were modified or added — the existing tests were the contract and now pass unchanged.

## 5. Files Changed

| File | Change |
|---|---|
| `services/modulePlatform/dashboardBuilder.js` | Implemented widget collection + rendering (62+/1−) |

## 6. Tests Before / After

| Suite | Before | After |
|---|---|---|
| `services/modulePlatform` (node:test) | 9 pass / **1 fail** | **10 pass / 0 fail** |
| `services/pluginSdk` (node:test) | 15 pass / **1 fail** | **16 pass / 0 fail** |
| Full Jest (backend) | 86 suites / 1175 tests PASS | **86 suites / 1175 tests PASS** (no regression) |

## 7. Remaining Known Failures

**2** (unchanged, pre-existing, NOT caused by this phase — independently re-verified):
1. `services/uat` — 0/1 fail: stale SW version regex (`omnistore-erp-v(22-…|33-…)`) vs actual `v45-cairotech-isolation-v1`.
2. `services/uatFeedback` — 0/1 fail: same stale SW-version assertion family.

These are intentionally NOT fixed in Phase 35.2 (out of scope).

## 8. Security / Regression Assessment

- **No tenant isolation change** — reads only `getActiveModules()` / `getActivePlugins()`; never touches tenant storage, `ACTIVE_TENANT_ID`, or request context.
- **No authorization bypass** — widget visibility is cosmetic; no permission logic altered.
- **No global mutable tenant state.**
- **No secrets / no hardcoded paths / no debug code.**
- All interpolated values escaped via `escapeHtml()` before being written to `innerHTML`.
- `git diff --check`: clean. `git status`: only `dashboardBuilder.js` modified.
- Full Jest remains 86/1175 — no regressions.
- **Security: PASS**

## 9. Commit Recommendation

**READY TO COMMIT** as a small standalone commit (recommended message: `fix(module-platform): restore dashboard builder widget rendering`).

Exact scope to stage (per STRICT rules, no `git add .` / `-A`):
- `services/modulePlatform/dashboardBuilder.js`
- `docs/PHASE35_2_DASHBOARD_BUILDER_REPORT_20260817.md` (if desired; the report itself)

NOT staged: the intentionally excluded untracked files (`backend/data/users.json`, Phase 35 discovery reports, diffnames/diffstat, `.freebuff/`, `PHASE72_DISCOVERY.txt`).
