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
| `GET` | `/api/v1/platform/sync` | List all tenant sync configs (masked — no secrets returned) |
| `PUT` | `/api/v1/platform/sync/:tenantId` | Configure/create a tenant binding: `{ provider:'github-gist', enabled, token, gistId }` — `token` is write-only, encrypted, never echoed |
| `DELETE` | `/api/v1/platform/sync/:tenantId` | Disconnect tenant from sync — clears server binding ONLY, never touches the remote Gist or tenant data |

### Tenant (any authenticated company member)

| Method | Path | Roles | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/sync/status` | any auth | `{ configured, enabled, revision, lastSyncAt, vaultLocked }` — no secrets, no gistId |
| `POST` | `/api/v1/sync/pull` | any auth | `{ pull: { content, revision } }` — server fetches gist, validates `_companyId`, returns content |
| `POST` | `/api/v1/sync/push` | Owner/Admin/Manager | Body `{ content, baseRevision }` → `{ push: { revision } }`; 409 `CONFLICT` if `baseRevision` stale |

Tenant id is NEVER taken from URL/query/body/header — only from `trustedTenantId(req)` (JWT claim / reconstructed context).

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

## 5. Migration runbook (Master, post-deploy — NOT executed in this PR)

Goal: move each tenant off per-device PATs onto the server vault without data loss.

### 5.1 Inventory existing device-bound PATs (read-only)

Legacy devices still hold `digi_gh_token` + `digi_gh_gist_id[_<tenantId>]` in localStorage. These keep working (silent legacy path retained). To migrate:

1. Ask each tenant to note their current Gist ID from the (now status-only) Backup page (`ghGistIdShow`), OR read it from the device under supervision.
2. Obtain the corresponding PAT from the device owner (they created it). **Never ask a user to paste a PAT into chat/ticket** — use the Master console form (TLS) only.

### 5.2 Adopt existing Gist bindings (preferred — no data move)

For each tenant, Master calls `PUT /api/v1/platform/sync/:tenantId` with:
- `provider: "github-gist"`
- `token`: the tenant's existing PAT (least privilege: `gist` scope only — advise rotating to a gist-only token if the current one has broader scopes)
- `gistId`: the tenant's existing gist id (from 5.1)
- `enabled: true`

Server now owns the binding. On the tenant device, the legacy localStorage token becomes redundant.

### 5.3 First verification per tenant

1. Tenant signs in → Sync page shows `المزامنة السحابية مفعّلة 🟢`.
2. Tenant presses **استعادة من السحابة** (`POST /api/v1/sync/pull`) → data loads, no `_companyId` mismatch error.
3. Tenant (Owner/Admin/Manager) presses **رفع للسحابة** (`POST /api/v1/sync/push`) with current revision → 200, new revision recorded.
4. Repeat pull on a second device of the same tenant → same dataset.

### 5.4 Revoke per-device PATs

After 5.3 passes for a tenant:
1. On each legacy device: Sync page → **إلغاء المزامنة من هذا الجهاز** (clears local `digi_gh_token` + gist key). Device now uses server path only.
2. In GitHub: rotate/revoke the old PAT if it was broader than `gist` scope, or if the tenant wants a clean slate (then re-enter the new token via Master `PUT`).

### 5.5 Duplicate-device handling

Multiple devices of the same tenant all pull/push through the SAME server binding. No per-device gist ids any more. A stale device that still holds an old local token will keep using the legacy direct-gist path until step 5.4 — both paths touch the same gist, so revoking the PAT (5.4 step 2) cleanly disables the legacy path.

### 5.6 New tenants (greenfield)

Master provisions the tenant, then `PUT /api/v1/platform/sync/:tenantId` with a fresh gist-only PAT and either:
- empty `gistId` → server creates a private gist on first push, or
- a pre-created empty private gist id.

No device ever sees a PAT.

## 6. What is deliberately NOT in this phase

- Backend GitHub OAuth (routes exist as 501 stubs) — PAT vault chosen for minimal, testable surface; OAuth device flow = follow-up.
- MCC Integrations Hub (`#page-integrations`) GitHub card — Hub remains WhatsApp/Payment/BI via local DB.
- Tightening CSP to drop `api.github.com` — held until 5.4 revocation is complete across tenants.
- Automatic revocation of old device PATs — requires Master action in GitHub (no API for it here).
- Per-entity `/api/v1/*` CRUD sync (sales, products, …) — this phase syncs the whole-DB mirror only, same as legacy.

## 7. Rollback

- Feature is opt-in per tenant (`enabled` flag). `DELETE /api/v1/platform/sync/:tenantId` disconnects a tenant instantly; their devices fall back to local-only (or legacy path if a local token still exists).
- No destructive server action: disconnect never deletes the remote gist or tenant data.
- Frontend modal removal is cosmetic for tenants who never had a token; tenants mid-migration keep the silent legacy path.

## 8. Security notes

- No PAT/token/Authorization header is ever logged, audited, or returned in any response on the new surfaces.
- Audit events: `PLATFORM_SYNC_CONFIG_UPDATED`, `PLATFORM_SYNC_DISCONNECTED`, `SYNC_PULL`, `SYNC_PUSH` — metadata only (tenant id, actor, revision, byte size), never dataset contents or secrets.
- Cross-tenant guard: server rejects a gist whose `_companyId` does not match the requesting tenant (403 `CROSS_TENANT_PAYLOAD`); a gist with no `_companyId` is also refused for bound tenants.
- The old masked-integrations store (`platformIntegrations`, `••••LAST4` only) is untouched and still cannot perform sync — documented limitation, not a regression.
