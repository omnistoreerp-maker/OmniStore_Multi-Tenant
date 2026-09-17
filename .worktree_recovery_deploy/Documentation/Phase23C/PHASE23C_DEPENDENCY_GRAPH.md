# Phase 23C — Dependency Graph Documentation

**Repository:** E:\Projects\ESO
**Baseline:** phase23b-stable (tag e66b6fd)
**Date:** 2026-08-05
**Status:** Documentation Only — No Code Changes

---

## 1. Dependency Graph Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                        │
│  index.html / DigiTronics_v5.html                                       │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  backendApi ──────────────────────────────→ HTTP Backend         │  │
│  │  digitronicsDataAdapter ──→ backendApi ──→ HTTP Backend          │  │
│  │  syncEngine ──→ digitronicsDataAdapter ──→ backendApi            │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP/REST
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         BACKEND                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  server.js (Express App)                                          │  │
│  │  ├─→ routes/index.js (health, liveness, ready)                   │  │
│  │  ├─→ routes/sales.routes.js ──→ controllers/sales.controller.js  │  │
│  │  ├─→ routes/purchase.routes.js ──→ controllers/purchase.controller│  │
│  │  ├─→ routes/inventory.routes.js ──→ controllers/inventory.controller│ │
│  │  ├─→ ... (13 module routes)                                      │  │
│  │  └─→ routes/auth.routes.js ──→ controllers/auth.controller.js    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Controllers                                                      │  │
│  │  ├─→ Services (business logic)                                   │  │
│  │  └─→ utils/apiResponse.js (response formatting)                  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Services                                                         │  │
│  │  ├─→ utils/fileStore.js (JSON persistence)                       │  │
│  │  ├─→ utils/logger.js (logging)                                   │  │
│  │  └─→ uuid (unique IDs)                                           │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Middleware                                                        │  │
│  │  ├─→ middleware/auth.js (JWT verification)                        │  │
│  │  ├─→ middleware/authorize.js (role-based access)                  │  │
│  │  ├─→ middleware/security.js (rate limiting, sanitization)         │  │
│  │  ├─→ middleware/errorHandler.js (error handling)                  │  │
│  │  └─→ middleware/validate.js (resource validation)                 │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Backend Module Inventory

### 2.1 Routes (15 files)

| Route File | Path Prefix | Controller |
|------------|-------------|------------|
| index.js | /api/v1 | (health, liveness, ready) |
| auth.routes.js | /api/v1/auth | auth.controller.js |
| sales.routes.js | /api/v1/sales | sales.controller.js |
| purchase.routes.js | /api/v1/purchases | purchase.controller.js |
| inventory.routes.js | /api/v1/inventory | inventory.controller.js |
| inventoryTransactions.routes.js | /api/v1/inventory-transactions | inventoryTransactions.controller.js |
| customers.routes.js | /api/v1/customers | customers.controller.js |
| suppliers.routes.js | /api/v1/suppliers | suppliers.controller.js |
| treasury.routes.js | /api/v1/treasury | treasury.controller.js |
| employees.routes.js | /api/v1/employees | employees.controller.js |
| partners.routes.js | /api/v1/partners | partners.controller.js |
| voucher.routes.js | /api/v1/vouchers | voucher.controller.js |
| dashboard.routes.js | /api/v1/dashboard | dashboard.controller.js |
| reports.routes.js | /api/v1/reports | reports.controller.js |
| users.routes.js | /api/v1/users | users.controller.js |

### 2.2 Controllers (14 files)

| Controller | Service | Dependencies |
|------------|---------|--------------|
| auth.controller.js | users.service.js | utils/jwt.js, utils/password.js |
| sales.controller.js | sales.service.js | utils/logger.js |
| purchase.controller.js | purchase.service.js | utils/logger.js |
| inventory.controller.js | inventory.service.js | utils/logger.js |
| inventoryTransactions.controller.js | inventoryTransactions.service.js | utils/logger.js |
| customers.controller.js | customers.service.js | utils/logger.js |
| suppliers.controller.js | suppliers.service.js | utils/logger.js |
| treasury.controller.js | treasury.service.js | utils/logger.js |
| employees.controller.js | employees.service.js | utils/logger.js |
| partners.controller.js | partners.service.js | utils/logger.js |
| voucher.controller.js | voucher.service.js | utils/logger.js |
| dashboard.controller.js | dashboard.service.js | utils/logger.js |
| reports.controller.js | reports.service.js | utils/logger.js |
| users.controller.js | users.service.js | utils/logger.js |

### 2.3 Services (13 files)

| Service | Persistence | Dependencies |
|---------|-------------|--------------|
| sales.service.js | fileStore('sales') | uuid |
| purchase.service.js | fileStore('purchases') | uuid |
| inventory.service.js | fileStore('inventory') | uuid |
| inventoryTransactions.service.js | fileStore('inventoryTransactions') | uuid |
| customers.service.js | fileStore('customers') | uuid |
| suppliers.service.js | fileStore('suppliers') | uuid |
| treasury.service.js | fileStore('treasury') | uuid |
| employees.service.js | fileStore('employees') | uuid |
| partners.service.js | fileStore('partners') | uuid |
| voucher.service.js | fileStore('vouchers') | uuid |
| dashboard.service.js | fileStore('dashboard') | uuid |
| reports.service.js | fileStore('reports') | uuid |
| users.service.js | fileStore('users') | uuid |

### 2.4 Middleware (5 files)

| Middleware | Dependencies |
|-----------|--------------|
| auth.js | utils/jwt.js, utils/tokenStore.js |
| authorize.js | utils/logger.js |
| security.js | express-rate-limit |
| errorHandler.js | utils/logger.js |
| validate.js | (none) |

### 2.5 Utilities (6 files)

| Utility | Purpose |
|---------|---------|
| apiResponse.js | Standardized API responses |
| fileStore.js | JSON file persistence |
| jwt.js | JWT token generation/verification |
| logger.js | Application logging |
| password.js | Password hashing |
| tokenStore.js | Token revocation storage |

---

## 3. Frontend Module Inventory

### 3.1 Adapters (2 main)

| Adapter | Purpose | Dependencies |
|---------|---------|--------------|
| backendApi | HTTP client for backend API | fetch(), localStorage |
| digitronicsDataAdapter | Unified data access layer | backendApi, Supabase client |

### 3.2 Sync Engine (1 module)

| Module | Purpose | Dependencies |
|---------|---------|--------------|
| syncEngine | Bidirectional synchronization | digitronicsDataAdapter |

### 3.3 Feature Flags

| Flag | Source | Effect |
|------|--------|--------|
| USE_BACKEND | localStorage | Routes CRUD through backendApi |
| isSupabaseEnabled() | localStorage | Routes CRUD through Supabase |

---

## 4. Dependency Matrix

### 4.1 Backend Dependencies

| Component | Depends On |
|-----------|------------|
| server.js | express, config, middleware/*, routes/* |
| routes/*.js | controllers/*.js |
| controllers/*.js | services/*.js, utils/apiResponse.js, utils/logger.js |
| services/*.js | utils/fileStore.js, utils/logger.js, uuid |
| middleware/auth.js | utils/jwt.js, utils/tokenStore.js |
| middleware/security.js | express-rate-limit |
| utils/fileStore.js | fs (Node.js built-in) |

### 4.2 Frontend Dependencies

| Component | Depends On |
|-----------|------------|
| backendApi | fetch(), localStorage |
| digitronicsDataAdapter | backendApi, Supabase client |
| syncEngine | digitronicsDataAdapter |
| render*() functions | digitronicsDataAdapter, DB.* |

---

## 5. Data Flow Dependencies

### 5.1 CRUD Operation Flow

```
UI renderSales()
    │
    ├─→ digitronicsDataAdapter.listSales()
    │       │
    │       ├─→ [USE_BACKEND=true] backendApi.sales.getAll()
    │       │       │
    │       │       └─→ HTTP GET /api/v1/sales
    │       │               │
    │       │               └─→ sales.routes.js
    │       │                       │
    │       │                       └─→ sales.controller.js
    │       │                               │
    │       │                               └─→ sales.service.js
    │       │                                       │
    │       │                                       └─→ fileStore.read('sales')
    │       │
    │       └─→ [USE_BACKEND=false] DB.saleInvoices (localStorage)
    │
    └─→ Update DOM
```

### 5.2 Sync Operation Flow

```
syncEngine.syncPendingSales()
    │
    ├─→ Find unsynced records (DB.saleInvoices)
    │
    ├─→ For each record:
    │       │
    │       └─→ digitronicsDataAdapter.createSale()
    │               │
    │               └─→ backendApi.sales.create()
    │                       │
    │                       └─→ HTTP POST /api/v1/sales
    │
    └─→ Mark as synced (_syncedToBackend = true)
```

---

## 6. Circular Dependencies Analysis

### 6.1 Backend

**No circular dependencies detected.**

All backend dependencies are unidirectional:
- server.js → routes → controllers → services → fileStore

### 6.2 Frontend

**No circular dependencies detected.**

All frontend dependencies are unidirectional:
- render*() → digitronicsDataAdapter → backendApi → HTTP

---

## 7. Tight Coupling Analysis

### 7.1 Backend Tight Coupling

| Coupling | Location | Impact |
|----------|----------|--------|
| All services depend on fileStore | services/*.js | High (single point of failure) |
| All controllers depend on logger | controllers/*.js | Low (utility) |
| auth.controller depends on users.service | auth.controller.js | Medium (cross-module) |

### 7.2 Frontend Tight Coupling

| Coupling | Location | Impact |
|----------|----------|--------|
| All adapters depend on localStorage | backendApi, digitronicsDataAdapter | Medium |
| digitronicsDataAdapter depends on backendApi | digitronicsDataAdapter.js | High (adapter layer) |
| render*() functions depend on digitronicsDataAdapter | renderSales(), etc. | High (UI layer) |

---

## 8. Module Dependency Summary

### 8.1 Backend Modules (13 data modules)

| Module | Route | Controller | Service | Persistence |
|--------|-------|------------|---------|-------------|
| sales | /api/v1/sales | sales.controller.js | sales.service.js | sales.json |
| purchases | /api/v1/purchases | purchase.controller.js | purchase.service.js | purchases.json |
| inventory | /api/v1/inventory | inventory.controller.js | inventory.service.js | inventory.json |
| inventory-transactions | /api/v1/inventory-transactions | inventoryTransactions.controller.js | inventoryTransactions.service.js | inventoryTransactions.json |
| customers | /api/v1/customers | customers.controller.js | customers.service.js | customers.json |
| suppliers | /api/v1/suppliers | suppliers.controller.js | suppliers.service.js | suppliers.json |
| treasury | /api/v1/treasury | treasury.controller.js | treasury.service.js | treasury.json |
| employees | /api/v1/employees | employees.controller.js | employees.service.js | employees.json |
| partners | /api/v1/partners | partners.controller.js | partners.service.js | partners.json |
| vouchers | /api/v1/vouchers | voucher.controller.js | voucher.service.js | vouchers.json |
| dashboard | /api/v1/dashboard | dashboard.controller.js | dashboard.service.js | dashboard.json |
| reports | /api/v1/reports | reports.controller.js | reports.service.js | reports.json |
| users | /api/v1/users | users.controller.js | users.service.js | users.json |

### 8.2 Frontend Modules (13 data modules)

| Module | backendApi Methods | digitronicsDataAdapter Methods |
|--------|-------------------|-------------------------------|
| sales | getAll, getById, getStats, create, update, delete | listSales, getSale, createSale, refreshSales, syncPendingSales |
| purchases | getAll, getById, getStats, create, update, delete | listPurchases, getPurchase, createPurchase, refreshPurchases, syncPendingPurchases |
| inventory | getAll, getById, getStats, create, update, delete | listInventory, getProduct, createProduct, refreshInventory, syncPendingInventory |
| inventoryTransactions | getAll, getById, getStats, create, update, delete | listInventoryTransactions, refreshInventoryTransactions, syncPendingInventoryTransactions |
| customers | getAll, getById, getStats, create, update, delete | listCustomers, getCustomer, createCustomer, refreshCustomers, syncPendingCustomers |
| suppliers | getAll, getById, getStats, create, update, delete | listSuppliers, getSupplier, createSupplier, refreshSuppliers, syncPendingSuppliers |
| treasury | getAll, getById, getStats, create, update, delete | listTreasury, refreshTreasury, syncPendingTreasury |
| employees | getAll, getById, getStats, create, update, delete | listEmployees, refreshEmployees, syncPendingEmployees |
| partners | getAll, getById, getStats, create, update, delete | listPartners, refreshPartners, syncPendingPartners |
| reports | getAll, getById, getStats, create, update, delete | listReports, refreshReports, syncPendingReports |
| dashboard | getAll, getById, getStats, create, update, delete | listDashboard, refreshDashboard, syncPendingDashboard |
| vouchers | getAll, getById, getStats, create, update, delete | listVouchers, refreshVouchers, syncPendingVouchers |
| users | getAll, getById, getStats, create, update, delete | listUsers, refreshUsers, syncPendingUsers |

---

*Dependency graph documentation generated: 2026-08-05*
*Tag: phase23b-stable*
*Commit: e66b6fd*
