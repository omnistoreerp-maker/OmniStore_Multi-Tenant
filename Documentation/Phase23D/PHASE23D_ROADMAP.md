# Phase 23D — Roadmap (Redesigned)

**Repository:** E:\Projects\ESO
**Baseline:** phase23c-docs (tag phase23c-docs)
**Date:** 2026-08-05
**Status:** Implementation Phase — Code Changes Allowed

---

## Project State

| Item | Value |
|------|-------|
| Current Stable Tag | phase23c-docs |
| Current HEAD | HEAD |
| Repository State | Stable |
| Implementation Frozen | Phase23D |
| Planning only | Implementation NOT started |

---

## Phase Structure

| Phase | Name | Focus |
|-------|------|-------|
| **23C** | Architecture & Technical Debt Assessment | Architecture, documentation, design decisions |
| **23D** | HTML Consolidation | Merge HTML files, update manifest/SW |
| **23E** | Legacy Cleanup | Deprecate → Archive → Delete |
| **23F** | Performance & Optimization | Benchmark first, then optimize |

---

## Phase 23D — HTML Consolidation (Redesigned)

### Objectives

1. Establish `index.html` as the single canonical entry point
2. ~~Port missing features from `DigiTronics_v5.html` into `index.html`~~ **NOT REQUIRED — Both functions already exist**
3. Update all references (manifest.json, Service Worker, docker-compose.yml)
4. Archive or remove `DigiTronics_v5.html`
5. Clean up backup files and repository clutter

### Scope

**Included:**
- ~~Feature porting (supplier migration, reconciliation function)~~ **NOT REQUIRED**
- manifest.json update (start_url, id, shortcuts → index.html)
- Service Worker update (cache list)
- docker-compose.yml update (remove DigiTronics_v5.html mount)
- refreshPwaCache() update (HTML reference at line 14669)
- Backup file archival
- .bak file removal
- Validation (E2E tests, manual testing, visual regression)
- nginx.conf monitoring (no changes required)

**Excluded:**
- Security hardening (Phase 23F)
- Performance optimization (Phase 23F)
- Code refactoring
- Backend changes
- New features
- Dashboard V3 (replaced by V6)
- Demo safety badges (intentionally removed)
- nginx.conf changes (monitor only — default root points to index.html)

### nginx.conf Monitoring

**Status:** Monitor Only — No Migration Required

**Validation:**
- [ ] Confirm default root points to index.html
- [ ] No reference to DigiTronics_v5.html in nginx.conf
- [ ] No migration required

### Dependencies

- Phase 23C architecture documentation — **MET**
- Phase 23C tag (phase23c-docs) — **MET**

### Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feature loss during merge | HIGH | Dry run on branch, feature verification, rollback point |
| PWA users cached old manifest | HIGH | Force SW update, cache name bump, version increment |
| Service Worker cache invalidation | MEDIUM | Update SW cache names, force refresh, version bump |
| Dashboard regression | HIGH | Visual regression testing, Dashboard V6 verification |
| Data loss (IndexedDB fallback) | HIGH | Verify IndexedDB fallback intact, test data persistence |
| Rollback complexity | MEDIUM | Git tag before merge, clear procedure, test rollback |

### Rollback

- Create git tag `phase23d-pre-merge` before merge
- Rollback command: `git revert <merge-commit>` or `git reset --hard phase23d-pre-merge`
- Verify rollback with E2E tests

### Validation

- Run all 80 E2E tests (`verify.js`)
- Run all 253 backend tests
- Test PWA installation
- Test Service Worker update
- Test all CRUD operations
- Test offline mode
- Visual regression testing
- Performance validation
- Verify no console errors

### Completion Criteria

- [ ] Single HTML file (`index.html`) as canonical entry point
- [ ] `manifest.json` references `index.html`
- [ ] Service Worker caches only `index.html`
- [ ] All E2E tests pass (80/80)
- [ ] All backend tests pass (253/253)
- [ ] No regression in functionality
- [ ] Backup files archived
- [ ] `.bak` files removed
- [ ] Rollback procedure verified

---

## Implementation Phases

### Phase A: Preparation

**Goal:** Establish baseline and create rollback point
**Inputs:** Phase 23C documentation, current repository state
**Outputs:** Git tag, baseline test results
**Preconditions:** Phase 23C complete, all tests passing

| # | Task | Justification (Investigation Report) | Validation | Rollback |
|---|------|--------------------------------------|------------|----------|
| 1 | Create git tag `phase23d-pre-merge` | Section 7: Rollback strategy | Tag exists | Delete tag |
| 2 | Run all E2E tests (baseline) | Section 6.1: Automated testing | 80/80 pass | None |
| 3 | Run all backend tests (baseline) | Section 6.1: Automated testing | 253/253 pass | None |
| 4 | Document unique features | Section 1.2: Feature comparison | Feature diff complete | None |

**Gate:** All tasks complete, baseline established, feature diff approved

### Phase B: Verification

**Goal:** Verify risks and test baseline
**Inputs:** Feature diff, risk assessment
**Outputs:** Verified risks, test baseline
**Preconditions:** Phase A complete

| # | Task | Justification (Investigation Report) | Validation | Rollback |
|---|------|--------------------------------------|------------|----------|
| 5 | Verify risk register complete | Section 3: Risk assessment | All risks documented | None |
| 6 | Verify rollback plan complete | Section 7: Rollback strategy | Plan approved | None |
| 7 | Verify deployment plan complete | Section 5: Migration order | Plan approved | None |
| 8 | Verify test plan complete | Section 6: Validation strategy | Plan approved | None |
| 9 | Verify test baseline | Section 6.1: Automated testing | Baseline verified | None |

**Gate:** All risks verified, test baseline established

### Phase C: Dry Run

**Goal:** Test merge on branch before applying to main
**Inputs:** Feature diff, merge strategy
**Outputs:** Validated merge on branch
**Preconditions:** Phase B complete

| # | Task | Justification (Investigation Report) | Validation | Rollback |
|---|------|--------------------------------------|------------|----------|
| 10 | Create branch `phase23d-dry-run` | Section 5: Migration order | Branch exists | Delete branch |
| 11 | Port supplier migration | Section 1.2: Feature comparison | Function ported | `git checkout -- index.html` |
| 12 | Port `reconcileMissingCashPurchaseEntries()` | Section 1.2: Feature comparison | Function ported | `git checkout -- index.html` |
| 13 | Run all E2E tests on branch | Section 6.1: Automated testing | 80/80 pass | Delete branch |
| 14 | Run all backend tests on branch | Section 6.1: Automated testing | 253/253 pass | Delete branch |
| 15 | Visual regression on branch | Section 6.2: Manual testing | No regression | Delete branch |

**Gate:** Merge validated on branch, all tests pass, no visual regression

### Phase D: Merge

**Goal:** Apply merge to main
**Inputs:** Validated merge from dry run
**Outputs:** Merged index.html
**Preconditions:** Phase C complete

| # | Task | Justification (Investigation Report) | Validation | Rollback |
|---|------|--------------------------------------|------------|----------|
| 16 | Switch to main branch | Section 5: Migration order | Main branch clean | None |
| 17 | Port supplier migration | Section 1.2: Feature comparison | Function ported | `git checkout -- index.html` |
| 18 | Port `reconcileMissingCashPurchaseEntries()` | Section 1.2: Feature comparison | Function ported | `git checkout -- index.html` |
| 19 | Run all E2E tests on main | Section 6.1: Automated testing | 80/80 pass | `git checkout -- index.html` |
| 20 | Run all backend tests on main | Section 6.1: Automated testing | 253/253 pass | `git checkout -- index.html` |
| 21 | Commit merge | Section 5: Migration order | Commit created | `git reset HEAD~1` |

**Gate:** Merge applied to main, all tests pass, commit created

### Phase E: Validation

**Goal:** Final validation before deployment
**Inputs:** Merged code
**Outputs:** Validation results
**Preconditions:** Phase D complete

| # | Task | Justification (Investigation Report) | Validation | Rollback |
|---|------|--------------------------------------|------------|----------|
| 22 | Run all E2E tests (final) | Section 6.1: Automated testing | 80/80 pass | `git revert <commit>` |
| 23 | Run all backend tests (final) | Section 6.1: Automated testing | 253/253 pass | `git revert <commit>` |
| 24 | Manual testing (PWA, SW, CRUD, offline) | Section 6.2: Manual testing | All pass | `git revert <commit>` |
| 25 | Visual regression testing | Section 6.2: Manual testing | No regression | `git revert <commit>` |
| 26 | Performance validation | Section 6.2: Manual testing | Performance intact | `git revert <commit>` |

**Gate:** All validation complete, no regression

### Phase F: Rollback

**Goal:** Create rollback point and verify procedure
**Inputs:** Validated merge
**Outputs:** Rollback point, verified procedure
**Preconditions:** Phase E complete

| # | Task | Justification (Investigation Report) | Validation | Rollback |
|---|------|--------------------------------------|------------|----------|
| 27 | Create git tag `phase23d-post-merge` | Section 7: Rollback strategy | Tag exists | Delete tag |
| 28 | Verify rollback procedure | Section 7: Rollback strategy | Procedure works | None |

**Gate:** Rollback point created, procedure verified

### Phase G: Deployment

**Goal:** Update deployment files and deploy
**Inputs:** Validated merge
**Outputs:** Updated deployment files
**Preconditions:** Phase F complete

| # | Task | Justification (Investigation Report) | Validation | Rollback |
|---|------|--------------------------------------|------------|----------|
| 29 | Update manifest.json | Section 1.5: References | start_url updated | `git checkout -- manifest.json` |
| 30 | Update sw.js | Section 1.5: References | Cache list updated | `git checkout -- sw.js` |
| 31 | Update docker-compose.yml | Section 1.5: References | Mount removed | `git checkout -- docker-compose.yml` |
| 32 | Update refreshPwaCache() | Section 1.5: References | Reference updated | `git checkout -- index.html` |
| 33 | Commit deployment | Section 5: Migration order | Commit created | `git reset HEAD~1` |
| 34 | Deploy to production | Section 5: Migration order | Deployment successful | `git revert <commit>` |

**Gate:** Deployment complete, PWA works

### Phase H: Post Deployment

**Goal:** Verify deployment and cleanup
**Inputs:** Deployed code
**Outputs:** Verified deployment, cleaned repository
**Preconditions:** Phase G complete

| # | Task | Justification (Investigation Report) | Validation | Rollback |
|---|------|--------------------------------------|------------|----------|
| 35 | Monitor error logs | Section 6.2: Manual testing | No issues | `git revert <commit>` |
| 36 | Archive DigiTronics_v5.html | Section 1.6: Backup files | File archived | Restore from archive |
| 37 | Remove .bak files | Section 1.6: Backup files | Files removed | Restore from git |
| 38 | Add test-results/ to .gitignore | Section 1.6: Backup files | Entry added | Remove from .gitignore |
| 39 | Force Service Worker update | Section 9.3: Post-merge | SW updated | Restore cache name |
| 40 | Final commit | Section 5: Migration order | Commit created | `git revert <commit>` |

**Gate:** Deployment verified, cleanup complete

---

## Phase Dependencies

```
Phase 23B (Backend Migration) [COMPLETE]
    ↓
Phase 23C (Architecture & Technical Debt Assessment) [COMPLETE]
    ↓
Phase 23D (HTML Consolidation)
    ↓
Phase 23E (Legacy Cleanup)
    ↓
Phase 23F (Performance & Optimization)
```

---

## Effort Estimates

| Phase | Effort | Risk |
|-------|--------|------|
| 23C | 2-3 days | Low |
| 23D | 3-5 days | Medium |
| 23E | 1-2 days | Low |
| 23F | 3-5 days | Low |
| **Total** | **9-15 days** | — |

---

## Success Criteria

### Phase 23C
- Architecture documented
- Debt inventory complete
- Target architecture designed
- All work traced to investigation report

### Phase 23D
- Single HTML file entry point
- All references updated
- No regression
- Rollback procedure verified

### Phase 23E
- Deprecated code removed
- Backup files archived
- Repository clean

### Phase 23F
- Benchmarks established
- Optimizations justified by measurement
- Performance improved

---

*Roadmap generated: 2026-08-05*
*Tag: phase23c-docs*
*Commit: HEAD*
