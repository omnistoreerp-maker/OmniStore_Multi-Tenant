# Phase 23D — Master Prompt (Redesigned)

**Repository:** E:\Projects\ESO
**Baseline:** phase23c-docs (tag phase23c-docs)
**Date:** 2026-08-05
**Status:** Implementation Phase — Code Changes Allowed

---

## Context

Phase 23C (Architecture & Technical Debt Assessment) is **100% complete**. All architecture documentation, technical debt inventory, security architecture, and design decision records are complete and approved.

Phase 23D is an **Implementation Phase**. Code changes are allowed. HTML consolidation is the primary objective.

**Critical Finding:** The current Phase23D documents contain **incorrect assumptions** about the HTML files. `index.html` is the evolved production version with Dashboard V6, performance layer, and IndexedDB fallback. `DigiTronics_v5.html` is the legacy version with Dashboard V3. A simple merge is NOT possible.

---

## What to Do

### Phase A: Preparation

1. Create git tag `phase23d-pre-merge`
2. Run all E2E tests to establish baseline
3. Run all backend tests to establish baseline
4. Document unique features in both HTML files

### Phase B: Verification

5. Verify risk register complete
6. Verify rollback plan complete
7. Verify deployment plan complete
8. Verify test plan complete
9. Verify test baseline established

### Phase C: Dry Run

10. Create branch `phase23d-dry-run`
11. Port supplier migration from DigiTronics_v5.html
12. Port `reconcileMissingCashPurchaseEntries()` from DigiTronics_v5.html
13. Run all E2E tests on branch
14. Run all backend tests on branch
15. Visual regression testing on branch

### Phase D: Merge

16. Switch to main branch
17. Port supplier migration from DigiTronics_v5.html
18. Port `reconcileMissingCashPurchaseEntries()` from DigiTronics_v5.html
19. Run all E2E tests on main
20. Run all backend tests on main
21. Commit merge

### Phase E: Validation

22. Run all E2E tests (80/80)
23. Run all backend tests (253/253)
24. Manual testing (PWA, SW, CRUD, offline)
25. Visual regression testing
26. Performance validation

### Phase F: Rollback

27. Create git tag `phase23d-post-merge`
28. Verify rollback procedure

### Phase G: Deployment

29. Update manifest.json (start_url → index.html)
30. Update sw.js (remove DigiTronics_v5.html)
31. Update docker-compose.yml (remove DigiTronics_v5.html mount)
32. Update refreshPwaCache() (reference → index.html)
33. Commit deployment
34. Deploy to production

### Phase H: Post Deployment

35. Monitor error logs
36. Archive DigiTronics_v5.html
37. Remove .bak files
38. Add test-results/ to .gitignore
39. Force Service Worker update
40. Final commit

---

## What NOT to Do

### Safety Rules

- **NEVER** delete files without verification
- **NEVER** merge before comparison
- **NEVER** modify deployment files before validation
- **NEVER** change Service Worker before cache migration
- **NEVER** change manifest before PWA verification
- **NEVER** archive files before Git tags
- **NEVER** commit broken code
- **NEVER** push without passing every validation
- **NEVER** skip rollback creation
- **NEVER** skip dry-run comparison

### Implementation Rules

- Do NOT modify backend code
- Do NOT add new features
- Do NOT refactor code
- Do NOT change business logic
- Do NOT modify security settings (Phase 23F)
- Do NOT optimize performance (Phase 23F)
- Do NOT skip validation steps
- Do NOT merge without git tag
- Do NOT deploy without rollback point
- Do NOT cleanup without archiving

### File Rules

- Do NOT delete DigiTronics_v5.html without archiving
- Do NOT remove .bak files without git rm
- Do NOT modify manifest.json without PWA testing
- Do NOT modify sw.js without cache migration
- Do NOT modify docker-compose.yml without testing

---

## Validation

### After Each Phase

- Verify all tests pass
- Verify no regression
- Verify no console errors
- Verify PWA functionality

### After Each Task

- Verify task complete
- Verify no side effects
- Verify no broken dependencies
- Verify rollback available

### Before Each Gate

- Verify all phase tasks complete
- Verify all validation passed
- Verify rollback point created
- Verify documentation updated

---

## Completion Criteria

### Phase A Gate

- [ ] Git tag `phase23d-pre-merge` created
- [ ] Baseline tests pass (80/80 E2E, 253/253 backend)
- [ ] Feature diff documented

### Phase B Gate

- [ ] Risk register approved
- [ ] Rollback plan approved
- [ ] Deployment plan approved
- [ ] Test plan approved

### Phase C Gate

- [ ] Branch `phase23d-dry-run` created
- [ ] Merge validated on branch
- [ ] All tests pass on branch
- [ ] No visual regression

### Phase D Gate

- [ ] Merge applied to main
- [ ] All tests pass on main
- [ ] Commit created

### Phase E Gate

- [ ] All E2E tests pass (80/80)
- [ ] All backend tests pass (253/253)
- [ ] Manual testing complete
- [ ] Visual regression testing complete
- [ ] Performance validation complete

### Phase F Gate

- [ ] Git tag `phase23d-post-merge` created
- [ ] Rollback procedure verified

### Phase G Gate

- [ ] manifest.json updated
- [ ] sw.js updated
- [ ] docker-compose.yml updated
- [ ] refreshPwaCache() updated
- [ ] Deployment successful
- [ ] PWA works

### Phase H Gate

- [ ] No issues detected
- [ ] DigiTronics_v5.html archived
- [ ] .bak files removed
- [ ] test-results/ ignored
- [ ] Service Worker updated
- [ ] Cleanup committed

---

## References

- Investigation Report: `E:\Projects\ESO\Documentation\Phase23D\PHASE23D_INVESTIGATION_REPORT.md`
- Roadmap: `E:\Projects\ESO\Documentation\Phase23D\PHASE23D_ROADMAP.md`
- Checklist: `E:\Projects\ESO\Documentation\Phase23D\PHASE23D_CHECKLIST.md`
- Implementation Strategy: `E:\Projects\ESO\Documentation\Phase23D\PHASE23D_IMPLEMENTATION_STRATEGY.md`
- Risk Register: `E:\Projects\ESO\Documentation\Phase23D\PHASE23D_RISK_REGISTER.md`
- Rollback Plan: `E:\Projects\ESO\Documentation\Phase23D\PHASE23D_ROLLBACK_PLAN.md`
- Deployment Plan: `E:\Projects\ESO\Documentation\Phase23D\PHASE23D_DEPLOYMENT_PLAN.md`
- Test Plan: `E:\Projects\ESO\Documentation\Phase23D\PHASE23D_TEST_PLAN.md`
- Feature Diff: `E:\Projects\ESO\Documentation\Phase23D\PHASE23D_FEATURE_DIFF.md`
- File Matrix: `E:\Projects\ESO\Documentation\Phase23D\PHASE23D_FILE_MATRIX.md`
- Phase 23C Tag: phase23c-docs
- Phase 23C Architecture: `E:\Projects\ESO\Documentation\Phase23C\ARCHITECTURE_INDEX.md`
- Phase 23C ADRs: `E:\Projects\ESO\Documentation\Phase23C\ARCHITECTURE_DECISIONS.md`

---

*Master prompt generated: 2026-08-05*
*Tag: phase23c-docs*
*Commit: HEAD*
