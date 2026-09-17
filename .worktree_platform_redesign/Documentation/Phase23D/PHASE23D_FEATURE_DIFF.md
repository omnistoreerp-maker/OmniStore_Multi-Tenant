# Phase 23D — Feature Diff Analysis

**Repository:** E:\Projects\ESO
**Baseline:** phase23c-docs (tag phase23c-docs)
**Date:** 2026-08-05
**Status:** Implementation Phase — Code Changes Allowed

---

## Executive Summary

This document provides a detailed feature-by-feature comparison of `index.html` and `DigiTronics_v5.html`. The analysis reveals that `index.html` is the **evolved production version** with significant improvements, while `DigiTronics_v5.html` is the **legacy version** that retains some older features.

---

## 1. Line Count Analysis

| File | Total Lines | Unique Lines | Shared Lines |
|------|-------------|--------------|--------------|
| `index.html` | 40,288 | 1,440 | 38,848 |
| `DigiTronics_v5.html` | 39,903 | 1,055 | 38,848 |
| **Drift** | **385** | **2,495** | — |

---

## 2. Feature Comparison

### 2.1 Dashboard Architecture

| Feature | index.html (V6) | DigiTronics_v5.html (V3) | Decision |
|---------|-----------------|--------------------------|----------|
| Dashboard version | V6 Enterprise | V3 | Keep V6 |
| CSS namespace | `.d6-*` classes | Standard classes | Keep V6 |
| KPI cards | Spark bars, trends, mini-charts | Standard stat-cards | Keep V6 |
| Chart grid | 3 canvases (Sales, Revenue, Inventory) | Single sales chart | Keep V6 |
| Module grid | Interactive tiles | None | Keep V6 |
| Activity timeline | Yes | None | Keep V6 |
| FAB menu | Yes | None | Keep V6 |
| Widget row | Smart alerts, Top products, Top customers, Tasks | None | Keep V6 |
| Header | Global search, Clock, Connection status, User profile | Basic header | Keep V6 |
| Skeleton loading | Yes | None | Keep V6 |

**Decision:** Dashboard V6 is production-quality. Do NOT port Dashboard V3.

### 2.2 Performance Layer

| Feature | index.html | DigiTronics_v5.html | Decision |
|---------|-----------|---------------------|----------|
| `computeStockMap()` | Yes | No | Keep in index.html |
| `getStockMap()` | Yes | No | Keep in index.html |
| `__stockCache` | Yes | No | Keep in index.html |
| `__netTotalCache` | Yes | No | Keep in index.html |
| `scheduleRender()` | Yes | No | Keep in index.html |
| `broadcastDbChanged()` | Yes | No | Keep in index.html |
| `eqId()` | Yes | No | Keep in index.html |
| `dbWriteLock` | Yes | No | Keep in index.html |
| `releaseDbWriteLock()` | Yes | No | Keep in index.html |
| `__idbGet` / `__idbSet` | Yes | No | Keep in index.html |

**Decision:** Performance layer is critical. Keep in index.html. Do NOT remove.

### 2.3 Data Safety

| Feature | index.html | DigiTronics_v5.html | Decision |
|---------|-----------|---------------------|----------|
| IndexedDB fallback | Yes | No | Keep in index.html |
| `restoreFromIDBIfNeeded()` | Yes | No | Keep in index.html |
| `saveDB()` with IndexedDB | Yes | No | Keep in index.html |
| Quota handling | Graceful degradation | None | Keep in index.html |

**Decision:** IndexedDB fallback is critical for data safety. Keep in index.html. Do NOT remove.

### 2.4 Demo Safety

| Feature | index.html | DigiTronics_v5.html | Decision |
|---------|-----------|---------------------|----------|
| Demo safety badges | No | Yes | Do NOT port |
| `.demo-safety-badge` CSS | No | Yes | Do NOT port |
| "Preview Only" overlay | No | Yes | Do NOT port |

**Decision:** Demo safety badges were intentionally removed in production. Do NOT port.

### 2.5 Backend Integration

| Feature | index.html | DigiTronics_v5.html | Decision |
|---------|-----------|---------------------|----------|
| USE_BACKEND references | 233 | 228 | Keep index.html |
| Supplier balance migration | **Yes (line 38315)** | Yes (line 37966) | **ALREADY EXISTS** |
| `reconcileMissingCashPurchaseEntries()` | **Yes (line 19071)** | Yes (line 18740) | **ALREADY EXISTS** |

**CRITICAL FINDING:** Both supplier migration and `reconcileMissingCashPurchaseEntries()` ALREADY EXIST in `index.html`. No porting required.

**Evidence:**
- `reconcileMissingCashPurchaseEntries()` — `index.html:19071` (definition), `DigiTronics_v5.html:18740` (definition)
- `supplierBalanceMigrated` — `index.html:38318` (check), `DigiTronics_v5.html:37969` (check)
- `getMissingCashPurchaseEntries()` — `index.html:19053` (definition), `DigiTronics_v5.html:18722` (definition)

**Decision:** No porting needed. Both functions are already present and active in index.html.

---

## 3. Merge Strategy

### 3.1 Base File

**Use `index.html` as the base file.** It contains:
- Dashboard V6 Enterprise (production UI)
- Performance optimization layer
- IndexedDB fallback (data safety)
- All Phase 23B migrations
- Supplier balance migration (line 38315)
- `reconcileMissingCashPurchaseEntries()` (line 19071)

### 3.2 Features to Port FROM DigiTronics_v5.html

**NONE REQUIRED.** Both functions already exist in index.html:
- Supplier balance migration — `index.html:38315-38332`
- `reconcileMissingCashPurchaseEntries()` — `index.html:19071-19132`

### 3.3 Features to NOT Port

| Feature | Reason |
|---------|--------|
| Dashboard V3 | Replaced by V6 |
| Demo safety badges | Intentionally removed |
| Dashboard V3 CSS | Replaced by V6 CSS |
| Supplier migration | Already exists in index.html |
| `reconcileMissingCashPurchaseEntries()` | Already exists in index.html |

### 3.4 Simplified Implementation

Since no porting is required, Phase 23D is simplified to:
1. Update manifest.json (start_url → index.html)
2. Update sw.js (remove DigiTronics_v5.html from cache)
3. Update docker-compose.yml (remove DigiTronics_v5.html mount)
4. Update refreshPwaCache() (change 'DigiTronics_v5.html' to 'index.html' in cache.addAll)
5. Archive DigiTronics_v5.html
6. Clean up backup files

---

## 4. Merge Validation

### 4.1 Pre-Merge Validation

- [ ] Feature diff documented
- [ ] Merge strategy approved
- [ ] Rollback point created
- [ ] Baseline tests pass

### 4.2 Post-Merge Validation

- [ ] Dashboard V6 intact
- [ ] Performance layer intact
- [ ] IndexedDB fallback intact
- [ ] Supplier migration intact (line 38315)
- [ ] `reconcileMissingCashPurchaseEntries()` intact (line 19071)
- [ ] Demo safety badges NOT present
- [ ] All E2E tests pass (80/80)
- [ ] All backend tests pass (253/253)
- [ ] No console errors
- [ ] No visual regression

---

## 5. Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Supplier migration lost | ~~MEDIUM~~ | ~~MEDIUM~~ | **N/A — Already exists in index.html** |
| `reconcileMissingCashPurchaseEntries()` lost | ~~MEDIUM~~ | ~~MEDIUM~~ | **N/A — Already exists in index.html** |
| Dashboard V6 regression | HIGH | LOW | Visual regression testing |
| Performance layer regression | HIGH | LOW | Verify functions intact |
| IndexedDB fallback regression | HIGH | LOW | Verify fallback works |
| manifest.json references wrong file | HIGH | HIGH | Update start_url, id, shortcuts |
| sw.js caches wrong files | MEDIUM | HIGH | Update cache list |
| docker-compose.yml mounts wrong files | LOW | HIGH | Remove DigiTronics_v5.html mount |

---

*Feature diff generated: 2026-08-05*
*Tag: phase23c-docs*
*Commit: HEAD*
