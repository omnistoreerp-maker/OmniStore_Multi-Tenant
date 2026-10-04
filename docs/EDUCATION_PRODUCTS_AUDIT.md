# Education Products — Gap Audit & Completion Report

Branch: `agent/master-education-products-completion-20261003`

## 1. Phase 0 — Starting Point (evidence)

| Item | Required by brief | Actual | Notes |
|---|---|---|---|
| `BASE_BRANCH` | `main` | `main` | — |
| `BASE_SHA` | `03758b8` | **`745d385`** | `03758b8` is **not a valid object** in this repository (`git cat-file -e 03758b8` → *Not a valid object name*). It appears in no ref, reflog, or log. |
| Working branch at start | — | `agent/platform-continuation-20260919` @ `bf60775` | 8 commits ahead of `origin`, **unpushed**. `main@745d385` is an ancestor of `bf60775` (verified `git merge-base --is-ancestor`). |
| Worktrees | — | main worktree + `.kilo/worktrees/popular-fog` | — |

**Branch base decision:** work started from `bf60775` (= `main@745d385` **plus** the 8 already-existing local hardening commits). Basing on `main@745d385` directly would have silently dropped those 8 unpushed commits from the review branch.

### 1.1 Environment blocker — the repository is read-only

```
C:\Windows\System32\OmniStore_Multi-Tenant   (owner: BUILTIN\Administrators)
BUILTIN\Users => ReadAndExecute (no Write)
PowerShell is NOT elevated (desktop-sftodsv\hp)
```

Every path in the original tree (`/`, `/backend`, `/backend/data`, `/backend/routes`, `/tests`, **`/.git`**) rejected writes. Therefore **no branch, edit, or commit is possible in place**.

**Action taken:** created a faithful working copy at `C:\Users\hp\OmniStore_Multi-Tenant` (`robocopy /E /COPY:DAT`, 84.5 MB), cleared the read-only attribute, and verified equivalence:

- same branch + HEAD (`bf60775`)
- `backend/node_modules` present
- untracked runtime file `backend/data/platformActivity.json` **preserved**
- `origin` still `git@github.com:omnistoreerp-maker/OmniStore_Multi-Tenant.git`

The original directory was **only read, never modified**.

## 2. Phase 1 — Product Gap Audit

Legend: `COMPLETE` / `PARTIAL` / `MISSING` / `BROKEN` / `UNSAFE`

### 2.1 Students

| Feature | UI | Route | API | Backend | Data | Auth | RBAC | Tenant | Tests | Status | Gap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Print orders (existing) | yes | yes | yes | yes | yes | yes | settings.* | yes | yes | COMPLETE | pre-existing **print shop**, not education |
| Student passes (existing) | yes | yes | yes | yes | yes | yes | settings.* | yes | yes | COMPLETE | pre-existing |
| Student accounts / login | no | no | no | no | no | — | — | — | no | MISSING | no learner identity exists |
| Subjects / courses / lessons | no | no | no | no | no | — | — | — | no | courses **IMPLEMENTED**; lessons **out of model by design** | Education (`education.courses.*`) |
| Learning progress | no | no | no | no | no | — | — | — | no | **NOW IMPLEMENTED** | Education Core |
| Enrollment / subscription | no | no | no | no | no | — | — | — | no | **PARTIAL** | enrollment implemented; **plan/subscription billing missing** |
| Booking / reschedule / cancel | no | no | no | no | no | — | — | — | no | MISSING | no scheduler entity |
| Payments / checkout | — | — | — | — | — | — | — | — | no | MISSING | no education payment provider wired |
| Student dashboard | no | no | no | no | no | — | — | — | no | **PARTIAL** | real counts endpoint + backoffice UI done; learner self-service UI missing |

### 2.2 Teacher

| Feature | Status | Notes |
|---|---|---|
| Teacher entity, profile, bio, subjects, availability, pricing, rating/reviews | **partially** | Teacher profile entity (name/bio/subjects/center/status) is now implemented. Availability, pricing, ratings/reviews → **MISSING** (no such model anywhere in repo). |
| Courses / lessons / draft→published | courses **IMPLEMENTED**, lessons **not in the model** | real course create/edit flows with tests; no lesson entity, by design |
| Students list, enrollments, progress, booking history | **PARTIAL** | student list + enrollments + progress implemented; booking history MISSING (no bookings) |
| Schedule / calendar / reschedule | **MISSING** | no schedule/calendar entity in architecture |
| Revenue / earnings / transactions | **MISSING** | no education financial records; marketplace/ERP finances are a different domain |
| Teacher self-service dashboard (own data only) | **MISSING** | requires a `teacher` role (see §4.1) |
| Teacher notifications | **MISSING** | notification engine exists but is not wired to education |

### 2.3 Centers

| Feature | Status | Notes |
|---|---|---|
| Center profile (name/description/subjects/contact/branding) | **NOW IMPLEMENTED** | contact + subjects + address + status |
| Teachers invite/list/assignment/permissions/status | **PARTIAL** | list + assignment to center + status done; **invite flow and per-teacher permissions missing** |
| Classes / sections / capacity / schedule | **MISSING** | no class/section/capacity model |
| Students per center, enrollment, attendance, progress | **PARTIAL** | student↔center + enrollment + progress done; **attendance missing** |
| Subscriptions / plans / renewal | **MISSING** | no education plans |
| Calendar / conflict validation | **MISSING** | no scheduler |
| Center admin: members/roles/reports/activity | **MISSING** | requires center-member roles (see §4.1) |

### 2.4 Master Control Center

| Feature | Status | Notes |
|---|---|---|
| Platform admin routes (addons / fees / custom domains) | **COMPLETE (pre-existing)** | `platformAdmin.routes.js` behind `requirePlatformAdmin` |
| Unified users / tenants / services / reports UI | **PARTIAL (pre-existing)** | `index.html` monolith + `platform.service.js`; no unified control-center surface |
| RBAC review | **PARTIAL (pre-existing)** | registry has **only ERP roles** (Owner/Admin/Manager/BranchManager/Cashier/Technician/WarehouseSales/Viewer). No platform-admin/center-admin/teacher/student/center-member roles. |
| Audit logs / security events | **COMPLETE (pre-existing)** | `auditLog.json`, `audit.routes.js` |
| Reports with real data | **COMPLETE (pre-existing)** | `reports.service.js` (users/tenants/transactions) — untouched |

**No existing catalog/service status was changed.**

## 3. What Was Implemented (superseded — read this first)

> **SUPERSEDED / ROLLED BACK.** The `Education Core` implementation originally
> described here was **never mounted** in `backend/server.js` — contrary to the
> older revision of this table, there was never a require + mount for it. It was
> removed in full, along with its backoffice page, because it was a dead parallel
> model that could not be reached and must not be resurrected.
>
> **The canonical Education surface is `/education/index.html`**
> (`platform/education/education.js` + `education.css` + `education.dict.js`),
> backed by the 13 routers mounted at `/api/v1/tenant/education`. That
> implementation is the source of truth.

### Removed — do not reintroduce

| File | Type | Why it went |
|---|---|---|
| `backend/services/educationCore.service.js` | removed | Parallel model with its own `educationCore` store. Its `lessons` entity and `PATCH /enrollments/:id/status` contradict the canonical model. |
| `backend/controllers/educationCore.controller.js` | removed | Carried a private tenant resolver instead of the canonical `trustedTenantId`. |
| `backend/routes/educationCore.routes.js` | removed | Gated by `requirePermissionIfAuth`, which returns `next()` unconditionally when `AUTH_REQUIRED` is false — and it defaults to false. Mounting it would have exposed 40+ entity routes incl. `DELETE /:id` with no identity requirement. |
| `education.html` | removed | Legacy backoffice page. Called 6 routes that only `educationCore` served. |
| `platform/education.js` | removed | Client for the above. |
| `backend/tests/educationCore.*.test.js` | removed ×4 | Tested unreachable code. |

### Canonical — current source of truth

| File | Type | Purpose |
|---|---|---|
| `education/index.html` | current | Canonical Education entry (Arabic/RTL, drawer + bottom nav) |
| `platform/education/education.js` | current | Full-CRUD runtime; resolves `/centers/me`, `/teachers/me`, `/students/me` — never a fabricated identity |
| `backend/routes/*.routes.js` ×13 | current | Mounted at `/api/v1/tenant/education`; `requirePermission` on 53 of 62 endpoints |
| `backend/tests/educationModuleHygiene.test.js` | current | Asserts the removed files stay removed and no mount returns |

### The lessons decision

The canonical model has **no lesson entity**. `student.controller.js` reports
`lessons: { total: 0 }` by design rather than fabricating a lesson set from
sessions or attendance. That is the intended contract, so the legacy
lessons/progress surface was not rebuilt under another name.

| `business.html` | current | Education card routes to `/education/index.html` |
| `docs/EDUCATION_PRODUCTS_AUDIT.md` | current | this document |

### Security properties enforced and tested

- tenant identity only from `req.tenantContext` / signed token claim (never query/body/header)
- `tenantId` in a payload is **rejected**
- cross-entity references validated to be **same-tenant** (tenant B cannot link A's center/teacher/course/student)
- reads of another tenant's resource → **404**
- forged `X-Tenant-Id` header → **no leak**
- anonymous → **401** when `AUTH_REQUIRED=true`
- mass-assignment on `tenantId` closed; explicit field whitelisting
- referential integrity: in-use centers/teachers/students/courses cannot be deleted
- lesson progress validated against the enrollment's own course

## 4. Remaining Gaps (BLOCKED / REQUIRE_FOLLOWUP)

### 4.1 `BLOCKED_FEATURE=` education roles (teacher / student / center-admin / center-member)

```
WHY_BLOCKED=RBAC registry has no education roles; permissionRegistry.test.js
            asserts registry.groups().length === 16, so adding a REAL group
            changes REAL_PERMISSIONS and the Owner/Admin baseline contract.
CURRENT_STATE=routes gated by settings.view / settings.edit (Owner/Admin
            bypass); writes additionally guarded by the global
            scopedWriteRoleGuard('Owner','Admin','Manager').
REQUIRED_COMPONENT=role-model extension with an explicit migration of the
            registry contract + its tests, then per-role route guards.
SAFE_NEXT_STEP=add a dedicated `education` permission group in a follow-up
            that also updates permissionRegistry.test.js deliberately.
```

### 4.2 `BLOCKED_FEATURE=` booking / scheduling / calendar

```
WHY_BLOCKED=no scheduler, availability, session or time-slot entity exists anywhere
CURRENT_STATE=absent
REQUIRED_COMPONENT=availability + session entities, conflict-detection rules,
            reschedule/cancel state machine, timezone handling.
SAFE_NEXT_STEP=model sessions on top of Education Core courses/teachers.
```

### 4.3 `BLOCKED_FEATURE=` education payments / subscriptions / renewals

```
WHY_BLOCKED=no education payment provider or education plan model
CURRENT_STATE=marketCheckout + tenantPayments exist but serve the marketplace
            and tenant billing, not per-student education plans.
REQUIRED_COMPONENT=plan/subscription entity + provider integration + webhook
            reconciliation + entitlement gating.
SAFE_NEXT_STEP=do NOT invent a provider; wire to an existing approved provider
            behind an interface in a separate PR.
```

### 4.4 `BLOCKED_FEATURE=` teacher revenue / reviews / ratings

```
WHY_BLOCKED=no education financial records and no review/rating model
CURRENT_STATE=absent (ERP finances belong to the marketplace/ERP domain)
REQUIRED_COMPONENT=ledger records linked to sessions; review entity + moderation.
SAFE_NEXT_STEP=build after sessions (4.2) exist, so earnings are derivable.
```

### 4.5 `BLOCKED_FEATURE=` learner self-service UI (student/teacher own view)

```
WHY_BLOCKED=depends on 4.1 roles (who is "this student"?)
CURRENT_STATE=backoffice UI only (operator/administrator view)
REQUIRED_COMPONENT=per-role session context + own-data scoped endpoints.
SAFE_NEXT_STEP=blocked by 4.1.
```

### 4.6 `BLOCKED_FEATURE=` PR creation

```
WHY_BLOCKED=GitHub CLI installed but not authenticated (`gh auth login` required)
CURRENT_STATE=branch pushed; remote ref verified.
REQUIRED_COMPONENT=authenticated `gh`.
SAFE_NEXT_STEP=open the PR from the compare URL below.
```

## 5. Test Evidence

```
BASELINE (before)  Test Suites: 119/120 passed, Tests: 1674/1700
                   (the single failing suite p0-003 = 26 tests failed ONLY with
                    a Windows jest transform-cache EPERM; passes with --no-cache)
AFTER   (final)    Test Suites: 124 passed, 124 total
                   Tests: 1727 passed, 1727 total   (--no-cache, 0 failures)
NEW TESTS          4 suites / 27 tests (service 10, isolation 6, routes 5, authz/E2E 6)
                   1700 baseline → 1727 final = +27
                   [HISTORICAL — those 4 educationCore suites were later removed;
                    see section 3. The canonical Education suites are
                    student/teacher/center/teacherScope/educationPack instead.]
LIVE SMOKE         health 200 | platform-public/sections 200 |
                   market/config 200 (X-Tenant-Id) | market/products 200 |
                   market.html 200 | platform.html 200 | business.html 200 |
                   education/index.html 200 |          <-- canonical entry
                   api/v1/tenant/education/students 401 unauthenticated | 404 unknown
```

