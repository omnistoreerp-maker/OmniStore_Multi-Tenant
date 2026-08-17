# FIRST COMPANY ACCEPTANCE

Runbook for accepting a clean-machine OmniStore deployment as **operational
for the first real company**. Tick each item; every box must pass (or be
marked NOT APPLICABLE with a reason) before declaring the company live.

Machine under test: `________` · Install dir: `________` · Data dir: `________`
Release: `________` · Date: `________` · Tester: `________`

---

## A. Installation

- [ ] Node.js 18+ verified (`node -v`)
- [ ] Installer ran without errors (`scripts/install-windows.ps1`)
- [ ] App files present in install dir (`backend/server.js`, `index.html`)
- [ ] `.env` generated with random `JWT_SECRET` / `JWT_REFRESH_SECRET`
- [ ] `DIGITRONICS_DATA_DIR` points OUTSIDE the app directory
- [ ] Backend starts (service or startup) and `GET /api/v1/health` → 200

## B. First Company & Users

- [ ] `npm run provision -- --company-name ... --company-code ... --admin-username admin --admin-password ...` succeeds
- [ ] Re-running provision is idempotent (no duplicates, password unchanged)
- [ ] Admin user exists with `tenantIds` + `tenantRoles` membership

## C. Login & Tenant Context

- [ ] Company selection shows the new company (`/api/v1/companies/active`)
- [ ] Admin login succeeds with company context
- [ ] `GET /api/v1/auth/me` returns the authenticated user
- [ ] A second company's user cannot see this company's data (isolation)

## D. Business Operations

- [ ] Product creation works (global product)
- [ ] Customer creation works (tenant-scoped)
- [ ] Sale creation works and appears in the sales list
- [ ] Purchase creation works and appears in the purchases list
- [ ] Treasury entry works and appears in the treasury list
- [ ] Dashboard/reports respond without server errors

## E. Persistence & Restart

- [ ] Backend restart (stop/start) preserves all created data
- [ ] Data files live in `DIGITRONICS_DATA_DIR` and survive restarts
- [ ] `npm run backup` produces an archive; `npm run verify-backup` passes

## F. Update Rail

- [ ] `GET /api/v1/update/manifest` returns `currentVersion`
- [ ] Publishing a newer release + manifest shows the Arabic banner
      (*يوجد تحديث جديد لـ OmniStore*, current/latest version, release notes)
- [ ] **[تحديث الآن]** starts the updater (202 accepted, admin role)
- [ ] Download completes and SHA-256 is verified against the manifest
- [ ] Previous installation backed up before swap
- [ ] New version starts and health check passes
- [ ] Existing company data survives the update untouched
- [ ] Rollback path verified: a failing new version restores the previous one
      (or documented manual procedure)

## G. Security Baseline

- [ ] `AUTH_REQUIRED=true`
- [ ] No secrets in the release zip (`backend/.env` absent)
- [ ] Cross-tenant read/update/delete blocked (P0-003/P0-004 regression suites
      green: 75 suites / 1038+ tests, ALL PASSING)
- [ ] Update apply endpoint rejects non-admin roles (403)

---

## Sign-off

All items above: **PASS** / **FAIL** (circle). 

Blockers preventing go-live:

1. ______________________________________________________
2. ______________________________________________________

Remaining work before go-live (if any): ______________________________________

Signed: ______________________ Date: ______________

*Reference: `GO_LIVE.md` — provisioning, backup, update and rollback
procedures.*
