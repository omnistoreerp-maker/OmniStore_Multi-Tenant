# Phase 23D — Risk Register

**Repository:** E:\Projects\ESO
**Baseline:** phase23c-docs (tag phase23c-docs)
**Date:** 2026-08-05
**Status:** Implementation Phase — Code Changes Allowed

---

## Risk Assessment Matrix

| Risk ID | Risk | Impact | Likelihood | Severity | Phase | Mitigation |
|---------|------|--------|------------|----------|-------|------------|
| R-001 | Feature loss during merge | HIGH | MEDIUM | CRITICAL | C, D | Dry run on branch, feature verification, rollback point |
| R-002 | PWA users cached old manifest | HIGH | HIGH | CRITICAL | G | Force SW update, cache name bump, version increment |
| R-003 | Service Worker cache invalidation | MEDIUM | HIGH | HIGH | G | Update SW cache names, force refresh, version bump |
| R-004 | Dashboard regression | HIGH | LOW | HIGH | C, D | Visual regression testing, Dashboard V6 verification |
| R-005 | Data loss (IndexedDB fallback) | HIGH | LOW | CRITICAL | C, D | Verify IndexedDB fallback intact, test data persistence |
| R-006 | Rollback complexity | MEDIUM | LOW | MEDIUM | F | Git tag before merge, clear procedure, test rollback |
| R-007 | manifest.json references wrong file | HIGH | HIGH | CRITICAL | G | Update start_url, id, shortcuts to index.html |
| R-008 | sw.js caches wrong files | MEDIUM | HIGH | HIGH | G | Update cache list, remove DigiTronics_v5.html |
| R-009 | docker-compose.yml mounts wrong files | LOW | HIGH | MEDIUM | G | Remove DigiTronics_v5.html mount |
| R-010 | nginx serves wrong files | LOW | HIGH | MEDIUM | G | Monitor-only: nginx serves index.html by default, no config change needed |
| R-011 | refreshPwaCache() references wrong file | MEDIUM | HIGH | HIGH | G | Update HTML reference to index.html |
| R-012 | Supplier migration lost | MEDIUM | MEDIUM | HIGH | C, D | Port supplier migration from DigiTronics_v5.html |
| R-013 | reconcileMissingCashPurchaseEntries() lost | MEDIUM | MEDIUM | HIGH | C, D | Port function from DigiTronics_v5.html |
| R-014 | Demo safety badges regression | LOW | LOW | LOW | C, D | Verify badges intentionally removed in V6 |
| R-015 | Performance layer regression | HIGH | LOW | CRITICAL | C, D | Verify computeStockMap, scheduleRender, IndexedDB intact |
| R-016 | Test failures after merge | HIGH | MEDIUM | HIGH | E | Run all tests before and after, compare results |
| R-017 | PWA installation failure | HIGH | MEDIUM | HIGH | G, H | Test PWA installation on multiple devices |
| R-018 | Service Worker update failure | MEDIUM | MEDIUM | HIGH | G, H | Test SW update, verify cache invalidation |
| R-019 | Offline mode failure | MEDIUM | LOW | MEDIUM | E | Test offline mode, verify SW caching |
| R-020 | Visual regression | HIGH | LOW | HIGH | E | Visual regression testing, compare UI before/after |

---

## Risk Severity Levels

| Level | Description | Action |
|-------|-------------|--------|
| CRITICAL | Could cause data loss or system failure | Must mitigate before proceeding |
| HIGH | Could cause significant regression | Must mitigate before proceeding |
| MEDIUM | Could cause minor issues | Should mitigate |
| LOW | Unlikely to cause issues | Monitor |

---

## Risk Response Plans

### R-001: Feature Loss During Merge

**Trigger:** Merge removes features from index.html
**Response:**
1. Stop merge immediately
2. Compare with DigiTronics_v5.html
3. Identify missing features
4. Port missing features
5. Re-run validation

### R-002: PWA Users Cached Old Manifest

**Trigger:** PWA users see old DigiTronics_v5.html
**Response:**
1. Force SW update via cache name bump
2. Update manifest.json start_url
3. Verify PWA installation
4. Monitor error logs

### R-005: Data Loss (IndexedDB Fallback)

**Trigger:** IndexedDB fallback not working
**Response:**
1. Verify IndexedDB code intact in index.html
2. Test data persistence
3. Verify localStorage → IndexedDB fallback
4. Test with large datasets

### R-012: Supplier Migration Lost

**Trigger:** Supplier balance migration not ported
**Response:**
1. Compare supplier migration code
2. Port from DigiTronics_v5.html
3. Test supplier balance functionality
4. Verify migration completes

### R-015: Performance Layer Regression

**Trigger:** Performance optimizations not working
**Response:**
1. Verify computeStockMap() intact
2. Verify scheduleRender() intact
3. Verify IndexedDB fallback intact
4. Test performance with large datasets

---

## Risk Monitoring

### During Implementation

- Monitor test results after each phase
- Monitor console errors
- Monitor PWA installation
- Monitor Service Worker updates

### During Deployment

- Monitor deployment logs
- Monitor error rates
- Monitor PWA installation rates
- Monitor user reports

### Post Deployment

- Monitor error logs for 24 hours
- Monitor PWA installation rates
- Monitor user reports
- Monitor performance metrics

---

*Risk register generated: 2026-08-05*
*Tag: phase23c-docs*
*Commit: HEAD*
