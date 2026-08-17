# Phase 37 — Production Release Hardening Report

Date: 2026-08-17
HEAD at start: `b99591a` (fix(uat): update service-worker version assertions to v45)
Phase 36 verdict: GO WITH CONDITIONS (0 P0, 3 P1, 3 P2, 3 P3)

## 1. Baseline

- `git status` clean apart from the documented excluded untracked files.
- Commit chain verified: `b99591a` → `c35831c` → `a6b28f5` → `8d4ce3d` (Phase 34 / pre-Phase-34 / dashboard builder / UAT fixes). No Phase 34 or Phase 35 commit was modified.
- Full test matrix before changes:
  - Jest: **86 suites / 1175 tests PASS**
  - modulePlatform 10/10, pluginSdk 16/16, uat 1/1, uatFeedback 1/1

## 2. Changes

| File | Change |
|---|---|
| `.gitignore` | Added `backend/data/users.json` to the runtime-store ignore block (next to `apiKeys.json` / `auditLog.json`) |
| `backend/server.js` | Removed the two dead legacy Supabase CSP hosts (`https://` + `wss://fkcaexpuagvxaljremzm.supabase.co`); wired production config validation into the boot block (fatal refusal on weak JWT secret, loud boot warnings for disabled auth / open CORS) |
| `backend/config/index.js` | Added `validateProductionConfig()` — pure, testable production safety rules |
| `scripts/build-release.js` | **Release-build defect fix:** added `services/` to the artifact INCLUDE list |
| `backend/tests/productionConfig.test.js` | New — 7 tests for the production safety rules |
| `RELEASE_CANDIDATE_REPORT.md` | Appended Phase 37 refresh section (fresh artifact SHA + re-validation results) |
| `docs/PHASE37_PRODUCTION_RELEASE_HARDENING_REPORT_20260817.md` | This report |

## 3. Security Hardening

### 3.1 users.json protection (P1-1)

`backend/data/users.json` is an untracked runtime credential store containing bcrypt password
hashes (regenerated at runtime). It now sits in the same `.gitignore` block as the other runtime
stores (`apiKeys.json`, `auditLog.json`). Verified:

- `git check-ignore backend/data/users.json` → ignored.
- File contents untouched, still present on disk.
- `git status --ignored` shows it ignored; it is not staged.

### 3.2 CSP legacy Supabase cleanup (P2-1)

- Only remaining references to `fkcaexpuagvxaljremzm.supabase.co` were the two CSP entries in
  `backend/server.js` and a tracked legacy archive `DigiTronics_v5.html` that is neither served,
  cached, nor referenced by the app.
- `index.html` (the served app) carries an **empty** Supabase config after the Phase 33
  legacy-key removal, so no Supabase functionality depends on the CSP host.
- Removed only the two CSP entries; all other directives (`'self'`, api.github.com,
  cdn.jsdelivr.net) untouched.

### 3.3 Production environment enforcement (P1-2)

Design constraint discovered during implementation: the documented Koyeb bootstrap legitimately
runs `NODE_ENV=production` with `AUTH_REQUIRED=false` until the first Owner is created, and the
Windows installer (`install-windows.ps1`) ships `CORS_ORIGINS=` empty for same-origin serving.
Enforcement therefore:

- **Fails fast at boot** only on a weak/default `JWT_SECRET` in production (`dev-secret` or
  missing) — no documented flow uses a weak secret in production.
- **Warns loudly at boot** (not silent) when `AUTH_REQUIRED` is not `true` or `CORS_ORIGINS` is
  empty/open in production, while still booting for the documented bootstrap flows.
- Development / preview behavior (non-production) is completely unchanged.

`validateProductionConfig()` is pure and covered by `backend/tests/productionConfig.test.js`
(7/7): weak-secret fatal, missing-secret fatal, strong-secret pass, auth-disabled warning,
open-CORS warning, production-only scope, non-production pass-through.

## 4. Tests

- Full Jest after changes: **87 suites / 1182 tests PASS** (new productionConfig suite:
  +1 suite, +7 tests).
- Service suites: modulePlatform 10/10, pluginSdk 16/16, uat 1/1, uatFeedback 1/1.
- Registration regression (Step 9): `frontendUserRegPrompt.test.js` 4/4 PASS.
- Verified the timer neutralization in `index.html`: `startUserRegistrationTimer()` is a no-op
  (`return;`), while `saveUserRegistration()`, `USER_REG_KEY`, and the `#userRegOverlay` markup
  remain fully functional for explicit entry points. No auto-popup after login.

## 5. Release Build

- Official build command: `npm run build:release` → `scripts/build-release.js`.
- Version convention: semver from `backend/package.json` (currently **1.0.0**); no new version
  invented. SW version stays `omnistore-erp-v45-cairotech-isolation-v1` (unchanged — the UAT
  regex fix in Phase 35.3 aligned tests to the real SW).
- **Defect found and fixed:** the build INCLUDE list omitted `services/` entirely, while
  `sw.js` caches `./services/**` (331 references) and `index.html` loads 29 `services/` files at
  runtime. The shipped PWA shell's `cache.addAll(APP_SHELL_ASSETS)` would have failed on
  install. Added `services/` to the INCLUDE list.
- Fresh artifact: `releases/OmniStore-1.0.0.zip` (20,434,793 bytes),
  SHA-256 `9c8d0defe00666176776efaa6743bdf3315a6f3f1868d3426bc90b8bb6cb1845`.
- Artifact verified to contain: `index.html` (Phase 34 navigation/UX), `sw.js` v45,
  `services/modulePlatform/*` (navigationBuilder, moduleRegistry, dashboardBuilder),
  `services/pluginSdk/*`, `services/uat/*`, `backend/` tree, `scripts/`, `icons/`, PWA
  `manifest.json`. Generated artifact left in `releases/` (untracked, per the repo's release
  process — not committed).

## 6. Update / Rollback Validation (Step 8)

Real end-to-end validation in an isolated temp install (`$TEMP/omni37`), data dir kept outside
the install dir:

1. Installed the fresh 1.0.0 artifact; backend booted (health 200).
2. Built a 1.0.1 update artifact (version bump only, per the documented convention), generated
   the update manifest, served it over HTTP.
3. Ran `apply-update.js`:
   - current 1.0.0 → latest 1.0.1 detected ✅
   - download ✅, SHA-256 verified against manifest ✅
   - extract to staging ✅, backup `install.previous-1.0.0` created ✅
   - atomic swap ✅, app spawned ✅, health check 200 ✅
   - **UPDATE SUCCESSFUL — 1.0.1 running**
4. Built a deliberately broken 1.0.2 (`server.js` removed), updated the manifest, ran the
   updater:
   - download/verify/extract/backup ✅, swap ✅
   - health check FAILED (expected) ✅
   - rollback: broken install preserved as `install.failed-1.0.2`, previous 1.0.1 restored,
     app restarted, health 200 ✅
   - **ROLLBACK OK — previous version restored**
5. Company data dir never touched (updater safety invariant re-verified; data dir remained
   outside the install dir and empty).

SW cache note: the 1.0.1 test artifact was built from the same HEAD content, so `sw.js` stayed
at v45 — SW cache invalidation is driven by the SW version baked into the artifact at build
time, and the mechanism (manifest version → download → swap) was validated; a future build with
a bumped SW version will invalidate caches as designed.

Note: the first two update attempts hit Windows `EBUSY` on the backup rename because a node
process had its CWD inside the install dir (a stale boot-test server, then the updater's own
restart). This is an environment/handling detail — the documented bootstrapper runs the updater
from outside the app dir. With the stale processes killed, the flow completed cleanly.

## 7. Placeholders (Step 10)

- PlayStation (`page-playstation`) and Car Rental (`page-car-rental`) remain **deferred
  modules**, clearly labeled "وحدة قادمة — مكان مؤقت في القائمة فقط" (module coming — temporary
  menu spot only) and permission-gated (`manageSettings`). Harmless; not implemented; no engine
  behind them. Documented in Phase 36 audit as an intentional roadmap decision.

## 8. Final GO / NO-GO

- P0: **0**
- P1: **1 of 3 resolved** — users.json ignored (done), production env enforcement (done).
  Remaining: nothing code-level; the fresh artifact is built and validated (done in this
  phase).
- P2: CSP cleanup done; placeholders documented; release docs aligned via the
  RELEASE_CANDIDATE_REPORT refresh section.
- P3: diagnostic-file triage, root README, trailing whitespace — untouched (out of scope).

**Production readiness: GO WITH CONDITIONS** — the three Phase 36 P1 conditions are now
satisfied (gitignore, env enforcement, fresh validated artifact). Operators must still set
strong `JWT_SECRET`, `AUTH_REQUIRED=true`, and a `CORS_ORIGINS` allowlist (or same-origin
serving) per the documented deploy guides.

## 9. Files Changed (this phase)

- `.gitignore` (1+)
- `backend/config/index.js` (31+)
- `backend/server.js` (16+, 4−)
- `scripts/build-release.js` (1+)
- `backend/tests/productionConfig.test.js` (new, 7 tests)
- `RELEASE_CANDIDATE_REPORT.md` (20+, refresh section)
- `docs/PHASE37_PRODUCTION_RELEASE_HARDENING_REPORT_20260817.md` (this report)

## 10. Git Review

- `git diff --check`: clean.
- No secrets staged; `users.json` ignored and not staged; no generated artifact staged
  (`releases/` remains untracked, per the repo's release process).
- No Phase 34/35 files modified; commit chain intact (`b99591a` HEAD unchanged).
- Staged for review: the 5 source/config files + 2 reports (Phase 37 report + RELEASE
  CANDIDATE refresh).
