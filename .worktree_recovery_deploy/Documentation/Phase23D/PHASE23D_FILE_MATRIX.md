# Phase 23D — File Matrix

**Repository:** E:\Projects\ESO
**Baseline:** phase23c-docs (tag phase23c-docs)
**Date:** 2026-08-05
**Status:** Implementation Phase — Code Changes Allowed

---

## File Inventory

### 1. HTML Files

| File | Lines | Status | Action |
|------|-------|--------|--------|
| `index.html` | 40,288 | Primary entry point | Keep as canonical |
| `DigiTronics_v5.html` | 39,903 | Legacy entry point | Archive/remove |

### 2. Configuration Files

| File | Current State | Target State | Action |
|------|---------------|--------------|--------|
| `manifest.json` | References DigiTronics_v5.html | References index.html | Update |
| `sw.js` | Caches both HTML files | Caches only index.html | Update |
| `docker-compose.yml` | Mounts both HTML files | Mounts only index.html | Update |

### 3. Source Files

| File | References | Action |
|------|------------|--------|
| `index.html` | refreshPwaCache() references DigiTronics_v5.html | Update |

### 4. Backend Files

| File | References | Action |
|------|------------|--------|
| `backend/*` | None | No changes |

### 5. Backup Files

| File | Location | Action |
|------|----------|--------|
| `DigiTronics_v5.rollback-safety-*.html` | `backups/html/` | Archive |
| `DigiTronics_v5.before-status-badges-*.html` | `backups/` | Archive |
| `*.bak` files | Root | Remove |

---

## File Dependency Matrix

### 1. HTML File Dependencies

```
index.html (canonical)
    ├── manifest.json (start_url)
    ├── sw.js (cache list)
    ├── docker-compose.yml (mount)
    └── refreshPwaCache() (reference)

DigiTronics_v5.html (legacy)
    ├── manifest.json (start_url) [TO BE REMOVED]
    ├── sw.js (cache list) [TO BE REMOVED]
    ├── docker-compose.yml (mount) [TO BE REMOVED]
    └── refreshPwaCache() (reference) [TO BE REMOVED]
```

### 2. Configuration File Dependencies

```
manifest.json
    ├── start_url → DigiTronics_v5.html [CHANGE TO index.html]
    ├── id → DigiTronics_v5.html [CHANGE TO index.html]
    └── shortcuts → DigiTronics_v5.html [CHANGE TO index.html]

sw.js
    ├── APP_SHELL_ASSETS → DigiTronics_v5.html [REMOVE]
    └── Fallback chain → DigiTronics_v5.html [REMOVE]

docker-compose.yml
    └── volumes → DigiTronics_v5.html [REMOVE]
```

---

## File Change Matrix

### Phase A: Preparation

| File | Action | Risk |
|------|--------|------|
| Git | Create tag `phase23d-pre-merge` | LOW |
| Git | Run baseline tests | LOW |

### Phase B: Verification

| File | Action | Risk |
|------|--------|------|
| Documentation | Document feature diff | LOW |
| Documentation | Document risks | LOW |

### Phase C: Dry Run

| File | Action | Risk |
|------|--------|------|
| Git | Create branch `phase23d-dry-run` | LOW |
| Git | Apply merge on branch | MEDIUM |
| Git | Run tests on branch | LOW |

### Phase D: Merge

| File | Action | Risk |
|------|--------|------|
| `index.html` | Port supplier migration | MEDIUM |
| `index.html` | Port `reconcileMissingCashPurchaseEntries()` | MEDIUM |
| Git | Commit merge | LOW |

### Phase E: Validation

| File | Action | Risk |
|------|--------|------|
| All | Run E2E tests | LOW |
| All | Run backend tests | LOW |
| All | Manual testing | LOW |

### Phase F: Rollback

| File | Action | Risk |
|------|--------|------|
| Git | Create tag `phase23d-post-merge` | LOW |
| Git | Verify rollback procedure | LOW |

### Phase G: Deployment

| File | Action | Risk |
|------|--------|------|
| `manifest.json` | Update start_url to index.html | LOW |
| `manifest.json` | Update id to index.html | LOW |
| `manifest.json` | Update shortcuts to index.html | LOW |
| `sw.js` | Remove DigiTronics_v5.html from cache | LOW |
| `sw.js` | Bump cache name | LOW |
| `docker-compose.yml` | Remove DigiTronics_v5.html mount | LOW |
| `index.html` | Update refreshPwaCache() reference | LOW |
| Git | Commit deployment | LOW |

### Phase H: Post Deployment

| File | Action | Risk |
|------|--------|------|
| `DigiTronics_v5.html` | Archive | LOW |
| `backups/*` | Archive | LOW |
| `*.bak` | Remove | LOW |
| `.gitignore` | Add test-results/ | LOW |
| Git | Commit cleanup | LOW |

---

## File Validation Matrix

### Pre-Merge Validation

| File | Check | Status |
|------|-------|--------|
| `index.html` | Dashboard V6 intact | Pending |
| `index.html` | Performance layer intact | Pending |
| `index.html` | IndexedDB fallback intact | Pending |
| `index.html` | All Phase 23B migrations intact | Pending |

### Post-Merge Validation

| File | Check | Status |
|------|-------|--------|
| `index.html` | Supplier migration ported | Pending |
| `index.html` | `reconcileMissingCashPurchaseEntries()` ported | Pending |
| `index.html` | No Dashboard V3 code | Pending |
| `index.html` | No demo safety badges | Pending |

### Post-Deployment Validation

| File | Check | Status |
|------|-------|--------|
| `manifest.json` | start_url → index.html | Pending |
| `manifest.json` | id → index.html | Pending |
| `manifest.json` | shortcuts → index.html | Pending |
| `sw.js` | DigiTronics_v5.html removed | Pending |
| `sw.js` | Cache name bumped | Pending |
| `docker-compose.yml` | DigiTronics_v5.html mount removed | Pending |
| `index.html` | refreshPwaCache() → index.html | Pending |

---

*File matrix generated: 2026-08-05*
*Tag: phase23c-docs*
*Commit: HEAD*
