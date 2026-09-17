# Phase 23D — Implementation Checklist (Redesigned)

**Repository:** E:\Projects\ESO
**Baseline:** phase23c-docs (tag phase23c-docs)
**Date:** 2026-08-05
**Status:** Implementation Phase — Code Changes Allowed

---

## Phase A: Preparation

**Goal:** Establish baseline and create rollback point
**Inputs:** Phase 23C documentation, current repository state
**Outputs:** Git tag, baseline test results
**Preconditions:** Phase 23C complete, all tests passing

### A-1: Git Tag

- [ ] Create git tag `phase23d-pre-merge`
- [ ] Verify tag exists locally
- [ ] Push tag to remote
- **Validation:** Tag exists and is accessible
- **Rollback:** Delete tag
- **Completion Gate:** Tag created and pushed

### A-2: Baseline Testing

- [ ] Run all E2E tests (verify.js)
- [ ] Run all backend tests
- [ ] Document baseline results
- [ ] Verify all tests pass
- **Validation:** All 80 E2E tests pass, all 253 backend tests pass
- **Rollback:** None (read-only)
- **Completion Gate:** Baseline established, all tests pass

### A-3: Feature Documentation

- [ ] Document unique features in DigiTronics_v5.html
- [ ] Document unique features in index.html
- [ ] Create feature comparison
- [ ] Identify features to port
- **Validation:** Feature diff documented
- **Rollback:** None (documentation only)
- **Completion Gate:** Feature diff approved

**Phase A Gate:** All tasks complete, baseline established, feature diff approved

---

## Phase B: Verification

**Goal:** Verify risks and test baseline
**Inputs:** Feature diff, risk assessment
**Outputs:** Verified risks, test baseline
**Preconditions:** Phase A complete

### B-1: Risk Verification

- [ ] Verify risk register complete
- [ ] Verify rollback plan complete
- [ ] Verify deployment plan complete
- [ ] Verify test plan complete
- **Validation:** All plans reviewed and approved
- **Rollback:** None (documentation only)
- **Completion Gate:** All plans approved

### B-2: Test Baseline Verification

- [ ] Verify E2E test baseline (80/80)
- [ ] Verify backend test baseline (253/253)
- [ ] Document baseline metrics
- [ ] Verify no flaky tests
- **Validation:** Baseline metrics documented
- **Rollback:** None (read-only)
- **Completion Gate:** Baseline verified

**Phase B Gate:** All risks verified, test baseline established

---

## Phase C: Dry Run

**Goal:** Test merge on branch before applying to main
**Inputs:** Feature diff, merge strategy
**Outputs:** Validated merge on branch
**Preconditions:** Phase B complete

### C-1: Create Dry Run Branch

- [ ] Create branch `phase23d-dry-run`
- [ ] Verify branch created
- [ ] Switch to branch
- **Validation:** Branch exists and is active
- **Rollback:** Delete branch
- **Completion Gate:** Branch created

### C-2: Apply Merge on Branch

- [ ] Port supplier migration from DigiTronics_v5.html
- [ ] Port `reconcileMissingCashPurchaseEntries()` from DigiTronics_v5.html
- [ ] Verify no Dashboard V3 code added
- [ ] Verify no demo safety badges added
- **Validation:** Merge applied correctly
- **Rollback:** `git checkout main; git branch -D phase23d-dry-run`
- **Completion Gate:** Merge applied, features ported

### C-3: Validate Merge on Branch

- [ ] Run all E2E tests on branch
- [ ] Run all backend tests on branch
- [ ] Verify no regression
- [ ] Verify Dashboard V6 intact
- [ ] Verify performance layer intact
- [ ] Verify IndexedDB fallback intact
- **Validation:** All tests pass, no regression
- **Rollback:** Delete branch
- **Completion Gate:** All tests pass on branch

### C-4: Visual Regression on Branch

- [ ] Screenshot Dashboard V6
- [ ] Screenshot all pages
- [ ] Compare with baseline
- [ ] Document any differences
- **Validation:** No visual regression
- **Rollback:** Delete branch
- **Completion Gate:** No visual regression

**Phase C Gate:** Merge validated on branch, all tests pass, no visual regression

---

## Phase D: Merge

**Goal:** Apply merge to main
**Inputs:** Validated merge from dry run
**Outputs:** Merged index.html
**Preconditions:** Phase C complete

### D-1: Switch to Main

- [ ] Switch to main branch
- [ ] Verify clean working tree
- [ ] Pull latest changes
- **Validation:** Main branch is clean
- **Rollback:** None (read-only)
- **Completion Gate:** Main branch ready

### D-2: Apply Merge to Main

- [ ] Port supplier migration from DigiTronics_v5.html
- [ ] Port `reconcileMissingCashPurchaseEntries()` from DigiTronics_v5.html
- [ ] Verify merge matches dry run
- [ ] Verify no extra changes
- **Validation:** Merge applied correctly
- **Rollback:** `git checkout -- index.html`
- **Completion Gate:** Merge applied

### D-3: Validate Merge on Main

- [ ] Run all E2E tests on main
- [ ] Run all backend tests on main
- [ ] Verify no regression
- [ ] Verify all features intact
- **Validation:** All tests pass
- **Rollback:** `git checkout -- index.html`
- **Completion Gate:** All tests pass

### D-4: Commit Merge

- [ ] Stage index.html
- [ ] Commit with descriptive message
- [ ] Verify commit hash
- **Validation:** Commit created
- **Rollback:** `git reset HEAD~1`
- **Completion Gate:** Commit created

**Phase D Gate:** Merge applied to main, all tests pass, commit created

---

## Phase E: Validation

**Goal:** Final validation before deployment
**Inputs:** Merged code
**Outputs:** Validation results
**Preconditions:** Phase D complete

### E-1: Automated Testing

- [ ] Run all E2E tests (80/80)
- [ ] Run all backend tests (253/253)
- [ ] Verify no test failures
- [ ] Document test results
- **Validation:** All tests pass
- **Rollback:** `git revert <commit>`
- **Completion Gate:** All tests pass

### E-2: Manual Testing

- [ ] Test PWA installation
- [ ] Test Service Worker update
- [ ] Test all CRUD operations
- [ ] Test offline mode
- [ ] Test responsive design
- **Validation:** All manual tests pass
- **Rollback:** `git revert <commit>`
- **Completion Gate:** All manual tests pass

### E-3: Visual Regression

- [ ] Compare UI before/after merge
- [ ] Verify no visual differences
- [ ] Test on multiple browsers
- [ ] Test on mobile devices
- **Validation:** No visual regression
- **Rollback:** `git revert <commit>`
- **Completion Gate:** No visual regression

### E-4: Performance Validation

- [ ] Verify computeStockMap() works
- [ ] Verify scheduleRender() works
- [ ] Verify IndexedDB fallback works
- [ ] Test with large datasets
- **Validation:** Performance intact
- **Rollback:** `git revert <commit>`
- **Completion Gate:** Performance intact

**Phase E Gate:** All validation complete, no regression

---

## Phase F: Rollback

**Goal:** Create rollback point and verify procedure
**Inputs:** Validated merge
**Outputs:** Rollback point, verified procedure
**Preconditions:** Phase E complete

### F-1: Create Rollback Point

- [ ] Create git tag `phase23d-post-merge`
- [ ] Verify tag exists locally
- [ ] Push tag to remote
- **Validation:** Tag created and pushed
- **Rollback:** Delete tag
- **Completion Gate:** Rollback point created

### F-2: Verify Rollback Procedure

- [ ] Test rollback to `phase23d-pre-merge`
- [ ] Verify rollback works
- [ ] Restore to `phase23d-post-merge`
- [ ] Verify restore works
- **Validation:** Rollback procedure verified
- **Rollback:** None (test only)
- **Completion Gate:** Rollback procedure verified

**Phase F Gate:** Rollback point created, procedure verified

---

## Phase G: Deployment

**Goal:** Update deployment files and deploy
**Inputs:** Validated merge
**Outputs:** Updated deployment files
**Preconditions:** Phase F complete

### G-1: Update manifest.json

- [ ] Update `start_url` to `./index.html`
- [ ] Update `id` to `/index.html`
- [ ] Update shortcuts to `./index.html`
- [ ] Verify PWA installation
- **Validation:** manifest.json updated correctly
- **Rollback:** `git checkout -- manifest.json`
- **Completion Gate:** manifest.json updated

### G-2: Update sw.js

- [ ] Remove `DigiTronics_v5.html` from cache list
- [ ] Bump cache name
- [ ] Test SW update
- [ ] Verify cache invalidation
- **Validation:** sw.js updated correctly
- **Rollback:** `git checkout -- sw.js`
- **Completion Gate:** sw.js updated

### G-3: Update docker-compose.yml

- [ ] Remove `DigiTronics_v5.html` mount
- [ ] Test `docker-compose up`
- [ ] Verify application loads
- **Validation:** docker-compose.yml updated correctly
- **Rollback:** `git checkout -- docker-compose.yml`
- **Completion Gate:** docker-compose.yml updated

### G-4: Update refreshPwaCache()

- [ ] Update HTML reference to `index.html`
- [ ] Test cache refresh
- [ ] Verify no errors
- **Validation:** refreshPwaCache() updated correctly
- **Rollback:** `git checkout -- index.html`
- **Completion Gate:** refreshPwaCache() updated

### G-5: Commit Deployment

- [ ] Stage all deployment files
- [ ] Commit with descriptive message
- [ ] Verify commit hash
- **Validation:** Commit created
- **Rollback:** `git reset HEAD~1`
- **Completion Gate:** Commit created

### G-6: Deploy to Production

- [ ] Push to remote
- [ ] Verify deployment
- [ ] Test PWA installation
- [ ] Test Service Worker update
- **Validation:** Deployment successful
- **Rollback:** `git revert <commit>`
- **Completion Gate:** Deployment successful

**Phase G Gate:** Deployment complete, PWA works

---

## Phase H: Post Deployment

**Goal:** Verify deployment and cleanup
**Inputs:** Deployed code
**Outputs:** Verified deployment, cleaned repository
**Preconditions:** Phase G complete

### H-1: Post-Deployment Verification

- [ ] Monitor error logs for 1 hour
- [ ] Monitor PWA installation rates
- [ ] Monitor user reports
- [ ] Verify no issues
- **Validation:** No issues detected
- **Rollback:** `git revert <commit>`
- **Completion Gate:** No issues

### H-2: Archive DigiTronics_v5.html

- [ ] Create archive branch (if needed)
- [ ] Move DigiTronics_v5.html to archive
- [ ] Remove from main branch
- [ ] Verify no references remain
- **Validation:** DigiTronics_v5.html archived
- **Rollback:** Restore from archive
- **Completion Gate:** DigiTronics_v5.html archived

### H-3: Remove .bak Files

- [ ] List all .bak files
- [ ] Remove from version control
- [ ] Add `*.bak` to .gitignore
- [ ] Verify removal
- **Validation:** .bak files removed
- **Rollback:** Restore from git
- **Completion Gate:** .bak files removed

### H-4: test-results/ Cleanup

- [ ] Add `test-results/` to .gitignore
- [ ] Remove from version control (if tracked)
- [ ] Verify .gitignore entry
- **Validation:** test-results/ ignored
- **Rollback:** Remove from .gitignore
- **Completion Gate:** test-results/ ignored

### H-5: Force SW Update

- [ ] Update SW cache name
- [ ] Force SW update on deployment
- [ ] Verify old caches cleared
- **Validation:** SW updated
- **Rollback:** Restore cache name
- **Completion Gate:** SW updated

### H-6: Final Commit

- [ ] Stage all cleanup changes
- [ ] Commit with descriptive message
- [ ] Push to remote
- **Validation:** Cleanup committed
- **Rollback:** `git revert <commit>`
- **Completion Gate:** Cleanup complete

**Phase H Gate:** Deployment verified, cleanup complete

---

## Summary

| Phase | Tasks | Status | Gate |
|-------|-------|--------|------|
| A: Preparation | 3 | [ ] Not Started | Baseline established |
| B: Verification | 2 | [ ] Not Started | Risks verified |
| C: Dry Run | 4 | [ ] Not Started | Merge validated |
| D: Merge | 4 | [ ] Not Started | Merge applied |
| E: Validation | 4 | [ ] Not Started | Validation complete |
| F: Rollback | 2 | [ ] Not Started | Rollback verified |
| G: Deployment | 6 | [ ] Not Started | Deployment complete |
| H: Post Deployment | 6 | [ ] Not Started | Cleanup complete |
| **Total** | **40 tasks** | **0% Complete** | — |

---

*Checklist generated: 2026-08-05*
*Tag: phase23c-docs*
*Commit: HEAD*
