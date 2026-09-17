# Phase 23D — Rollback Plan

**Repository:** E:\Projects\ESO
**Baseline:** phase23c-docs (tag phase23c-docs)
**Date:** 2026-08-05
**Status:** Implementation Phase — Code Changes Allowed

---

## Rollback Strategy

### 1. Rollback Points

| Point | Tag | Commit | Purpose | When to Use |
|-------|-----|--------|---------|-------------|
| RP-1 | `phase23d-pre-merge` | Before merge | Before any code changes | Any failure before merge |
| RP-2 | `phase23d-post-merge` | After merge | After merge applied | Any failure after merge |
| RP-3 | `phase23d-pre-deploy` | Before deployment | Before deployment files changed | Any failure during deployment |
| RP-4 | `phase23d-post-deploy` | After deployment | After deployment complete | Any failure after deployment |

### 2. Rollback Procedures

#### 2.1 Rollback to RP-1 (Pre-Merge)

**When:** Any failure before merge is applied
**Scope:** Revert all changes
**Note:** If rolling back from post-deployment, additional reverts of manifest.json, sw.js, and docker-compose.yml are required.
**Procedure:**
```bash
# Option 1: Revert merge commit
git revert <merge-commit-hash>

# Option 2: Reset to tag
git reset --hard phase23d-pre-merge

# Verify
npm test
node verify.js
```

**Validation:**
- [ ] All E2E tests pass (80/80)
- [ ] All backend tests pass (253/253)
- [ ] DigiTronics_v5.html restored
- [ ] manifest.json references DigiTronics_v5.html
- [ ] sw.js caches both files
- [ ] docker-compose.yml mounts both files

#### 2.2 Rollback to RP-2 (Post-Merge)

**When:** Any failure after merge but before deployment
**Scope:** Revert merge and deployment files
**Procedure:**
```bash
# Revert merge commit
git revert <merge-commit-hash>

# Verify
npm test
node verify.js
```

**Validation:**
- [ ] All E2E tests pass (80/80)
- [ ] All backend tests pass (253/253)
- [ ] DigiTronics_v5.html restored
- [ ] manifest.json references DigiTronics_v5.html
- [ ] sw.js caches both files
- [ ] docker-compose.yml mounts both files

#### 2.3 Rollback to RP-3 (Pre-Deploy)

**When:** Any failure during deployment
**Scope:** Revert deployment files only
**Procedure:**
```bash
# Revert deployment commits
git revert <deployment-commit-hash>

# Verify
npm test
node verify.js
```

**Validation:**
- [ ] All E2E tests pass (80/80)
- [ ] All backend tests pass (253/253)
- [ ] manifest.json references DigiTronics_v5.html
- [ ] sw.js caches both files
- [ ] docker-compose.yml mounts both files

#### 2.4 Rollback to RP-4 (Post-Deploy)

**When:** Any failure after deployment
**Scope:** Full rollback
**Procedure:**
```bash
# Revert all Phase 23D commits
git revert <merge-commit-hash>..<deployment-commit-hash>

# Force SW update
# Update SW cache name in sw.js

# Verify
npm test
node verify.js
```

**Validation:**
- [ ] All E2E tests pass (80/80)
- [ ] All backend tests pass (253/253)
- [ ] DigiTronics_v5.html restored
- [ ] manifest.json references DigiTronics_v5.html
- [ ] sw.js caches both files
- [ ] docker-compose.yml mounts both files
- [ ] PWA installs correctly
- [ ] Service Worker updates correctly

---

## Rollback Triggers

### Automatic Rollback

| Trigger | Action | Rollback Point |
|---------|--------|----------------|
| E2E tests fail | Stop and rollback | RP-1 or RP-2 |
| Backend tests fail | Stop and rollback | RP-1 or RP-2 |
| PWA installation fails | Stop and rollback | RP-3 or RP-4 |
| Service Worker update fails | Stop and rollback | RP-3 or RP-4 |
| Console errors appear | Stop and rollback | RP-3 or RP-4 |

### Manual Rollback

| Trigger | Action | Rollback Point |
|---------|--------|----------------|
| Feature loss detected | Stop and rollback | RP-1 or RP-2 |
| Visual regression | Stop and rollback | RP-1 or RP-2 |
| Data loss detected | Stop and rollback | RP-1 or RP-2 |
| Performance regression | Stop and rollback | RP-1 or RP-2 |

---

## Rollback Validation

### Before Rollback

- [ ] Identify failure point
- [ ] Select rollback point
- [ ] Document reason for rollback
- [ ] Notify team

### During Rollback

- [ ] Execute rollback procedure
- [ ] Verify git status
- [ ] Verify file integrity

### After Rollback

- [ ] Run all E2E tests (80/80)
- [ ] Run all backend tests (253/253)
- [ ] Verify PWA installation
- [ ] Verify Service Worker update
- [ ] Verify no console errors
- [ ] Document rollback results

---

## Rollback Communication

### Before Rollback

- Notify team of rollback
- Document reason for rollback
- Document rollback point

### During Rollback

- Update team on progress
- Document any issues

### After Rollback

- Document rollback results
- Update risk register
- Plan next steps

---

*Rollback plan generated: 2026-08-05*
*Tag: phase23c-docs*
*Commit: HEAD*
