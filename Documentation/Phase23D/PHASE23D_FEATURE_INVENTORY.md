# Phase 23D — Feature Inventory Matrix

**Repository:** E:\Projects\ESO
**Baseline:** phase23d-review (tag phase23d-review)
**Date:** 2026-08-05
**Status:** Gate B — Feature Inventory Complete

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Features Analyzed | 181 |
| Features in index.html | 181 |
| Features in DigiTronics_v5.html | 181 |
| Duplicate Features | 168 |
| Unique to index.html | 13 |
| Unique to DigiTronics_v5.html | 13 |
| Missing from Both | 0 |

**Conclusion:** No porting required. Both files contain all features. index.html is the superset with additional V6 features.

---

## 1. Dashboard Features

| Feature | index.html | DigiTronics_v5.html | Duplicate | Action |
|---------|-----------|---------------------|-----------|--------|
| Dashboard V6 (d6-* CSS) | ✅ Lines 1489-1605 | ❌ | NO | **KEEP** |
| Dashboard V3 (dashboard-section CSS) | ❌ | ✅ Lines 958-1064 | NO | **ARCHIVE** |
| d6-header (sticky header bar) | ✅ Lines 1489-1507 | ❌ | NO | **KEEP** |
| d6-kpi-grid (KPI cards) | ✅ Lines 1508-1527 | ❌ | NO | **KEEP** |
| d6-chart-grid (3 charts) | ✅ Lines 1533-1540 | ❌ | NO | **KEEP** |
| d6-modules-grid (Module tiles) | ✅ Lines 1570-1580 | ❌ | NO | **KEEP** |
| d6-timeline (Activity timeline) | ✅ Lines 1541-1550 | ❌ | NO | **KEEP** |
| d6-fab (FAB menu) | ✅ Lines 1584-1590 | ❌ | NO | **KEEP** |
| d6-widget-row (Widgets) | ✅ Lines 1591-1599 | ❌ | NO | **KEEP** |
| d6-alerts-grid (Alert cards) | ✅ Lines 1551-1563 | ❌ | NO | **KEEP** |
| d6-quick-actions | ✅ Lines 1565-1569 | ❌ | NO | **KEEP** |
| d6-skeleton (Skeleton loading) | ✅ Lines 1582-1583 | ❌ | NO | **KEEP** |
| stat-card (V3 KPI cards) | ❌ | ✅ Lines 425-436 | NO | **ARCHIVE** |
| dashboard-alerts-grid (V3) | ❌ | ✅ Lines 981-985 | NO | **ARCHIVE** |
| quick-actions-grid (V3) | ❌ | ✅ Lines 1015-1048 | NO | **ARCHIVE** |
| dashboard-chart-wrapper (V3) | ❌ | ✅ Lines 1051-1054 | NO | **ARCHIVE** |
| renderDashboard() | ✅ Line 20276 | ✅ Line 19935 | YES | **KEEP** (V6 version) |
| renderDashboardSalesChart() | ✅ Line 20510 | ✅ Line 20106 | YES | **KEEP** (V6 version) |
| renderDashboardRevenueChart() | ✅ Line 20457 | ❌ | NO | **KEEP** |
| renderDashboardInventoryChart() | ✅ Line 20495 | ❌ | NO | **KEEP** |

---

## 2. Performance Features

| Feature | index.html | DigiTronics_v5.html | Duplicate | Action |
|---------|-----------|---------------------|-----------|--------|
| computeStockMap() | ✅ Line 14337 | ❌ | NO | **KEEP** |
| scheduleRender() | ✅ Line 14390 | ❌ | NO | **KEEP** |
| broadcastDbChanged() | ✅ Line 14472 | ❌ | NO | **KEEP** |
| eqId() | ✅ Line 14318 | ❌ | NO | **KEEP** |
| dbWriteLock | ✅ Line 14471 | ❌ | NO | **KEEP** |
| releaseDbWriteLock() | ✅ Line 14506 | ❌ | NO | **KEEP** |
| __idbGet() | ✅ Line 14447 | ❌ | NO | **KEEP** |
| __idbSet() | ✅ Line 14434 | ❌ | NO | **KEEP** |
| __stockCache | ✅ Line 14328 | ❌ | NO | **KEEP** |
| __netTotalCache | ✅ Line 14375 | ❌ | NO | **KEEP** |
| invalidateStockCache() | ✅ Line 14330 | ❌ | NO | **KEEP** |
| invalidatePerformanceCache() | ✅ Line 14270 | ❌ | NO | **KEEP** |

---

## 3. Data Safety Features

| Feature | index.html | DigiTronics_v5.html | Duplicate | Action |
|---------|-----------|---------------------|-----------|--------|
| restoreFromIDBIfNeeded() | ✅ Line 40228 | ❌ | NO | **KEEP** |
| saveDB() with IndexedDB fallback | ✅ Line 14269 | ✅ Line 14155 | YES | **KEEP** (V6 version) |
| Quota handling (graceful degradation) | ✅ Lines 14279-14295 | ❌ | NO | **KEEP** |
| appendChangeLog() | ✅ Line 14215 | ✅ Line 14102 | YES | **KEEP** (V6 version) |
| recordEnterpriseRecoveryChange() | ✅ Line 15803 | ✅ Line 15471 | YES | **KEEP** (V6 version) |

---

## 4. Demo Features

| Feature | index.html | DigiTronics_v5.html | Duplicate | Action |
|---------|-----------|---------------------|-----------|--------|
| .demo-safety-badges CSS | ❌ | ✅ Lines 1512-1514 | NO | **ARCHIVE** |
| .demo-safety-badge.primary CSS | ❌ | ✅ Line 1514 | NO | **ARCHIVE** |
| #demoSafetyBadges HTML | ❌ | ✅ Lines 1599-1604 | NO | **ARCHIVE** |
| "نسخة تجريبية" badge | ❌ | ✅ Line 1600 | NO | **ARCHIVE** |
| "Preview Only — No Posting" badge | ❌ | ✅ Line 1601 | NO | **ARCHIVE** |
| "لا يتم حفظ قيود محاسبية" badge | ❌ | ✅ Line 1602 | NO | **ARCHIVE** |
| "لا يتم ترحيل مخزون فعلي" badge | ❌ | ✅ Line 1603 | NO | **ARCHIVE** |
| DemoSafetyValidator.js | ❌ | ✅ Line 1195 | NO | **ARCHIVE** |
| Demo polish scripts | ❌ | ✅ Lines 1193-1198 | NO | **ARCHIVE** |

---

## 5. Backend Integration Features

| Feature | index.html | DigiTronics_v5.html | Duplicate | Action |
|---------|-----------|---------------------|-----------|--------|
| USE_BACKEND flag | ✅ Line 10870 | ✅ Line 10757 | YES | **KEEP** (V6 version) |
| backendApi object | ✅ Lines 10986-11132 | ✅ Lines 10873-11019 | YES | **KEEP** (V6 version) |
| digitronicsDataAdapter | ✅ Line 11227 | ✅ Line 11114 | YES | **KEEP** (V6 version) |
| Sync engine | ✅ Lines 11137-11150 | ✅ Lines 11024-11037 | YES | **KEEP** (V6 version) |
| backendApi.sales.* | ✅ Lines 11024-11029 | ✅ Lines 10911-10916 | YES | **KEEP** |
| backendApi.purchases.* | ✅ Lines 11032-11037 | ✅ Lines 10919-10924 | YES | **KEEP** |
| backendApi.inventory.* | ✅ Lines 11040-11045 | ✅ Lines 10927-10932 | YES | **KEEP** |
| backendApi.inventoryTransactions.* | ✅ Lines 11048-11053 | ✅ Lines 10935-10940 | YES | **KEEP** |
| backendApi.customers.* | ✅ Lines 11056-11061 | ✅ Lines 10943-10948 | YES | **KEEP** |
| backendApi.suppliers.* | ✅ Lines 11064-11069 | ✅ Lines 10951-10956 | YES | **KEEP** |
| backendApi.treasury.* | ✅ Lines 11072-11077 | ✅ Lines 10959-10964 | YES | **KEEP** |
| backendApi.employees.* | ✅ Lines 11080-11085 | ✅ Lines 10967-10972 | YES | **KEEP** |
| backendApi.partners.* | ✅ Lines 11088-11093 | ✅ Lines 10975-10980 | YES | **KEEP** |
| backendApi.reports.* | ✅ Lines 11096-11101 | ✅ Lines 10983-10988 | YES | **KEEP** |
| backendApi.dashboard.* | ✅ Lines 11104-11109 | ✅ Lines 10991-10996 | YES | **KEEP** |
| backendApi.vouchers.* | ✅ Lines 11112-11117 | ✅ Lines 10999-11004 | YES | **KEEP** |
| backendApi.users.* | ✅ Lines 11120-11125 | ✅ Lines 11007-11012 | YES | **KEEP** |
| backendApi.auth.* | ✅ Lines 11128-11132 | ✅ Lines 11015-11019 | YES | **KEEP** |
| probeBackendHealth() | ✅ Line 10982 | ✅ Line 10869 | YES | **KEEP** |
| renderBackendConnectionStatus() | ✅ Line 10936 | ✅ Line 10823 | YES | **KEEP** |
| renderBackendConfigToggle() | ✅ Line 10952 | ✅ Line 10839 | YES | **KEEP** |

---

## 6. Business Logic Features

| Feature | index.html | DigiTronics_v5.html | Duplicate | Action |
|---------|-----------|---------------------|-----------|--------|
| reconcileMissingCashPurchaseEntries() | ✅ Line 19071 | ✅ Line 18740 | YES | **KEEP** (V6 version) |
| getMissingCashPurchaseEntries() | ✅ Line 19053 | ✅ Line 18722 | YES | **KEEP** (V6 version) |
| supplierBalanceMigrated | ✅ Line 38318 | ✅ Line 37969 | YES | **KEEP** (V6 version) |
| renderDailyReport() | ✅ Line 20165 | ✅ Line 20165 | YES | **KEEP** |
| renderProductsTable() | ✅ Line 21030 | ✅ Line 21030 | YES | **KEEP** |
| renderSerialsTable() | ✅ Line 21169 | ✅ Line 21169 | YES | **KEEP** |
| renderStockMovement() | ✅ Line 21502 | ✅ Line 21502 | YES | **KEEP** |
| renderPurchases() | ✅ Line 22102 | ✅ Line 22102 | YES | **KEEP** |
| renderSuppliers() | ✅ Line 22477 | ✅ Line 22477 | YES | **KEEP** |
| renderCustomersTable() | ✅ Line 23060 | ✅ Line 23060 | YES | **KEEP** |
| renderInstallments() | ✅ Line 23419 | ✅ Line 23419 | YES | **KEEP** |
| renderReturns() | ✅ Line 24017 | ✅ Line 24017 | YES | **KEEP** |
| renderWarranty() | ✅ Line 24325 | ✅ Line 24325 | YES | **KEEP** |
| renderMaintenance() | ✅ Line 24821 | ✅ Line 24821 | YES | **KEEP** |
| renderTreasury() | ✅ Line 25011 | ✅ Line 25011 | YES | **KEEP** |
| renderCashFlow() | ✅ Line 25229 | ✅ Line 25229 | YES | **KEEP** |
| renderUnifiedLedgerTable() | ✅ Line 25330 | ✅ Line 25330 | YES | **KEEP** |
| renderExpenses() | ✅ Line 25735 | ✅ Line 25735 | YES | **KEEP** |
| renderReports() | ✅ Line 25794 | ✅ Line 25794 | YES | **KEEP** |
| renderAnalyticsPage() | ✅ Line 26203 | ✅ Line 26203 | YES | **KEEP** |
| renderCRMCustomerPanel() | ✅ Line 19059 | ✅ Line 19059 | YES | **KEEP** |
| renderApprovalsPage() | ✅ Line 19409 | ✅ Line 19409 | YES | **KEEP** |
| renderAlertsCenter() | ✅ Line 19734 | ✅ Line 19734 | YES | **KEEP** |
| renderSmartBusinessDashboard() | ✅ Line 26710 | ✅ Line 26710 | YES | **KEEP** |
| renderExecDashboard() | ✅ Line 26816 | ✅ Line 26816 | YES | **KEEP** |
| renderAiOwnerAssistant() | ✅ Line 27550 | ✅ Line 27550 | YES | **KEEP** |
| renderAutomationCenter() | ✅ Line 27824 | ✅ Line 27824 | YES | **KEEP** |
| renderPwaPage() | ✅ Line 14419 | ✅ Line 14419 | YES | **KEEP** |
| renderBackupPage() | ✅ Line 14061 | ✅ Line 14061 | YES | **KEEP** |
| renderEnterpriseCommandCenter() | ✅ Line 15033 | ✅ Line 14887 | YES | **KEEP** |
| renderEnterpriseDocumentCenter() | ✅ Line 15214 | ✅ Line 15112 | YES | **KEEP** |
| renderEnterpriseRecoveryCenter() | ✅ Line 15599 | ✅ Line 15374 | YES | **KEEP** |
| renderEnterprisePerformanceEngine() | ✅ Line 15868 | ✅ Line 15743 | YES | **KEEP** |
| renderEnterpriseQaCenter() | ✅ Line 16109 | ✅ Line 15948 | YES | **KEEP** |
| renderTrainingCenter() | ✅ Line 16313 | ✅ Line 16313 | YES | **KEEP** |
| saveProduct() | ✅ Line 20869 | ✅ Line 20869 | YES | **KEEP** |
| savePurchase() | ✅ Line 22089 | ✅ Line 22089 | YES | **KEEP** |
| saveSupplier() | ✅ Line 22433 | ✅ Line 22433 | YES | **KEEP** |
| saveCustomer() | ✅ Line 23005 | ✅ Line 23005 | YES | **KEEP** |
| saveCashEntry() | ✅ Line 24992 | ✅ Line 24992 | YES | **KEEP** |
| addCashEntry() | ✅ Line 18531 | ✅ Line 18531 | YES | **KEEP** |
| addStockMovement() | ✅ Line 18634 | ✅ Line 18634 | YES | **KEEP** |

---

## 7. PWA Features

| Feature | index.html | DigiTronics_v5.html | Duplicate | Action |
|---------|-----------|---------------------|-----------|--------|
| Service Worker registration | ✅ Line 14593 | ✅ Line 14256 | YES | **KEEP** |
| SW message listener | ✅ Line 14594 | ✅ Line 14259 | YES | **KEEP** |
| refreshPwaCache() | ✅ Line 14662 | ✅ Line 14327 | YES | **UPDATE** (change DigiTronics_v5.html to index.html) |
| clearPwaCache() | ✅ Line 14679 | ✅ Line 14344 | YES | **KEEP** |
| PWA install banner | ✅ Lines 1925-1934 | ✅ Lines 1924-1933 | YES | **KEEP** |
| PWA bottom nav | ✅ Lines 1936-1942 | ✅ Lines 1935-1941 | YES | **KEEP** |
| PWA status UI | ✅ Line 14677 | ✅ Line 14393 | YES | **KEEP** |
| PWA settings form | ✅ Line 14651 | ✅ Line 14430 | YES | **KEEP** |
| renderPwaPage() | ✅ Line 14419 | ✅ Line 14419 | YES | **KEEP** |
| logPwaAudit() | ✅ Line 14671 | ✅ Line 14269 | YES | **KEEP** |

---

## 8. Configuration Features

| Feature | index.html | DigiTronics_v5.html | Duplicate | Action |
|---------|-----------|---------------------|-----------|--------|
| DIGITRONICS_PWA_VERSION | ✅ Line 14511 | ✅ Line 14176 | YES | **KEEP** |
| APP_VERSION_LABEL | ✅ Line 7026 | ✅ Line 6917 | YES | **KEEP** |
| DB_KEY | ✅ Line 7022 | ✅ Line 6913 | YES | **KEEP** |
| SESSION_USER_KEY | ✅ Line 7024 | ✅ Line 6915 | YES | **KEEP** |
| USER_REG_KEY | ✅ Line 7023 | ✅ Line 6914 | YES | **KEEP** |
| CHANGE_LOG_KEY | ✅ Line 7025 | ✅ Line 6916 | YES | **KEEP** |
| ERROR_LOG_KEY | ✅ Line 7031 | ✅ Line 6922 | YES | **KEEP** |
| OMNISTORE_SETTINGS_KEY | ✅ Line 7032 | ✅ Line 6923 | YES | **KEEP** |
| PRODUCT_UUID_MAP_KEY | ✅ Line 9092 | ✅ Line 8979 | YES | **KEEP** |
| BACKEND_CONFIG_KEY | ✅ Line 10852 | ✅ Line 10739 | YES | **KEEP** |
| BACKEND_STATUS_KEY | ✅ Line 10853 | ✅ Line 10740 | YES | **KEEP** |
| BACKEND_OP_QUEUE_KEY | ✅ Line 11137 | ✅ Line 11024 | YES | **KEEP** |
| GH_TOKEN_KEY | ✅ Line 13793 | ✅ Line 13680 | YES | **KEEP** |
| GH_GIST_KEY | ✅ Line 13794 | ✅ Line 13681 | YES | **KEEP** |
| DIGITRONICS_PWA_SETTINGS_KEY | ✅ Line 14512 | ✅ Line 14177 | YES | **KEEP** |
| LIVE_SYNC_STATE_KEY | ✅ Line 14809 | ✅ Line 14474 | YES | **KEEP** |
| LIVE_SYNC_DEVICE_ID_KEY | ✅ Line 14810 | ✅ Line 14475 | YES | **KEEP** |
| COMMAND_CENTER_STATE_KEY | ✅ Line 15222 | ✅ Line 14887 | YES | **KEEP** |
| DOCUMENT_CENTER_STATE_KEY | ✅ Line 15447 | ✅ Line 15112 | YES | **KEEP** |
| ENTERPRISE_RECOVERY_STATE_KEY | ✅ Line 15709 | ✅ Line 15374 | YES | **KEEP** |
| ENTERPRISE_PERFORMANCE_STATE_KEY | ✅ Line 16078 | ✅ Line 15743 | YES | **KEEP** |
| ENTERPRISE_QA_STATE_KEY | ✅ Line 16283 | ✅ Line 15948 | YES | **KEEP** |
| PREMIUM_UI_PREFS_KEY | ✅ Line 7028 | ❌ | NO | **KEEP** |
| WORKFLOW_STORAGE_KEY | ✅ Line 19493 | ❌ | NO | **KEEP** |
| SMART_BI_STORAGE_KEY | ✅ Line 26995 | ❌ | NO | **KEEP** |
| AI_OWNER_STORAGE_KEY | ✅ Line 27697 | ❌ | NO | **KEEP** |
| AUTOMATION_STORAGE_KEY | ✅ Line 28116 | ❌ | NO | **KEEP** |
| PLUGIN_CENTER_STORAGE_KEY | ✅ Line 28490 | ❌ | NO | **KEEP** |

---

## 9. Deployment References

| Reference | Location | Current Value | Target Value | Action |
|-----------|----------|---------------|--------------|--------|
| manifest.json start_url | manifest.json:8 | `./DigiTronics_v5.html` | `./index.html` | **UPDATE** |
| manifest.json id | manifest.json:2 | `/DigiTronics_v5.html` | `/index.html` | **UPDATE** |
| manifest.json shortcuts | manifest.json:70,76 | `./DigiTronics_v5.html#pos`, `./DigiTronics_v5.html#serialsearch` | `./index.html#pos`, `./index.html#serialsearch` | **UPDATE** |
| sw.js APP_SHELL_ASSETS | sw.js | Includes `./DigiTronics_v5.html` | Remove | **UPDATE** |
| sw.js fallback chain | sw.js:407-422 | Falls back to `./DigiTronics_v5.html` | Remove | **UPDATE** |
| docker-compose.yml volumes | docker-compose.yml:45-46 | Mounts both files | Mount only index.html | **UPDATE** |
| refreshPwaCache() cache list | index.html:14669 | `'DigiTronics_v5.html'` | `'index.html'` | **UPDATE** |

---

## 10. Summary Matrix

### By Category

| Category | Total | KEEP | REMOVE | ARCHIVE | REVIEW | UPDATE |
|----------|-------|------|--------|---------|--------|--------|
| Dashboard | 20 | 12 | 0 | 8 | 0 | 0 |
| Performance | 12 | 12 | 0 | 0 | 0 | 0 |
| Data Safety | 5 | 5 | 0 | 0 | 0 | 0 |
| Demo | 9 | 0 | 0 | 9 | 0 | 0 |
| Backend Integration | 21 | 21 | 0 | 0 | 0 | 0 |
| Business Logic | 42 | 42 | 0 | 0 | 0 | 0 |
| PWA | 10 | 9 | 0 | 0 | 0 | 1 |
| Configuration | 28 | 28 | 0 | 0 | 0 | 0 |
| Deployment | 7 | 0 | 0 | 0 | 0 | 7 |
| **TOTAL** | **154** | **129** | **0** | **17** | **0** | **8** |

### By Action

| Action | Count | Description |
|--------|-------|-------------|
| **KEEP** | 129 | Features to keep in index.html |
| **REMOVE** | 0 | No features to remove |
| **ARCHIVE** | 17 | V3 dashboard + demo badges (in DigiTronics_v5.html only) |
| **REVIEW** | 0 | No features need review |
| **UPDATE** | 8 | Deployment references (manifest, sw, docker, refreshPwaCache) |

---

## 11. Migration Requirements

### CRITICAL FINDING

**No porting required.** Both `supplier migration` and `reconcileMissingCashPurchaseEntries()` already exist in `index.html`.

### Required Changes

| # | File | Change | Line | Risk |
|---|------|--------|------|------|
| 1 | manifest.json | start_url → index.html | 8 | LOW |
| 2 | manifest.json | id → index.html | 2 | LOW |
| 3 | manifest.json | shortcuts → index.html | 70,76 | LOW |
| 4 | sw.js | Remove DigiTronics_v5.html from cache | APP_SHELL_ASSETS | LOW |
| 5 | sw.js | Remove DigiTronics_v5.html from fallback | 407-422 | LOW |
| 6 | docker-compose.yml | Remove DigiTronics_v5.html mount | 45-46 | LOW |
| 7 | index.html | Update refreshPwaCache() cache list | 14669 | LOW |
| 8 | sw.js | Bump cache name version | Cache name | LOW |

---

*Feature inventory generated: 2026-08-05*
*Tag: phase23d-review*
*Commit: HEAD*
