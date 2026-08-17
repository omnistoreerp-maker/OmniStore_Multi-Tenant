# Phase 35.3 UAT Service-Worker Version Report

**Date:** 2026-08-17
**HEAD before this phase:** `c35831c` (dashboard builder fix)
**Mode:** Fix the two stale UAT service-worker version assertions.

---

## 1. Root Cause

The `uat` and `uatFeedback` suites both asserted that `sw.js` contains a service-worker version matching a regex enumerating versions **v22–v33**:

- `services/uat/UAT.test.js:98` — `omnistore-erp-v(22-uat-readiness|23-demo-polish|…|33-customer-provisioning)`
- `services/uatFeedback/uatFeedback.test.js:85` — `omnistore-erp-v(24-uat-feedback|…|33-customer-provisioning)`

The actual `sw.js` version is:

```
omnistore-erp-v45-cairotech-isolation-v1
```

(`DIGITRONICS_PWA_VERSION`, line 1 of `sw.js`.)

**History:** the version regexes were authored when v22–v33 were the current/expected versions. Even at the GoLive-1 baseline commit `089663f`, `sw.js` was already at **v44** (`omnistore-erp-v44-dashboard-v6-sw-reload-v2`) — so the assertions were already stale at baseline and have been failing continuously since. This was documented as a pre-existing failure in Phases 34 and 35.

## 2. Previous Regex vs Actual SW Version

| Suite | Previous accepted versions | Actual `sw.js` |
|---|---|---|
| uat | v22–v33 | `v45-cairotech-isolation-v1` |
| uatFeedback | v24–v33 | `v45-cairotech-isolation-v1` |

## 3. Historical Versioning Behavior

- `sw.js` `DIGITRONICS_PWA_VERSION` is the single canonical SW version constant (`APP_SHELL_CACHE` derives from it; the SW deletes caches whose `key !== APP_SHELL_CACHE`).
- The version scheme is `omnistore-erp-v<N>-<descriptor>` — the number increments across releases, descriptor names the release (e.g. `dashboard-v6-sw-reload-v2`, `cairotech-isolation-v1`).
- Git history: only two commits touch `sw.js` — `089663f` (v44) and `a6b28f5` (v44→v45). There is no separate canonical version constant elsewhere; `package.json` versions (`1.0.0`) are independent release versions, not SW cache versions.
- The UAT tests were the only place validating the SW version; no other test asserts it.

## 4. Chosen Fix

Extended the accepted-version alternation in both regexes to include the two actual versions:

- uat: `…|33-customer-provisioning|44-dashboard-v6-sw-reload-v2|45-cairotech-isolation-v1`
- uatFeedback: `…|33-customer-provisioning|44-dashboard-v6-sw-reload-v2|45-cairotech-isolation-v1`

Additionally, `uatFeedback` had a **second masked pre-existing failure** that surfaced once the version assertion passed: it asserted the Phase 18 doc files exist at the project root (`path.join(projectRoot, file)`), but those docs have always lived in `docs/` (verified against baseline commit `089663f`). Fixed to `path.join(projectRoot, 'docs', file)` — the minimal correct path correction; the assertion remains meaningful (still verifies the five Phase 18/customer-feedback docs exist).

## 5. Why the Fix Is Correct

- **Follows the existing convention:** the tests' contract is "sw.js carries a known, valid OmniStore SW version"; the established style is an explicit alternation of known versions. Extending the alternation with the actual v44/v45 values preserves that contract exactly.
- **Remains meaningful:** the regex still rejects malformed/unknown versions (e.g. `v99-x`, `v46-anything-not-listed`) — it is not weakened to a bare `/v\d+/`. A future version bump will require adding the new version, which is the deliberate, auditable convention this repo already used.
- **sw.js itself is correct** and was NOT changed (the SW is at v45 with matching cache invalidation logic; the tests were stale, not the SW).
- **Docs-path fix:** the five Phase 18 docs demonstrably exist under `docs/` (confirmed on disk and in git), so the corrected path asserts the real, verifiable location.

## 6. Files Changed

| File | Change |
|---|---|
| `services/uat/UAT.test.js` | Version regex extended with v44 + v45 (1+/1−) |
| `services/uatFeedback/uatFeedback.test.js` | Version regex extended with v44 + v45; Phase 18 docs path corrected to `docs/` (2+/2−) |

No other files touched — no `sw.js`, no dashboard builder, no navigation, no tenant/auth/RBAC, no package.json, no index.html.

## 7. Test Results

| Suite | Before | After |
|---|---|---|
| `services/uat` | 0 pass / 1 fail | **1 pass / 0 fail** |
| `services/uatFeedback` | 0 pass / 1 fail | **1 pass / 0 fail** |
| Full Jest (backend) | 86 suites / 1175 tests PASS | **86 suites / 1175 tests PASS** (no regression) |
| `services/modulePlatform` (re-check) | — | 10 pass / 0 fail |
| `services/pluginSdk` (re-check) | — | 16 pass / 0 fail |

All four previously red service-level suites are now green.

## 8. Regression Assessment

- **PASS** — no secrets, no debug code, no SW behavior change, no versioning-logic regression, no weakened security assertions.
- The updated assertions still fail if the SW version is malformed or unknown (verified by construction of the alternation).
- `git diff --check`: clean. Working tree changes limited to the two UAT test files.

## 9. Commit Recommendation

**READY TO COMMIT** as a small standalone commit (recommended message: `fix(uat): update service-worker version assertions to v45`).

Exact scope to stage (per strict rules, no `git add .` / `-A`):
- `services/uat/UAT.test.js`
- `services/uatFeedback/uatFeedback.test.js`
- `docs/PHASE35_3_UAT_SW_VERSION_REPORT_20260817.md` (this report)

NOT staged: intentionally excluded untracked files (`.freebuff/`, preview logs, `backend/data/users.json`, `diffnames.txt`, `diffstat.txt`, `PHASE72_DISCOVERY.txt`, earlier Phase 35 reports).
