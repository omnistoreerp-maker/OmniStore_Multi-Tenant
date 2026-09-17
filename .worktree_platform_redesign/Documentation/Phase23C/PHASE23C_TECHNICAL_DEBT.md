# Phase 23C — Technical Debt Inventory

**Repository:** E:\Projects\ESO
**Baseline:** phase23b-stable (tag e66b6fd)
**Date:** 2026-08-05
**Status:** Documentation Only — No Code Changes

---

## 1. Debt Overview

### 1.1 Debt Summary

| Category | Count | Total Effort |
|----------|-------|--------------|
| Critical Debt | 3 | 2-3 days |
| Medium Debt | 4 | 1-2 days |
| Low Debt | 4 | 0.5-1 day |
| **Total** | **11** | **3.5-6 days** |

### 1.2 Debt by Severity

```
Critical ████████████ 3 items (27%)
Medium   ████████████████ 4 items (36%)
Low      ████████████████ 4 items (36%)
```

---

## 2. Critical Debt

### 2.1 manifest.json References DigiTronics_v5.html

| Field | Value |
|-------|-------|
| **Impact** | PWA install targets wrong file |
| **Priority** | HIGH |
| **Affected Files** | manifest.json |
| **Line Range** | All |
| **Effort** | Low (0.5 day) |
| **Dependencies** | HTML consolidation (23D) |

**Current State:**
```json
{
  "start_url": "DigiTronics_v5.html"
}
```

**Target State:**
```json
{
  "start_url": "index.html"
}
```

**Resolution Strategy:**
1. Consolidate HTML files first (Phase 23D)
2. Update manifest.json to reference index.html
3. Test PWA installation

---

### 2.2 AUTH_REQUIRED Defaults to False

| Field | Value |
|-------|-------|
| **Impact** | All routes open by default |
| **Priority** | HIGH |
| **Affected Files** | backend/config/index.js |
| **Line Range** | Line 16 |
| **Effort** | Low (0.5 day) |
| **Dependencies** | None |

**Current State:**
```javascript
authRequired: process.env.AUTH_REQUIRED === 'true',
```

**Target State:**
```javascript
authRequired: process.env.AUTH_REQUIRED !== 'false',
```

**Resolution Strategy:**
1. Change default to true
2. Document breaking change in release notes
3. Update deployment guide

---

### 2.3 Two HTML Files Maintained Simultaneously

| Field | Value |
|-------|-------|
| **Impact** | Feature drift, confusion |
| **Priority** | HIGH |
| **Affected Files** | index.html, DigiTronics_v5.html |
| **Line Range** | All |
| **Effort** | Medium (2-3 days) |
| **Dependencies** | None |

**Current State:**
- index.html (37,827 lines) — nginx default
- DigiTronics_v5.html (37,464 lines) — manifest.json default
- 363 lines of drift between files

**Target State:**
- Single index.html as canonical entry point
- DigiTronics_v5.html archived or removed
- manifest.json updated to reference index.html

**Resolution Strategy:**
1. Identify all drift between files
2. Merge unique features into index.html
3. Update manifest.json
4. Update Service Worker
5. Archive DigiTronics_v5.html

---

## 3. Medium Debt

### 3.1 ~30 Direct Supabase Calls Remain

| Field | Value |
|-------|-------|
| **Impact** | Backend bypass for device tracking |
| **Priority** | MEDIUM |
| **Affected Files** | index.html, DigiTronics_v5.html |
| **Line Range** | Various (see grep results) |
| **Effort** | High (5-7 days) |
| **Dependencies** | Backend device tracking module |

**Current State:**
- ~30 direct `client.from()` calls in each HTML file
- Tables affected: devices, device_repairs, products, product_stock_balance, stock_transactions, purchase_items, sale_items
- Used for device tracking and UUID migration

**Target State:**
- All Supabase calls replaced with backend adapter calls
- Device tracking module added to backend
- UUID migration utilities deprecated or removed

**Resolution Strategy:**
1. Create backend device tracking module
2. Create backend UUID migration module
3. Migrate frontend calls to backend adapters
4. Remove direct Supabase calls

---

### 3.2 No CSRF Protection

| Field | Value |
|-------|-------|
| **Impact** | Cookie-based token vulnerability |
| **Priority** | MEDIUM |
| **Affected Files** | backend/middleware/ (new file needed) |
| **Line Range** | N/A |
| **Effort** | Medium (1-2 days) |
| **Dependencies** | None |

**Current State:**
- JWT tokens in Authorization header (safe)
- No CSRF protection for cookie-based flows
- Vulnerable to CSRF attacks if cookies used

**Target State:**
- CSRF token generation
- CSRF token validation middleware
- Bearer token bypass
- Frontend integration (X-CSRF-Token header)

**Resolution Strategy:**
1. Design CSRF token generation
2. Implement CSRF middleware
3. Add Bearer token bypass
4. Update frontend to include CSRF header

---

### 3.3 SW Cache Name Mismatch

| Field | Value |
|-------|-------|
| **Impact** | Potential cache invalidation issues |
| **Priority** | MEDIUM |
| **Affected Files** | sw.js, index.html, DigiTronics_v5.html |
| **Line Range** | Various |
| **Effort** | Low (0.5 day) |
| **Dependencies** | HTML consolidation |

**Current State:**
- sw.js has one cache name
- Embedded SW in HTML files have different cache names
- refreshPwaCache may not clear all caches

**Target State:**
- Consistent cache names across all SW code
- refreshPwaCache clears all relevant caches

**Resolution Strategy:**
1. Identify all cache names
2. Standardize cache naming convention
3. Update refreshPwaCache to clear all caches

---

### 3.4 363-Line Drift Between HTML Files

| Field | Value |
|-------|-------|
| **Impact** | Maintenance burden |
| **Priority** | MEDIUM |
| **Affected Files** | index.html, DigiTronics_v5.html |
| **Line Range** | Various |
| **Effort** | Medium (1-2 days) |
| **Dependencies** | None |

**Current State:**
- 363 lines of drift in non-Phase-23B areas
- index.html has additional features
- DigiTronics_v5.html has Dashboard V3 CSS

**Target State:**
- All features in single file
- No drift (single source of truth)

**Resolution Strategy:**
1. Identify all drift points
2. Merge unique features into index.html
3. Test all functionality
4. Archive DigiTronics_v5.html

---

## 4. Low Debt

### 4.1 Backup Files in Repository

| Field | Value |
|-------|-------|
| **Impact** | Clutter |
| **Priority** | LOW |
| **Affected Files** | backups/ directory |
| **Line Range** | N/A |
| **Effort** | Low (0.25 day) |
| **Dependencies** | None |

**Current State:**
- 4 backup HTML files in backups/ directories
- 3 subdirectories with backups

**Target State:**
- Backup files archived to separate branch/tag
- backups/ directory removed from main branch

**Resolution Strategy:**
1. Create archive branch
2. Move backups to archive branch
3. Remove from main branch
4. Update .gitignore

---

### 4.2 .bak Files in Root

| Field | Value |
|-------|-------|
| **Impact** | Clutter |
| **Priority** | LOW |
| **Affected Files** | *.bak files in root |
| **Line Range** | N/A |
| **Effort** | Low (0.25 day) |
| **Dependencies** | None |

**Current State:**
- 3 .bak files in repository root

**Target State:**
- .bak files removed from version control
- .gitignore updated to exclude .bak files

**Resolution Strategy:**
1. Identify all .bak files
2. Remove from version control
3. Add *.bak to .gitignore

---

### 4.3 Vercel No-Cache Headers

| Field | Value |
|-------|-------|
| **Impact** | Performance impact |
| **Priority** | LOW |
| **Affected Files** | vercel.json |
| **Line Range** | N/A |
| **Effort** | Low (0.25 day) |
| **Dependencies** | None |

**Current State:**
- Vercel deploys with `no-cache` for all routes
- Browser must re-fetch everything on each visit

**Target State:**
- Cache headers aligned with nginx
- Static assets cached
- HTML revalidated

**Resolution Strategy:**
1. Review nginx cache headers
2. Update vercel.json to match
3. Test cache behavior

---

### 4.4 Monolithic HTML (37K Lines)

| Field | Value |
|-------|-------|
| **Impact** | Developer experience |
| **Priority** | LOW |
| **Affected Files** | index.html, DigiTronics_v5.html |
| **Line Range** | All |
| **Effort** | High (7-10 days) |
| **Dependencies** | HTML consolidation |

**Current State:**
- Both HTML files are 37K+ lines
- No code splitting / dynamic imports
- Browser must parse entire app on load

**Target State:**
- Code splitting for non-critical modules
- Lazy loading for heavy components
- Faster initial load

**Resolution Strategy:**
1. Identify non-critical modules
2. Implement dynamic imports
3. Add lazy loading
4. Test performance improvement

---

## 5. Debt Resolution Roadmap

### 5.1 Phase 23D: HTML Consolidation

| Debt | Resolution |
|------|------------|
| manifest.json references DigiTronics_v5.html | Update to index.html |
| Two HTML files maintained | Consolidate to single file |
| 363-line drift | Merge unique features |
| SW cache name mismatch | Standardize cache names |

**Estimated Effort:** 2-3 days
**Risk:** Medium (PWA users may have cached old manifest)

---

### 5.2 Phase 23E: Legacy Cleanup

| Debt | Resolution |
|------|------------|
| Backup files in repository | Archive to separate branch |
| .bak files in root | Remove from version control |
| ~30 direct Supabase calls | Migrate to backend adapters |

**Estimated Effort:** 1-2 days
**Risk:** Low

---

### 5.3 Phase 23F: Performance & Security

| Debt | Resolution |
|------|------------|
| AUTH_REQUIRED defaults to false | Change default to true |
| No CSRF protection | Implement CSRF middleware |
| Vercel no-cache headers | Align with nginx |
| Monolithic HTML | Implement code splitting |

**Estimated Effort:** 2-3 days
**Risk:** Medium (breaking change for AUTH_REQUIRED)

---

## 6. Debt Tracking Spreadsheet

| ID | Debt | Severity | Effort | Phase | Status |
|----|------|----------|--------|-------|--------|
| D-001 | manifest.json references DigiTronics_v5.html | Critical | 0.5d | 23D | Pending |
| D-002 | AUTH_REQUIRED defaults to false | Critical | 0.5d | 23F | Pending |
| D-003 | Two HTML files maintained | Critical | 2-3d | 23D | Pending |
| D-004 | ~30 direct Supabase calls | Medium | 5-7d | 23E | Pending |
| D-005 | No CSRF protection | Medium | 1-2d | 23F | Pending |
| D-006 | SW cache name mismatch | Medium | 0.5d | 23D | Pending |
| D-007 | 363-line drift | Medium | 1-2d | 23D | Pending |
| D-008 | Backup files in repository | Low | 0.25d | 23E | Pending |
| D-009 | .bak files in root | Low | 0.25d | 23E | Pending |
| D-010 | Vercel no-cache headers | Low | 0.25d | 23F | Pending |
| D-011 | Monolithic HTML | Low | 7-10d | 23F | Pending |

---

*Technical debt inventory generated: 2026-08-05*
*Tag: phase23b-stable*
*Commit: e66b6fd*
