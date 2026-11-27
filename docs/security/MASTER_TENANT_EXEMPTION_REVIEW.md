# Security review — empty-membership tenant exemption (Master tenant entry)

**Status:** CONFIRMED — authorization gap. Review only; **no product behaviour changed, nothing merged, nothing deployed.**
**Base:** `826f960fe32bc406d7dfe4c9c3e5bef39c734f72` (production == `main`).
**Branch:** `security/master-tenant-exemption-review`.
**Evidence suite:** `backend/tests/security/masterTenantExemption.test.js` — 11/11 PASS.
**Verdict:** `SECURITY_REVIEW_REQUIRED`.

---

## 1. Summary

The tenant boundary is **not** "a Master is special". It is a general exemption for **any account whose membership list is empty**. Such an account (a) is never denied a tenant, (b) receives a signed tenant claim for whichever active company it selects, and (c) acts with its **global user role** inside that tenant, which for the production master is `Owner` — and `Owner` short-circuits every `education.*` permission gate.

So the production master does enter any active company as Owner. But the same is true of any future account created without a membership row, at whatever global role it is given.

## 2. Answers to the four questions (executable evidence)

| # | Question | Answer | Evidence |
| --- | --- | --- | --- |
| 1 | Can a membership-less Master enter any active company? | **YES** | `PART A › Q1/Q2/Q3` → login 200 for `nile` |
| 2 | Is a trusted tenant claim minted for it? | **YES** — `tenantId` from the server-resolved context | same test, `claims.tenantId === 'nile'` |
| 3 | Does it get Owner inside the tenant, or are platform and tenant permissions separate? | **Both, and they are different things.** `platformRole` is a separate field (master → `MASTER_OWNER`, non-admin → 404). Tenant power does **not** come from it: a plain `Viewer` with no membership also enters a tenant. Tenant power comes from the **global `user.role` fallback**, which is `Owner` for the master. | `PART A › platform role is a SEPARATE field` + `PART A › not Owner-specific` |
| 4 | Is there a test proving an unauthorized account cannot reach another company's data? | **YES for real members** — a measured member is refused `403` with no token, and `cairoTechIsolation` / `tenantEnforcement` / `goLiveValidation` cover the same ground. **NO for empty-membership accounts** — that is the gap. | `PART A › control — a measured member is still confined` |

## 3. Root cause chain (file:line)

1. `backend/services/tenantMembership.service.js:65-70`
   ```js
   const membership = idsFor(user);
   if (membership.length === 0) return false;   // legacy / empty membership
   return membership.includes(String(tenantId)) === false;
   ```
   An empty membership list is treated as "not denied" rather than "no access".

2. `backend/controllers/auth.controller.js:75`
   ```js
   if (tenantMembership.isTenantDenied(user, req.tenantContext.tenantId)) { ... 403 ... }
   ```
   The gate is never reached for an empty-membership account, so no `403` is produced.

3. `backend/controllers/auth.controller.js:114-118` — the server-resolved tenant is carried into the token:
   ```js
   const carryTenantId = (config.tenantCarryEnabled && resolution.tenantId) ...
   const tokenIdentity = carryTenantId ? { ...user, tenantId: carryTenantId } : user;
   ```

4. `backend/services/tenantRole.service.js:81-86` — no per-tenant role, so the **global** role wins:
   ```js
   if (tenantRole !== undefined) return tenantRole;
   if (user.role) return user.role;
   ```

5. `backend/middleware/authorize.js:82-87` — Owner/Admin bypass:
   ```js
   const role = effective !== undefined ? effective : req.user.role;
   if (role === 'Owner' || role === 'Admin') return next();
   ```

6. `backend/middleware/authorize.js:72-76` — the tenant itself is taken only from server state (`req.tenantContext` or the signed claim), never from query/header. This part is **sound** and is not implicated.

## 4. Production blast radius (read-only, 2026-10-17)

- 19 user records; **1** has an empty membership: `omnistore` (`role: Owner`, `status: active`).
- `platformAdmins`: `omnistore: MASTER_OWNER` (the only platform administrator).
- All four flags are ON in production: `AUTH_REQUIRED`, `ENABLE_MULTI_COMPANY_LOGIN`, `ENABLE_TENANT_USER_MEMBERSHIP`, `ENABLE_TENANT_CARRY`, `ENABLE_TENANT_ROLES`.

**Current exposure:** exactly one credential — the master's — can enter any of the 3 active tenants with Owner rights. **Latent exposure:** any account provisioned without a membership row inherits the same power at its own global role; this is a provisioning-time trap, not a one-off.

**Severity:** High for confidentiality/integrity of tenant data *if* the master credential is shared or compromised; the master credential is effectively a universal tenant key. It is not remotely exploitable without valid master credentials.

**Not the cause:** `platformRole`/`MASTER_OWNER` does not grant this. Removing the platform role would change nothing; the gate is `user.role` + empty membership.

## 5. Smallest safe fix (recommended, requires sign-off)

**Option A — audit-gated break-glass (recommended; zero impact on the 18 tenant members).**

In `auth.controller.login`, when `tenantMembership.idsFor(user).length === 0`:
- allow the login **only** if `platformAdminService.platformRoleFor(user.username)` returns a platform role;
- otherwise return `403 { code: 'NO_TENANT_MEMBERSHIP' }`;
- on the allowed path, emit an explicit audit event `TENANT_BREAK_GLASS_LOGIN` carrying `{ username, tenantId }`.

Effect: membership-less non-platform accounts lose tenant entry (fixes the latent trap); the master keeps a working, now-audited break-glass path. No membership or role is granted or revoked. Single small hunk in one file plus audit call.

**Option A2 (optional, separate decision):** cap the master's effective tenant role at `Admin` instead of `Owner`, so a break-glass session cannot perform owner-only actions (role assignment, link-user, destructive deletes).

**Option B — strict fail-closed.** Empty membership ⇒ always `403`. Simplest to reason about; master loses tenant entry entirely (platform surface only). One-line change in `isTenantDenied`, but it removes the owner's break-glass path.

**Option C — explicit grants (target state).** Platform admins get an explicit, revocable, audited `allowedTenantIds` grant; the empty-membership exemption is deleted. Largest change; needs a data model and a UI/ops surface.

**Recommendation:** A now (smallest, auditable, non-disruptive), A2 considered with it, C as the eventual design.

**Rollback:** revert the single commit; no schema, no data migration, no config change. Audit events already written are append-only and harmless.

## 6. Regression coverage already written (Part B, `test.failing`)

The suite encodes the desired behaviour so it cannot be forgotten:

- an account with no membership is denied entry to every tenant (`403`, no token);
- a non-Owner without membership is denied too;
- no tenant claim is minted for an unaffiliated account.

These use `test.failing`, so the suite is **green while the gap exists** and turns **red the moment the fix lands** — forcing the reviewer to flip them to plain `test(...)`. That is deliberate: it prevents both a silently-ignored gap and a stale expectation.

## 7. What this review did NOT do

- No change to `isTenantDenied`, `auth.controller`, `authorize.js`, or any route.
- No membership or role granted, revoked, or edited; no `.env` touched.
- No production deploy, no merge, no service restart.
- No production data created or modified.

## 8. Decision requested

Pick one before any code change:

1. **Option A** — audit-gated break-glass for platform admins, deny everyone else with empty membership.
2. **Option B** — strict fail-closed; master loses tenant entry.
3. **Option C** — explicit per-tenant grants for platform admins (design first).

Until a decision is recorded, production keeps the current behaviour and the review remains open.
