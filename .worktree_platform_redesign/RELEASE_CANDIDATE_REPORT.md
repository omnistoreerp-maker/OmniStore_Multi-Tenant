# RELEASE CANDIDATE REPORT — OmniStore-1.0.0

**Date:** 2026-08-16
**Verdict:** ✅ **RELEASE CANDIDATE VALIDATED — installed, used, updated, and rolled back on Windows**

This report proves that `OmniStore-1.0.0.zip` can be installed on Windows, provisioned with a
real company, used end-to-end (products/customers/sales/purchases/treasury), survive restarts,
isolate two tenants, update in-app to v1.0.1 with SHA-256 verification + backup + atomic swap,
and **automatically roll back** from a broken v1.0.2 — all without losing a single byte of
company data.

---

## 1. Release Artifact

| Field | Value |
|---|---|
| Release filename | `E:\Projects\OmniStore_Multi-Tenant\releases\OmniStore-1.0.0.zip` |
| SHA-256 (validated) | `48ad43e9857328bfd53b8b7401173877eef2de3c55f1289fe7d0cd7114657124` |
| Size | 19.0 MB (10,047 entries) |
| Update artifact | `releases\OmniStore-1.0.1.zip` (SHA `26e4a3deb5da1faa7fe9ec783d41fceac8b7a736035cdc7b6ad5539c65b110a1`) — v1.0.0 + version bump only |

## 2. Installation

| Field | Value |
|---|---|
| Installer | `scripts/install-windows.ps1` (also shipped inside the zip) |
| Installed version | 1.0.0 (installed) → 1.0.1 (after the update test) |
| Installation path | `C:\OmniStore` (app files: `C:\OmniStore\app`) |
| Data path | `C:\OmniStore\data` — **never touched by installs/updates/rollbacks** |
| Backups | `C:\OmniStore\backups` (+ `C:\OmniStore\app.previous-<v>` version backups) |
| Logs | `C:\OmniStore\logs` |
| Service / startup | Startup shortcut (`...\Startup\OmniStore-Backend.cmd`); NSSM service path documented for servers with NSSM installed |
| Health URL | `http://127.0.0.1:3001/api/v1/health` → `{"success":true,"status":"ok"}` |
| Frontend URL | `http://localhost:3001` (PWA: index.html, manifest.json, sw.js, icons) |

## 3. Provisioning (from the installed environment)

```
cd C:\OmniStore
node app\backend\scripts\provision-company.js --company-name "RC Alpha Trading" ^
  --company-code rcalpha --admin-username admin --admin-password '<strong-password>' --admin-role Owner
```
Result: company `rcalpha` + admin (Owner, company-scoped membership) written to
`C:\OmniStore\data\companies.json` / `users.json`. Idempotent; password never printed, bcrypt-hashed.

## 4. End-to-End Flow (real HTTP against the installed app)

| Step | Result |
|---|---|
| Login with company selection (`POST /auth/login` + `company`) | ✅ 200, token + `effectiveRole=Owner` |
| Create product (GLOBAL) | ✅ 201, **no tenantId stamped** |
| Create customer (tenant) | ✅ 201, tenant-stamped |
| Create sale (tenant) | ✅ 201 (`INV-…`), tenant-stamped |
| Create purchase (tenant) | ✅ 201 (`INV-…`), tenant-stamped |
| Create treasury entry (tenant) | ✅ 201, tenant-stamped |
| List all five resources | ✅ all 200, correct counts |
| **Restart backend** → data survives | ✅ PASS |
| **Reinstall app (data dir preserved)** → data survives | ✅ PASS |

## 5. Tenant Isolation (two companies)

Provisioned `rcbeta` with `admin2`. Results:
- B sees **0** of A's customers/sales/purchases/treasury; products shared (GLOBAL) ✅
- A cannot see B's customer ✅
- Login/membership/company-scoped roles enforced per company ✅

## 6. Update Rail (v1.0.0 → v1.0.1)

Sequence observed in `C:\OmniStore\backups\update-run.log`:
```
downloading http://127.0.0.1:3100/OmniStore-1.0.1.zip
SHA-256 verified: 26e4a3de…
command ok: C:\OmniStore\stop-backend.cmd
extracting to staging  (bsdtar, ~5s)
backing up current installation -> C:\OmniStore\app.previous-1.0.0
swapping new version into place
spawning backend … (cwd=C:\OmniStore)
health check: http://127.0.0.1:3001/api/v1/health
UPDATE SUCCESSFUL — new version 1.0.1 is running.
```
Verified: ✅ detection (`updateAvailable=true`, correct current/latest), ✅ Arabic banner present in
served frontend (`تحديث جديد`/`الإصدار الحالي`/`تحديث الآن`/`لاحقًا`), ✅ `POST /update/apply`
(Owner-gated) launched the separate updater, ✅ SHA-256 verified before apply, ✅ backup created,
✅ app stopped before swap, ✅ atomic rename swap, ✅ v1.0.1 starts, ✅ health OK, ✅ **company
data + login intact**, ✅ **data dir never touched**, ✅ updater survives main-process exit.

## 7. Rollback (intentionally broken v1.0.2)

Built a v1.0.2 whose `server.js` calls `process.exit(1)` at startup. Log:
```
health check: http://127.0.0.1:3001/api/v1/health
HEALTH CHECK FAILED — rolling back.            (exactly 60s later)
restoring previous installation
ROLLBACK OK — previous version restored.
```
Verified: ✅ v1.0.1 running again, ✅ **company data + login intact**, ✅ failed version preserved at
`C:\OmniStore\app.failed-1.0.2`, ✅ no data directory deleted/replaced. (Operational note: after a
rollback, roll the update manifest back too so a broken build is not re-advertised.)

## 8. Security Scan

| Check | Result |
|---|---|
| `.env` inside release ZIP | ✅ none (only `.env.example`, placeholder values) |
| Real `JWT_SECRET` in release configs | ✅ none (`change-me-to-a-long-random-string` placeholder only) |
| Admin password in installed logs | ✅ not found |
| Credentials in update manifest | ✅ manifest carries only version/sha256/url/notes |
| JWT tokens / private keys in frontend | ✅ none |
| **Note** | `index.html` contains a pre-existing Supabase **publishable (anon)** key — public by design, but confirm the associated project has RLS enabled before any Supabase use. |

## 9. Release ZIP Contents

✅ backend (+ node_modules, 9,834 entries), ✅ frontend (index.html, manifest.json, sw.js, icons),
✅ updater (backend/scripts/update/*), ✅ installer (scripts/install-windows.ps1),
✅ config (package.json, .env.example), ✅ production scripts (provision/backup/restore/checkEnv/start-production),
✅ **NO** `data/`, `tests/`, `.env`, `.log`, or dev tooling (async-convert*, benchmark/loadTest/stressTest/verify excluded).

## 10. Bugs Found & Fixed During Validation

1. **Installer:** UTF-8 em-dashes broke PowerShell 5.1 parsing (→ ASCII).
2. **Installer:** `.NET Framework` lacks `RandomNumberGenerator.Fill` (→ `RNGCryptoServiceProvider`).
3. **Installer:** drive-relative `InstallDir` from shells that strip backslashes (→ `[IO.Path]::GetFullPath`).
4. **Installer (no-NSSM mode):** no way to stop the app before an update swap (→ generated
   `stop-backend.cmd` + `UPDATE_STOP_COMMAND`).
5. **Updater launch:** `update.service.js` double-quoted the bootstrapper path in `spawn`,
   so `start /min` never launched it (→ pass path unquoted).
6. **Updater:** `Expand-Archive` took minutes/hung on node_modules (→ bsdtar, ~5 s).
7. **Updater:** CWD inside the app dir → `EBUSY` on the backup rename (→ bootstrapper `cd`s outside).
8. **Updater:** `PORT=0` in the environment produced `127.0.0.1:0` health URL (→ parseInt semantics).
9. **Updater:** a pre-swap failure left the app stopped (→ guaranteed restart of the original app).
10. **Startup noise:** express-rate-limit v8 `ERR_ERL_KEY_GEN_IPV6` validation stack at boot
    (→ `ipKeyGenerator` helper); swagger-jsdoc YAML error in a JSDoc comment (→ reworded).
11. **Builder:** `Compress-Archive` hang (→ bsdtar) and dev `.env` leak (→ excluded).

Environment note: this machine's Defender-like behavior intermittently deletes `.ps1` files; the
installer source is backed up at `.freebuff/install-windows.ps1.txt` and ships inside the zip.

## 11. Full Test Suite (source tree)

```
npx jest --runInBand
Test Suites: 76 passed, 76 total
Tests:       1049 passed, 1049 total
```

## 12. Files

- Modified: the async-foundation + update-rail + hardening set from the session (see `git status`; no commit made per instructions).
- Created: `releases/OmniStore-1.0.0.zip`, `releases/OmniStore-1.0.1.zip`, validation harnesses in `.freebuff/` (rc-flow.js, rc-static-server.js), `GO_LIVE.md`, `FIRST_COMPANY_ACCEPTANCE.md`, `RELEASE_CANDIDATE_REPORT.md`.
- Deleted: none (broken test artifact `OmniStore-1.0.2.zip` removed after the rollback test).

## 13. Conclusion

`OmniStore-1.0.0` **can be installed and used by the first real company on Windows** — including
provisioning, daily operations, restart persistence, tenant isolation, in-app updates with
checksum verification and atomic swap, and automatic rollback on failure. **First-company go-live:
READY.**

---

## 14. Phase 37 Refresh (2026-08-17)

A fresh `releases/OmniStore-1.0.0.zip` was rebuilt from HEAD (`b99591a` + Phase 37 hardening) and
re-validated:

- SHA-256: `a05b2f5533a28d8b01b14cf8b3ecd7f4cabcd69e77ef396972f5aba58021e415`
- Includes Phase 34 navigation/UX, Phase 35 tenant/platform/async consolidation, the dashboard
  builder fix, and the UAT version fixes.
- **Release-build defect fixed:** `scripts/build-release.js` previously omitted the `services/`
  tree even though `sw.js` caches `./services/**` (331 references) and `index.html` loads 29
  `services/` files at runtime — the shipped PWA shell would have failed to install. The INCLUDE
  list now ships `services/`.
- Update/rollback re-validated end-to-end in an isolated install: 1.0.0 → 1.0.1 update applied
  (SHA-256 verified, backup retained, health OK) and a deliberately broken 1.0.2 rolled back to
  1.0.1 (health-fail → restore → restart → ROLLBACK OK).
- Test matrix at refresh: Jest 87 suites / 1182 tests PASS; modulePlatform 10/10, pluginSdk 16/16,
  uat 1/1, uatFeedback 1/1.

### Final artifact (Phase 38.1)

The release was rebuilt after Phase 38.1 with the final SHA above (20,464,553 bytes, version
1.0.0) and verified:

- plugins 24/24, templates 19/19, services complete
- SW shell assets 381/381, index.html local scripts 331/331 (0 missing)
- real isolated update 1.0.0 → 1.0.1 applied with plugins/templates surviving the swap
  (SHA-256 verified, backup retained, health OK)
