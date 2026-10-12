# Gist Sync Migration Plan — Server-Authoritative, Tenant-Scoped

> Branch: `feature/server-side-gist-sync-and-tenant-login`
> Base: `origin/main` = `5037bfc8e8ce30169404ed46781f4b0a36b88aa2`
> Status: IMPLEMENTED (code) — OPERATIONAL STEPS BELOW REQUIRE MASTER ACTION AFTER MERGE/DEPLOY.

## 1. What changed

| Before (legacy) | After (this branch) |
|---|---|
| Browser asks each company user for a GitHub PAT (`ghp_…`) + optional Gist ID via `#firstRunModal` | No PAT prompt. Sign-in is email/password only. |
| PAT stored in `localStorage` (`digi_gh_token`), sent to `api.github.com` from the browser | PAT is configured ONCE by Platform Master via `/api/v1/platform/sync`, encrypted server-side (AES-256-GCM vault), never leaves the server |
| Full-DB gist `digitronics_db.json` written/read directly by every device | Server proxies pull/push per tenant, tenant isolation enforced via `_companyId` + `trustedTenantId(req)` |
| Last-write-wins conflicts | `baseRevision` (sha256) conflict detection → 409 `SYNC_CONFLICT`, no silent overwrite |
| Any user (any role) could pull/push | Pull: any authenticated member. Push: `Owner`/`Admin`/`Manager` only |

Files: `backend/services/gistSync.service.js`, `backend/controllers/gistSync.controller.js`, `backend/routes/gistSync.routes.js`, mounts in `backend/server.js`, `index.html` + `DigiTronics_v5.html` (modal removed, sync page rewritten).

## 2. New API surfaces

### Master (Platform Master only — `requireAuth` + `requirePlatformAdmin()`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/platform/sync` | List ALL tenant sync configs (masked — no secrets returned) + `state` (`NOT_CONFIGURED\|LOCKED\|ERROR\|CONFLICT\|CONNECTED`) + `migrationState` (see §5.0) |
| `PUT` | `/api/v1/platform/sync/:tenantId` | Configure/create a tenant binding: `{ provider:'github-gist', enabled, token, gistId }` — `token` is write-only, encrypted, never echoed; `_companyId` stamped server-side on adoption |
| `DELETE` | `/api/v1/platform/sync/:tenantId` | Disconnect tenant from sync — clears server binding ONLY, never touches the remote Gist or tenant data |
| `POST` | `/api/v1/platform/sync/:tenantId/test` | Connectivity test from the MCC (🩺) — clears `ERROR` on success, preserves `CONFLICT` |
| `POST` | `/api/v1/platform/sync/:tenantId/pull` | Controlled verification pull — returns `{ revision, bytes, binding }`, **never dataset content**; 403 on foreign-tagged gist |
| `POST` | `/api/v1/platform/sync/:tenantId/push` | Controlled push — same `baseRevision` conflict rules as tenant push, requires body `{ content, baseRevision }`; audit action `PLATFORM_SYNC_PUSH` |
| `GET` | `/api/v1/platform/sync/:tenantId/audit` | Per-tenant sync audit (metadata only) — `SYNC_CONFIG_UPDATED, SYNC_DISCONNECTED, SYNC_TESTED, SYNC_PULL, SYNC_PUSH, PLATFORM_SYNC_PULL, PLATFORM_SYNC_PUSH, LEGACY_REPORT` |

Master UI: MCC page **مزامنة Git/Gist** (`#page-git-gist-sync`) — configure/test/disconnect, controlled pull (summary), push from JSON file (≤5 MB, typed confirm `رفع`, pull-first base revision), audit log. Token field is `type=password`, never prefilled, never stored client-side.

### Tenant (any authenticated company member)

| Method | Path | Roles | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/sync/status` | any auth | `{ configured, enabled, provider, vaultLocked, lastRevision, lastPullAt, lastPushAt, lastErrorCode, migrationState }` — no secrets, no gistId |
| `POST` | `/api/v1/sync/pull` | any auth | `{ pull: { content, revision } }` — server fetches gist, validates binding, returns content |
| `POST` | `/api/v1/sync/push` | Owner/Admin/Manager | Body `{ content, baseRevision }` → `{ push: { revision } }`; 409 `CONFLICT` if `baseRevision` stale, missing, or unproven |
| `POST` | `/api/v1/sync/legacy-report` | any auth | Body `{ holdsLegacyToken: boolean }` (STRICT boolean) — advisory device-presence report for the migration model (§5.0). The tenant comes from the JWT only; any token material in the body is ignored |

Tenant id is NEVER taken from URL/query/body/header — only from `trustedTenantId(req)` (JWT claim / reconstructed context).

Concurrency: pull/push are serialized per tenant in-process (`_withTenantLock`); cross-process interleaving on a shared volume is a documented limitation (single-backend deployment assumed).

## 3. Vault & secrets

- Env: `GIST_SYNC_VAULT_KEY` (≥32 chars, no default, no plaintext fallback).
- Missing/short key → vault **LOCKED**: every configure/status that would touch a secret fails closed with `503 SYNC_VAULT_LOCKED`. No sync operations proceed.
- Encryption: AES-256-GCM, per-secret random 16-byte salt, scrypt-derived key, 12-byte IV, format `v1:salt:iv:tag:ct` (base64 segments).
- Token is write-only in the API: `PUT` accepts it, stores encrypted, never returns it (not even masked) to any caller.
- Rotation: change `GIST_SYNC_VAULT_KEY` → existing encrypted secrets become undecryptable → tenants show `SYNC_VAULT_LOCKED` until Master re-enters tokens. Documented, intentional.

## 4. Provider (GitHub Gist) contract

- Filename: `digitronics_db.json` (same as legacy — full-DB mirror).
- Private gist, auto-created on first push if `gistId` not supplied (bootstrap), description `OmniStore tenant dataset (server-managed)`.
- Server holds the PAT; browser never calls `api.github.com` for sync on the new path.
- Caps: push ≤ 5 MB, pull ≤ 8 MB, upstream timeout 15s.
- Safe error codes only cross the boundary: `VAULT_LOCKED, NOT_CONFIGURED, CREDENTIAL_INVALID, GIST_NOT_FOUND, UPSTREAM_UNAVAILABLE, UPSTREAM_TIMEOUT, TOO_LARGE, INVALID_PAYLOAD, CROSS_TENANT_PAYLOAD, CONFLICT`. Provider response bodies and dataset contents are never logged/audited.
- CSP `connect-src https://api.github.com` left UNCHANGED this phase (legacy devices with local tokens still depend on it). Tightening = follow-up after credential revocation.

### 4.1 Data integrity & concurrency (documented limitations)

- **Atomic persistence** — all state writes go through `fileStore` (tmp-file + atomic rename, corruption recovery; covered by `backend/tests/fileStore.test.js`, `middleware.test.js`).
- **Failed writes never advance state** — any upstream/validation failure records `lastErrorCode` only; `lastRevision`/`lastPullAt`/`lastPushAt` are updated exclusively on success (proven by suite `G. DATA_INTEGRITY` in `gistSync.test.js`).
- **Conflict granularity** — full-document sha256 compared against BOTH the tracked `lastRevision` and the actual remote gist sha. There is NO three-way merge: a stale base gets 409 and must pull first (intentional replacement of legacy last-write-wins).
- **Serialization scope** — conflict-check + write are serialized per tenant by an in-process async lock (`_withTenantLock`, proven: two concurrent pushes → exactly one 200/one 409). Multiple backend **processes** sharing one data dir would still race — single-process deployment assumed; cross-process locking is a documented follow-up.
- **Offline queue** — local pending changes are client-side only; the server path is pull-then-push with strict base proof, no automatic conflict merging.

## 5. Migration runbook (Master, post-deploy)

Goal: move each tenant off per-device PATs onto the server vault without data loss.

### 5.0 Migration state model (six states — implemented & tested)

The server derives `migrationState` per tenant from **server evidence** plus an **advisory device report**:

| State | Derivation (server-side) |
|---|---|
| `LEGACY_NOT_SEEN` | no server binding, no legacy report ever |
| `LEGACY_PRESENT_NOT_MIGRATED` | device reported `holdsLegacyToken: true`, verification not complete |
| `SERVER_SYNC_AVAILABLE` | binding live (`enabled` + credential), no pull+push yet, no lingering PAT reported |
| `MIGRATION_VERIFIED` | `lastPullAt` AND `lastPushAt` both set; legacy report absent (unknown) |
| `LEGACY_REVOCATION_PENDING` | verified + latest device report says the PAT is still held |
| `LEGACY_REVOKED` | verified + latest device report says cleared |

Trust rules:
- **localStorage is NEVER ownership proof.** Tenant resolution is exclusively `trustedTenantId(req)` (JWT). The `/sync/legacy-report` endpoint accepts only a strict-boolean `holdsLegacyToken`; any token material or tenant hints in the body are ignored, and the report grants nothing (advisory UI/migration state only).
- Verification (`MIGRATION_VERIFIED`) requires SERVER-observed pull+push — a device cannot claim it.
- Devices send the report automatically from the Sync page (`serverSyncLegacyReport` — presence boolean only).

### 5.1 Eleven-step migration sequence

1. **Deploy** — merge PR #50, set `GIST_SYNC_VAULT_KEY` (≥32 chars) in the backend env, restart, verify vault is not locked (`GET /platform/sync` returns rows, no `SYNC_VAULT_LOCKED`).
2. **Inventory** — each tenant notes their current Gist ID from the (now status-only) Backup page (`ghGistIdShow`), read under supervision; obtain the corresponding PAT from the device owner. **Never ask a user to paste a PAT into chat/ticket** — Master console form (TLS) only.
3. **Adopt** — `PUT /api/v1/platform/sync/:tenantId` with `{ provider:"github-gist", token, gistId, enabled:true }`. Server owns the binding; `_companyId` stamped server-side; no data move (gist id unchanged).
4. **Connectivity** — MCC **مزامنة Git/Gist** → 🩺 test → expect `CONNECTED`, binding `own`, secret masked.
5. **Verify pull** — tenant device → **استعادة من السحابة** → 200, no binding error; repeat on a second device of the same tenant → same dataset.
6. **Verify push** — tenant Owner/Admin/Manager → **رفع للسحابة** → 200 with new revision; audit shows `SYNC_PUSH` (metadata only).
7. **Confirm verification** — `GET /platform/sync` shows `MIGRATION_VERIFIED` for the tenant (server pull+push observed).
8. **Legacy report** — while a device still holds `digi_gh_token`, its Sync page reports `holdsLegacyToken:true` → state `LEGACY_REVOCATION_PENDING`. *(Runbook action on live devices — NOT executed in this PR.)*
9. **Per-device clear** — on each legacy device: **إلغاء المزامنة من هذا الجهاز** (clears `digi_gh_token` + gist key). Device next reports `false` → state `LEGACY_REVOKED`. *(NOT executed in this PR.)*
10. **GitHub-side revocation** — revoke/rotate the old PAT in GitHub if it was broader than `gist` scope (manual GitHub UI). *(NOT executed in this PR.)*
11. **Close-out** — re-run the MCC test (expect `CONNECTED`), confirm `LEGACY_REVOKED`/`MIGRATION_VERIFIED` across devices, freeze the migration report before any CSP tightening. *(NOT executed in this PR.)*

### 5.2 Duplicate-device handling

Multiple devices of the same tenant all pull/push through the SAME server binding. No per-device gist ids any more. A stale device that still holds an old local token keeps using the legacy direct-gist path until step 9 — both paths touch the same gist, so revoking the PAT (step 10) cleanly disables the legacy path.

### 5.3 New tenants (greenfield)

Master provisions the tenant, then `PUT /api/v1/platform/sync/:tenantId` with a fresh gist-only PAT and either:
- empty `gistId` → server creates a private gist on first push, or
- a pre-created empty private gist id.

State starts at `SERVER_SYNC_AVAILABLE` → `MIGRATION_VERIFIED` after first pull+push. No device ever sees a PAT.

> Status 2026-10-12: steps 1–7 are implemented and covered by mocked tests (`backend/tests/gistSync.test.js`, real-provider suite env-gated SKIPPED without `GIST_SYNC_TEST_TOKEN`); steps 8–11 are documented runbook actions against live tenants — **not executed in this PR**.

## 6. What is deliberately NOT in this phase

- Backend GitHub OAuth (routes exist as 501 stubs) — PAT vault chosen for minimal, testable surface; OAuth device flow = follow-up.
- ~~MCC Integrations Hub GitHub card~~ — superseded: the Master sync UI now exists as its own MCC page **مزامنة Git/Gist** (`#page-git-gist-sync`, `master_integrations` scope). The generic `#page-integrations` Hub remains WhatsApp/Payment/BI via local DB.
- Tightening CSP to drop `api.github.com` — held until step 9/10 revocation is complete across tenants (see GATE 6 inventory).
- Automatic revocation of old device PATs — requires Master action in GitHub (no API for it here).
- Cross-process pull/push interleaving — per-tenant lock is in-process only; multiple backend workers on a shared volume would need a shared lock (documented limitation).
- Per-entity `/api/v1/*` CRUD sync (sales, products, …) — this phase syncs the whole-DB mirror only, same as legacy.

## 7. Rollback

- Feature is opt-in per tenant (`enabled` flag). `DELETE /api/v1/platform/sync/:tenantId` disconnects a tenant instantly; their devices fall back to local-only (or legacy path if a local token still exists).
- No destructive server action: disconnect never deletes the remote gist or tenant data.
- Frontend modal removal is cosmetic for tenants who never had a token; tenants mid-migration keep the silent legacy path.

## 8. Security notes

- No PAT/token/Authorization header is ever logged, audited, or returned in any response on the new surfaces (including the legacy report — boolean only).
- Audit events: `SYNC_CONFIG_UPDATED`, `SYNC_DISCONNECTED`, `SYNC_TESTED`, `SYNC_PULL`, `SYNC_PUSH`, `PLATFORM_SYNC_PULL`, `PLATFORM_SYNC_PUSH`, `LEGACY_REPORT` — metadata only (tenant id, actor, revision, byte size, boolean), never dataset contents or secrets.
- Cross-tenant guard: server rejects a gist tagged with a DIFFERENT tenant's `_companyId` (403 `CROSS_TENANT_PAYLOAD`) on pull and push. A gist with **no** `_companyId` (or legacy `'legacy'` tag) is permitted for bootstrap/adoption compatibility — the client-side `applyGhContent` binding check remains the backstop, and every server push re-stamps the authoritative `_companyId` (server-re-serialized payload, size-capped, `'legacy'` tags replaced).
- The old masked-integrations store (`platformIntegrations`, `••••LAST4` only) is untouched and still cannot perform sync — documented limitation, not a regression.

## 9. GATE 6 — legacy occurrence & CSP inventory (classified)

Classification key: `ACTIVE_SERVER_PATH` (new, credential stays server-side) · `LEGACY_BROWSER_PATH` (browser→GitHub, kept only for devices that still hold a local PAT) · `TEST_ONLY` · `DOCUMENTATION_ONLY` · `DEAD_CODE`.

| Token / pattern | Location(s) | Class |
|---|---|---|
| `digi_gh_token` (`GH_TOKEN_KEY`) | index.html, DigiTronics_v5.html (read by `ghToken()` for the legacy silent path + migration report presence check) | LEGACY_BROWSER_PATH |
| `digi_gh_token` | backend/tests (`browserDataReset`, leak-probe), platform/tests (assertions) | TEST_ONLY |
| `digi_gh_token` | docs/GIST_SYNC_MIGRATION_PLAN.md | DOCUMENTATION_ONLY |
| `digi_gh_gist_id` (+ `_<tenantId>` variant) | index.html, DigiTronics_v5.html (legacy gist lookup; tenant-scoped key takes precedence) | LEGACY_BROWSER_PATH |
| `digi_gh_gist_id` | platform/tests (retention assertion) | TEST_ONLY |
| `#firstRunModal` | index.html L851 / DigiTronics_v5.html L846 — print-CSS selector only; **modal markup is gone** (enforced by `tenant-git-prompt-removal.test.cjs` FORBIDDEN list) | DEAD_CODE (inert selector) |
| `#firstRunModal` | platform/tests FORBIDDEN list, tests/e2e/verify-lang.js (injects a hide-stub) | TEST_ONLY |
| `frConnect`, `frSkip`, `checkFirstRun`, `ghSaveSetup` | definitions only in both HTML files — **zero live call sites**; bodies are no-op/navigation stubs (no `api.github.com`, no token write — enforced by tests) | DEAD_CODE |
| `frSkip()` | tests/e2e/verify.js, tests/e2e/backend-sync.spec.js (guarded `typeof` call of the stub) | TEST_ONLY |
| `ghPull` / `ghPush` / `ghHeaders` / `ghToken()` | index.html + DigiTronics_v5.html (engines + sync-page fallbacks; server-first routing in `syncPagePull/Push`) | LEGACY_BROWSER_PATH |
| `ghPull`/`ghPush` presence assertions | platform/tests | TEST_ONLY |
| `https://api.github.com` fetches (list/create/get/patch gists) | index.html (4 call sites), DigiTronics_v5.html (4 call sites) — legacy device path only | LEGACY_BROWSER_PATH |
| `GH_API = 'https://api.github.com'` | backend/services/gistSync.service.js — server proxy, PAT from vault, header never logged/returned | ACTIVE_SERVER_PATH |
| `connect-src https://api.github.com` | backend/server.js CSP | ACTIVE_SERVER_PATH (intentionally NOT tightened — legacy devices still depend on it; tighten only after migration steps 9–10) |
| `Authorization: 'token ' + …` | index.html / DigiTronics_v5.html `ghHeaders` (local PAT) | LEGACY_BROWSER_PATH |
| `Authorization: 'token ' + token` | backend/services/gistSync.service.js (server→GitHub) | ACTIVE_SERVER_PATH |
| `Authorization: 'Bearer ' + …` (non-GitHub) | app JWT paths: backend tests, platform.js, index.html app API calls, Supabase/WhatsApp/TikTok services | ACTIVE_SERVER_PATH / TEST_ONLY |
| `api.github.com` in docs/tests | real-provider suite title, migration plan, platform assertions | DOCUMENTATION_ONLY / TEST_ONLY |

**DEAD_CODE summary:** the first-run prompt (`#firstRunModal`, `frConnect`, `frSkip`, `checkFirstRun`) and `ghSaveSetup` are retired stubs kept only so stray references cannot throw; nothing in the runtime path calls them. They are candidates for deletion once legacy-path retirement is scheduled — removal is NOT part of this PR (keeps the delta reviewable).

**CSP status:** UNCHANGED this PR. `api.github.com` stays in `connect-src` until migration steps 9–10 clear local PATs on every legacy device; tightening prematurely would break the LEGACY_BROWSER_PATH mid-migration.

## 10. Release delta (GATE 9)

```
PRODUCTION_SHA=2651d6d11d2867d40b8b10cfba6615bf96344486   (Merge PR #46 — current production)
MAIN_SHA=5037bfc8e8ce30169404ed46781f4b0a36b88aa2          (Merge PR #49 — origin/main, our base)
MAIN_CONTAINS_PR48=YES (61d2aca)  MAIN_CONTAINS_PR49=YES (5037bfc)
COMMITS_TO_RELEASE=4 (prod→main: PR #48 compact-login + PR #49 homepage redesign) + 3 (PR #50 branch commits) = 7 post-merge
PR50_STATE=OPEN, MERGEABLE (feature/server-side-gist-sync-and-tenant-login)
FILES_AFFECTED (PR #50 working set): backend/{server.js, routes/gistSync.routes.js, controllers/gistSync.controller.js,
  services/gistSync.service.js, tests/gistSync.test.js, tests/gistSync.realprovider.test.js, .env.example},
  index.html, DigiTronics_v5.html, services/modulePlatform/navigationBuilder.js,
  platform/tests/{master-gist-sync-ui.test.cjs, tenant-git-prompt-removal.test.cjs, section-lockdown.test.cjs},
  tests/e2e/backend-sync.spec.js, docs/GIST_SYNC_MIGRATION_PLAN.md
RUNTIME_DATA_RISK=LOW — no schema migration; local-first stores untouched; sync is opt-in per tenant
  (default configured:false); legacy localStorage keys retained; server state files
  (gistSyncState.json, legacyMigrationState.json) are created lazily on first configure/report;
  disconnect never deletes remote gists or tenant data.
ENVIRONMENT_VARIABLES_REQUIRED:
  - GIST_SYNC_VAULT_KEY (≥32 chars) — MANDATORY to configure sync; absent/short → fail-closed
    503 SYNC_VAULT_LOCKED (documented in backend/.env.example). Never invent or reuse a key.
  - Test-only (never production): GIST_SYNC_TEST_TOKEN, GIST_SYNC_TEST_GIST_ID — arm the
    real-provider suite; absent → suite reports REAL_PROVIDER_TEST=SKIPPED.
  - Existing vars unchanged (JWT_SECRET, AUTH_REQUIRED, CORS_ORIGINS, DIGITRONICS_DATA_DIR …).
BACKUP_REQUIREMENTS: back up backend/data before deploy/rollback (config + audit JSON stores);
  remote gists are never touched by deploy; keep the step-2 PAT/gist inventory sheet offline.
MIGRATION_PREREQUISITES: GIST_SYNC_VAULT_KEY set + vault unlocked; per-tenant PAT (gist scope)
  + existing gist id in hand (runbook steps 2–7); Master platform admin account for the MCC page.
ROLLBACK_PLAN: (1) per-tenant instant rollback = DELETE /platform/sync/:tenantId (devices fall back
  to local-only / legacy path); (2) full rollback = revert the PR #50 merge commit + redeploy
  (frontend revert is cosmetic for tenants who never had a token; mid-migration devices keep the
  silent legacy path); (3) removing GIST_SYNC_VAULT_KEY locks the vault fail-closed rather than
  leaking; no destructive server action exists in either direction.
```
