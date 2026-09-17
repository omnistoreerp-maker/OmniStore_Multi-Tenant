# Phase 23D — Deployment Plan

**Repository:** E:\Projects\ESO
**Baseline:** phase23c-docs (tag phase23c-docs)
**Date:** 2026-08-05
**Status:** Implementation Phase — Code Changes Allowed

---

## Deployment Strategy

### 1. Deployment Sequence

| Step | Action | Files | Validation |
|------|--------|-------|------------|
| 1 | Pre-deployment verification | All | All tests pass |
| 2 | Create rollback point | Git | Tag created |
| 3 | Update manifest.json | manifest.json | start_url updated |
| 4 | Update sw.js | sw.js | Cache list updated |
| 5 | Update docker-compose.yml | docker-compose.yml | Mount removed |
| 6 | Update refreshPwaCache() | index.html:14669 | Reference updated |
| 7 | Commit changes | Git | Commit created |
| 8 | Push to remote | Git | Push successful |
| 9 | Deploy to production | Production | Deployment successful |
| 10 | Post-deployment verification | Production | PWA works |

### 2. Current Versions

| Component | Current Value | Location |
|-----------|---------------|----------|
| Service Worker Cache Name | `omnistore-erp-v44-dashboard-v6-sw-reload-v2` | sw.js |
| PWA Version | `DigiTronics PWA Enterprise v1.0` | index.html:14511, DigiTronics_v5.html:14176 |
| App Version Label | `OmniStore ERP v1.0` | index.html:7026, DigiTronics_v5.html:6917 |
| Cache Name in refreshPwaCache() | `digitronics-pwa-enterprise-v1` | index.html:14668 |

### 3. Version Strategy

| Component | Strategy | Notes |
|-----------|----------|-------|
| Service Worker Cache Name | Bump version suffix | e.g., `-v3` instead of `-v2` |
| PWA Version | Keep as-is | No functional change |
| App Version Label | Keep as-is | No functional change |
| Cache Name in refreshPwaCache() | Update to match SW | Use `omnistore-erp-v44-dashboard-v6-sw-reload-v3` |

### 2. Deployment Files

#### 2.1 manifest.json

**Current State:**
```json
{
  "start_url": "./DigiTronics_v5.html",
  "id": "/DigiTronics_v5.html",
  "shortcuts": [
    { "url": "./DigiTronics_v5.html#pos" },
    { "url": "./DigiTronics_v5.html#serialsearch" }
  ]
}
```

**Target State:**
```json
{
  "start_url": "./index.html",
  "id": "/index.html",
  "shortcuts": [
    { "url": "./index.html#pos" },
    { "url": "./index.html#serialsearch" }
  ]
}
```

**Validation:**
- [ ] start_url updated to index.html
- [ ] id updated to index.html
- [ ] shortcuts updated to index.html
- [ ] PWA installs correctly

#### 2.2 sw.js

**Current State:**
```javascript
const APP_SHELL_ASSETS = [
  './index.html',
  './DigiTronics_v5.html',
  // ... other assets
];
```

**Target State:**
```javascript
const APP_SHELL_ASSETS = [
  './index.html',
  // ... other assets
];
```

**Validation:**
- [ ] DigiTronics_v5.html removed from cache list
- [ ] Cache name bumped
- [ ] Service Worker updates correctly
- [ ] Old caches cleared

#### 2.3 docker-compose.yml

**Current State:**
```yaml
volumes:
  - ./index.html:/usr/share/nginx/html/index.html:ro
  - ./DigiTronics_v5.html:/usr/share/nginx/html/DigiTronics_v5.html:ro
```

**Target State:**
```yaml
volumes:
  - ./index.html:/usr/share/nginx/html/index.html:ro
```

**Validation:**
- [ ] DigiTronics_v5.html mount removed
- [ ] docker-compose up works
- [ ] Application loads correctly

#### 2.4 refreshPwaCache()

**Current State (index.html:14662-14677):**
```javascript
async function refreshPwaCache() {
  pwaHaptic(16);
  if (pwaRegistration) {
    try { await pwaRegistration.update(); } catch (e) {}
  }
  try {
    const cache = await caches.open('digitronics-pwa-enterprise-v1');
    await cache.addAll(['./', 'DigiTronics_v5.html', 'manifest.json', 'icons/digitronics-icon-192.svg', 'icons/digitronics-icon-512.svg']);
    savePwaState({ lastCacheRefresh: new Date().toISOString(), updateAvailable: false });
    logPwaAudit('cache_refresh', 'App shell cache refreshed');
    showToast('✅ تم تحديث كاش التطبيق');
  } catch (error) {
    showToast('تعذر تحديث الكاش الآن', 'error');
  }
  updatePwaStatusUI();
}
```

**Target State:**
```javascript
async function refreshPwaCache() {
  pwaHaptic(16);
  if (pwaRegistration) {
    try { await pwaRegistration.update(); } catch (e) {}
  }
  try {
    const cache = await caches.open('digitronics-pwa-enterprise-v1');
    await cache.addAll(['./', 'index.html', 'manifest.json', 'icons/digitronics-icon-192.svg', 'icons/digitronics-icon-512.svg']);
    savePwaState({ lastCacheRefresh: new Date().toISOString(), updateAvailable: false });
    logPwaAudit('cache_refresh', 'App shell cache refreshed');
    showToast('✅ تم تحديث كاش التطبيق');
  } catch (error) {
    showToast('تعذر تحديث الكاش الآن', 'error');
  }
  updatePwaStatusUI();
}
```

**Change:** Line 14669: `'DigiTronics_v5.html'` → `'index.html'`

**Validation:**
- [ ] Reference updated to index.html
- [ ] Cache refresh works
- [ ] No console errors

---

## Deployment Validation

### Pre-Deployment

- [ ] All E2E tests pass (80/80)
- [ ] All backend tests pass (253/253)
- [ ] Rollback point created
- [ ] Deployment files identified

### During Deployment

- [ ] manifest.json updated
- [ ] sw.js updated
- [ ] docker-compose.yml updated
- [ ] refreshPwaCache() updated
- [ ] Changes committed
- [ ] Changes pushed

### Post-Deployment

- [ ] PWA installs correctly
- [ ] Service Worker updates correctly
- [ ] No console errors
- [ ] All CRUD operations work
- [ ] Offline mode works
- [ ] No visual regression

---

## Deployment Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| PWA users cached old manifest | HIGH | Force SW update, cache name bump |
| Service Worker cache invalidation | MEDIUM | Update SW cache names, force refresh |
| docker-compose.yml errors | LOW | Test docker-compose up |
| nginx configuration errors | LOW | Test nginx configuration |

---

## Deployment Rollback

### Rollback Procedure

1. **Identify failure point** — Which step failed?
2. **Select rollback point** — Which tag to revert to?
3. **Execute rollback** — `git revert <commit>` or `git reset --hard <tag>`
4. **Verify rollback** — Run E2E tests to confirm
5. **Document rollback** — Record what happened and why

### Rollback Validation

- [ ] All E2E tests pass (80/80)
- [ ] All backend tests pass (253/253)
- [ ] PWA installs correctly
- [ ] Service Worker updates correctly
- [ ] No console errors

---

## Deployment Communication

### Before Deployment

- Notify team of deployment
- Document deployment plan
- Create rollback point

### During Deployment

- Update team on progress
- Document any issues

### After Deployment

- Document deployment results
- Monitor for issues
- Update documentation

---

*Deployment plan generated: 2026-08-05*
*Tag: phase23c-docs*
*Commit: HEAD*
