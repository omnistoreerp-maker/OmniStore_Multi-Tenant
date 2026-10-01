# Platform Control Center — Architecture & RBAC

**Status:** Implemented on `feature/platform-control-center-20261002`.
**Scope:** Platform scope (`/api/v1/platform/*`) — *not* the Business/Tenant dashboard.

---

## 1. Scope separation

Platform roles and tenant roles are two independent systems:

| Concern | Platform scope | Tenant scope |
|---|---|---|
| Store | `backend/data/platformAdmins.json` | user record (`tenantRoles` / `role`) |
| Resolver | `services/platformAdmin.service.js` | `services/tenantRole.service.js` |
| Middleware | `middleware/platformAuth.js` | `middleware/authorize.js` |
| Registry | `permissions/platformRegistry.js` | `permissions/registry.js` |
| Identity source | authenticated username (server-side) | JWT bound tenant + effective role |

A tenant `Owner`/`Admin`/`Manager`/`Cashier` is **never** a platform member, and no
platform role grants any tenant permission (and vice versa). Client-supplied
`platformRole`, `permissions`, `tenantId`, headers, query params and
`localStorage` are never consulted for authorization.

---

## 2. Platform roles

| Role | Intent | Reach |
|---|---|---|
| `MASTER_OWNER` | Full platform control | everything (`*`) |
| `PLATFORM_ADMIN` | Operations / support | businesses, users, licenses, integrations, audit, team read, dashboard |
| `DEVELOPER` | Technical diagnostics | dashboard, diagnostics, audit log, catalog read |
| `DATA_ENTRY` | Operational content entry | platform content catalog read/create/update |

## 3. Permission matrix

| Permission | MASTER_OWNER | PLATFORM_ADMIN | DEVELOPER | DATA_ENTRY |
|---|:--:|:--:|:--:|:--:|
| `platform.dashboard.view` | ✅ | ✅ | ✅ | ✅ |
| `platform.team.view` | ✅ | ✅ | ❌ | ❌ |
| `platform.team.manage` | ✅ | ❌ | ❌ | ❌ |
| `platform.roles.manage` | ✅ | ❌ | ❌ | ❌ |
| `platform.security.manage` | ✅ | ❌ | ❌ | ❌ |
| `platform.config.*` | ✅ | ❌ | ❌ | ❌ |
| `platform.companies.view` / `.manage` | ✅ | ✅ | ❌ | ❌ |
| `platform.users.view` / `.manage` | ✅ | ✅ | ❌ | ❌ |
| `platform.licenses.view` / `.manage` | ✅ | ✅ | ❌ | ❌ |
| `platform.integrations.view` / `.manage` | ✅ | ✅ | ❌ | ❌ |
| `platform.audit.view` | ✅ | ✅ | ✅ | ❌ |
| `platform.diagnostics.view` | ✅ | ❌ | ✅ | ❌ |
| `catalog.read` | ✅ | ✅ | ✅ | ✅ |
| `catalog.create` / `catalog.update` | ✅ | ❌ | ❌ | ✅ |

The authoritative source is `permissions/platformRegistry.js`
(`platformRegistry.matrix()`), exposed at `GET /api/v1/platform/control-center/matrix`
(`platform.roles.manage` only).

---

## 4. Endpoints

### Control Center (`/api/v1/platform/control-center`)

| Method | Path | Required permission |
|---|---|---|
| GET | `/access` | `platform.dashboard.view` |
| GET | `/dashboard` | `platform.dashboard.view` |
| GET | `/matrix` | `platform.roles.manage` |
| GET | `/diagnostics` | `platform.diagnostics.view` |
| GET | `/diagnostics/errors` | `platform.diagnostics.view` |
| GET | `/catalog` | `catalog.read` |
| POST | `/catalog` | `catalog.create` |
| PATCH | `/catalog/:id` | `catalog.update` |

### Team management (existing resource, extended)

| Method | Path | Required permission |
|---|---|---|
| GET | `/api/v1/platform/admins` | `platform.team.view` |
| POST | `/api/v1/platform/admins` | `platform.team.manage` |
| PATCH | `/api/v1/platform/admins/:username` | `platform.team.manage` |
| DELETE | `/api/v1/platform/admins/:username` | `platform.team.manage` |

`GET /api/v1/platform/audit` requires `platform.audit.view`.
All other `/api/v1/platform/*` routes keep `requirePlatformAdmin()`
(`MASTER_OWNER` + `PLATFORM_ADMIN` only — `DEVELOPER`/`DATA_ENTRY` are excluded).

Every route is **server-authorized**; a caller outside its permission receives
`403` regardless of what the UI renders.

---

## 5. Guardrails

- **Disabled member** — a member with `status: "disabled"` resolves to no role
  immediately, so an already-issued JWT is rejected with `403`.
- **Last-owner guard** — the last active `MASTER_OWNER` cannot be demoted,
  disabled or removed (`409`); a member cannot remove their own membership.
- **Permission overrides** — per-member overrides are *additive only*, validated
  against the known platform permission set, and may only be written by
  `platform.team.manage`. A member can never escalate their own permissions.
- **No secrets** — diagnostics expose component health, artifact identity and
  message-level error summaries only. No env values, JWT/password material,
  hashes, API keys or Monetag credentials are ever returned.
- **No fabricated metrics** — the dashboard reads real stores/services; an
  unavailable source renders `null` / "غير متاح", never an invented number.

## 6. Audit

Team and content mutations record `PLATFORM_*` events via
`services/audit.service.js` (with actor, target, change and result):

- `PLATFORM_TEAM_MEMBER_ADDED` / `UPDATED` / `REMOVED`
- `PLATFORM_CATALOG_ENTRY_CREATED` / `UPDATED`
- plus the pre-existing `PLATFORM_COMPANY_*`, `PLATFORM_USER_*`,
  `PLATFORM_LICENSE_*`, `PLATFORM_INTEGRATION_*`

The audit sanitizer redacts password/token/secret fields; entries never store
credentials.

---

## 7. Frontend

`index.html` → Master Control Center (لفحة مركز التحكم) renders
Dashboard / Diagnostics / Content tabs alongside the existing ones. Navigation
visibility is driven by `GET /access` (`platformPermissions` +
`PLATFORM_TAB_PERMISSION`), and is **display-only**: the API enforces
authorization server-side.

## 8. Tests

`backend/tests/platformControlCenter.test.js` covers the full matrix:
unauthenticated `401`, tenant-user `403`, per-role allow/deny, role & permission
spoofing, privilege escalation, disabled member, last-owner guard, audit
content/secrets, dashboard honesty, catalog CRUD and `tenantId` isolation.
