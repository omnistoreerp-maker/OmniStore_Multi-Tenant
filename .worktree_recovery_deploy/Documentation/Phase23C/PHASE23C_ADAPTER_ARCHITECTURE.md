# Phase 23C — Adapter Architecture Documentation

**Repository:** E:\Projects\ESO
**Baseline:** phase23b-stable (tag e66b6fd)
**Date:** 2026-08-05
**Status:** Documentation Only — No Code Changes

---

## 1. Adapter Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         UI / Render Functions                           │
│  renderSales(), renderPurchases(), renderEmployees(), etc.              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ calls
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    digitronicsDataAdapter (Unified API)                  │
│  listSales(), createSale(), listPurchases(), createPurchase(), etc.     │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  USE_BACKEND === true?                                            │  │
│  │  YES → delegate to backendApi.*                                   │  │
│  │  NO  → delegate to Supabase client or legacy local DB            │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                    │                           │
                    │ USE_BACKEND=true          │ USE_BACKEND=false
                    ▼                           ▼
┌─────────────────────────────┐    ┌─────────────────────────────────────┐
│       backendApi            │    │     Supabase Client / Local DB      │
│  (HTTP REST Client)         │    │  client.from('table').操作()        │
│  backendApi.sales.getAll()  │    │  or DB.saleInvoices (localStorage)  │
└─────────────────────────────┘    └─────────────────────────────────────┘
            │
            │ HTTP/REST
            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Backend API Server (Express)                         │
│  /api/v1/sales, /api/v1/purchases, /api/v1/inventory, etc.              │
│  Routes → Controllers → Services → fileStore → JSON files               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. backendApi — HTTP Client

### 2.1 Structure

```javascript
const backendApi = {
  _baseUrl: API_BASE_URL || '',
  _getAuthToken() { /* localStorage access_token */ },
  async _fetch(method, path, body) { /* HTTP request with auth */ },

  // 13 data modules (each with 6 CRUD methods)
  sales:            { getAll, getById, getStats, create, update, delete },
  purchases:        { getAll, getById, getStats, create, update, delete },
  inventory:        { getAll, getById, getStats, create, update, delete },
  inventoryTransactions: { getAll, getById, getStats, create, update, delete },
  customers:        { getAll, getById, getStats, create, update, delete },
  suppliers:        { getAll, getById, getStats, create, update, delete },
  treasury:         { getAll, getById, getStats, create, update, delete },
  employees:        { getAll, getById, getStats, create, update, delete },
  partners:         { getAll, getById, getStats, create, update, delete },
  reports:          { getAll, getById, getStats, create, update, delete },
  dashboard:        { getAll, getById, getStats, create, update, delete },
  vouchers:         { getAll, getById, getStats, create, update, delete },
  users:            { getAll, getById, getStats, create, update, delete },

  // Auth module
  auth: { login, logout, me, roles, permissions }
};
```

### 2.2 Module Inventory (13 + Auth)

| Module | Route Prefix | Methods |
|--------|--------------|---------|
| sales | /api/v1/sales | getAll, getById, getStats, create, update, delete |
| purchases | /api/v1/purchases | getAll, getById, getStats, create, update, delete |
| inventory | /api/v1/inventory | getAll, getById, getStats, create, update, delete |
| inventoryTransactions | /api/v1/inventory-transactions | getAll, getById, getStats, create, update, delete |
| customers | /api/v1/customers | getAll, getById, getStats, create, update, delete |
| suppliers | /api/v1/suppliers | getAll, getById, getStats, create, update, delete |
| treasury | /api/v1/treasury | getAll, getById, getStats, create, update, delete |
| employees | /api/v1/employees | getAll, getById, getStats, create, update, delete |
| partners | /api/v1/partners | getAll, getById, getStats, create, update, delete |
| reports | /api/v1/reports | getAll, getById, getStats, create, update, delete |
| dashboard | /api/v1/dashboard | getAll, getById, getStats, create, update, delete |
| vouchers | /api/v1/vouchers | getAll, getById, getStats, create, update, delete |
| users | /api/v1/users | getAll, getById, getStats, create, update, delete |
| auth | /api/v1/auth | login, logout, me, roles, permissions |

### 2.3 _fetch Implementation

```javascript
async _fetch(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  const token = this._getAuthToken();
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(this._baseUrl + '/api/v1' + path, opts);
  const data = await res.json().catch(() => null);
  // Update backendStatus (online/error/offline)
  if (!res.ok) {
    if (res.status >= 500) return null;
    return data; // 4xx errors returned for idempotency
  }
  return data;
}
```

### 2.4 USE_BACKEND Guard

Every method checks the feature flag:
```javascript
sales: {
  getAll: () => USE_BACKEND ? backendApi._fetch('GET', '/sales') : null,
  create: (data) => USE_BACKEND ? backendApi._fetch('POST', '/sales', data) : null,
  // ...
}
```

- `USE_BACKEND = true` → HTTP request to backend
- `USE_BACKEND = false` → Returns `null` (caller falls back to local/Supabase)

---

## 3. digitronicsDataAdapter — Unified Data Access

### 3.1 Purpose

Provides a unified API that abstracts over:
- Backend API (when USE_BACKEND=true)
- Supabase (when Supabase configured)
- Local localStorage (fallback)

### 3.2 Module Methods

| Module | Methods | Notes |
|--------|---------|-------|
| sales | listSales, getSale, createSale, refreshSales, syncPendingSales | Full sync support |
| purchases | listPurchases, getPurchase, createPurchase, refreshPurchases, syncPendingPurchases | Full sync support |
| inventory | listInventory, getProduct, createProduct, refreshInventory, syncPendingInventory | Full sync support |
| inventoryTransactions | listInventoryTransactions, refreshInventoryTransactions, syncPendingInventoryTransactions | Full sync support |
| customers | listCustomers, getCustomer, createCustomer, refreshCustomers, syncPendingCustomers | Full sync support |
| suppliers | listSuppliers, getSupplier, createSupplier, refreshSuppliers, syncPendingSuppliers | Full sync support |
| treasury | listTreasury, refreshTreasury, syncPendingTreasury | Full sync support |
| employees | listEmployees, refreshEmployees, syncPendingEmployees | Full sync support |
| partners | listPartners, refreshPartners, syncPendingPartners | Full sync support |
| reports | listReports, refreshReports, syncPendingReports | Full sync support |
| dashboard | listDashboard, refreshDashboard, syncPendingDashboard | Full sync support |
| vouchers | listVouchers, refreshVouchers, syncPendingVouchers | Full sync support |
| users | listUsers, refreshUsers, syncPendingUsers | Full sync support |

### 3.3 Typical Method Implementation

```javascript
async listSales() {
  // 1. If USE_BACKEND=false, return local DB
  if (!USE_BACKEND) return DB.saleInvoices;

  // 2. Try backend API
  try {
    const res = await backendApi.sales.getAll();
    const arr = res && res.success ? (Array.isArray(res.data) ? res.data : ...) : null;
    if (arr) return arr.map(inv => this._normalizeBackendSale(inv));
    return DB.saleInvoices; // Fallback to local
  } catch (e) {
    return DB.saleInvoices; // Fallback on error
  }
}
```

---

## 4. Sync Engine Pattern

### 4.1 Overview

The sync engine provides bidirectional synchronization between local (localStorage) and backend:

```
Local DB (localStorage) ←→ Sync Engine ←→ Backend API
```

### 4.2 Sync Operations

| Operation | Direction | Purpose |
|-----------|-----------|---------|
| syncPending*() | Local → Backend | Push unsynced local changes to server |
| refresh*() | Backend → Local | Pull server state to local DB |

### 4.3 Sync Flow

**syncPending (Push):**
```
1. Find records where _syncedToBackend === false
2. For each record:
   a. Call backendApi.*.create(record)
   b. On success: mark _syncedToBackend = true, store _backendId
   c. On failure: skip (retry later)
3. Save local DB if changes made
```

**refresh (Pull):**
```
1. Call backendApi.*.getAll()
2. For each backend record:
   a. If not in local DB and not unsynced and not tombstoned:
      - Add to local DB (imported from backend)
   b. If exists in local DB and local updatedAt < backend updatedAt:
      - Update local record (overwrite)
3. Save local DB if changes made
```

### 4.4 Conflict Resolution

- **Last-write-wins** based on `updatedAt` timestamp
- **Unsynced local changes** are never overwritten by backend refresh
- **Tombstones** prevent re-importing deleted records

### 4.5 Registered Modules (13)

All 13 data modules have complete sync engine registration:
- `syncHandler(module)` — Push pending
- `refreshHandler(module)` — Pull server state
- `createHandler(module)` / `updateHandler(module)` / `deleteHandler(module)`

---

## 5. USE_BACKEND Flag Behavior

### 5.1 Flag Source

```javascript
function getBackendConfig() {
  try {
    const raw = localStorage.getItem('esoBackendRuntimeConfig');
    if (raw) {
      const cfg = JSON.parse(raw);
      return { enabled: !!cfg.enabled, url: cfg.url || '' };
    }
  } catch (e) {}
  return { enabled: false, url: '' };
}
let USE_BACKEND = getBackendConfig().enabled;
```

### 5.2 Behavior Matrix

| USE_BACKEND | Supabase Configured | Behavior |
|-------------|---------------------|----------|
| false | No | Pure local (localStorage only) |
| false | Yes | Supabase + local fallback |
| true | No | Backend API + local fallback |
| true | Yes | Backend API + Supabase + local fallback |

### 5.3 Runtime Toggle

Users can toggle USE_BACKEND at runtime via the Backend Config UI in the settings panel. The flag is persisted in localStorage.

---

## 6. Adapter Fallback Chain

```
Request
  │
  ├─ USE_BACKEND=true?
  │   ├─ YES → backendApi.*.method()
  │   │         ├─ Success? → Return result
  │   │         └─ Failure? → Fall through
  │   │
  │   └─ NO → Continue
  │
  ├─ Supabase configured?
  │   ├─ YES → client.from('table').操作()
  │   │         ├─ Success? → Return result
  │   │         └─ Failure? → Fall through
  │   │
  │   └─ NO → Continue
  │
  └─ Local DB (localStorage)
       └─ Always works (offline-first)
```

### 6.1 Fallback Priority

1. **Backend API** (if USE_BACKEND=true)
2. **Supabase** (if configured and available)
3. **Local localStorage** (always available)

### 6.2 Error Handling

- Backend 5xx errors → return null, caller falls back
- Backend 4xx errors → return parsed error (for idempotency)
- Network errors → return null, caller falls back
- Supabase errors → log error, fall back to legacy

---

## 7. Adapter Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           UI Layer                                      │
│  renderSales() → digitronicsDataAdapter.listSales()                     │
│  createSale()  → digitronicsDataAdapter.createSale()                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    digitronicsDataAdapter                                │
│                                                                         │
│  listSales() ─────────┬──────────────────────────────┐                  │
│                       │                              │                  │
│           USE_BACKEND=true                 USE_BACKEND=false             │
│                       │                              │                  │
│                       ▼                              ▼                  │
│              backendApi.sales.getAll()     Supabase / Local DB          │
│                       │                              │                  │
│                       ▼                              ▼                  │
│              HTTP GET /api/v1/sales        client.from('sales').select()│
│                       │                              │                  │
│                       ▼                              ▼                  │
│              Backend Controller           Supabase / localStorage       │
│                       │                              │                  │
│                       ▼                              ▼                  │
│              Backend Service                      DB.saleInvoices       │
│                       │                                                   │
│                       ▼                                                   │
│              fileStore → sales.json                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Key Implementation Details

### 8.1 Backend Op Queue

For failed operations, the frontend maintains a retry queue:

```javascript
const backendOpQueue = {
  enqueue(op) { /* add to localStorage queue */ },
  async process() { /* retry pending operations */ },
  isTombstoned(id) { /* check if record was deleted */ }
};
```

### 8.2 Tombstones

Deleted records are tombstoned to prevent re-import during refresh:
- Tombstone IDs stored in localStorage
- Checked during refresh to skip re-imported deleted records

### 8.3 Normalization

Backend responses are normalized to match local schema:
```javascript
_normalizeBackendSale(bs) {
  return {
    ...bs,
    id: bs.id || bs.invoiceId,
    invoiceId: bs.invoiceId || bs.id,
    date: bs.date || bs.createdAt,
    customer: bs.customer || bs.customerName || '',
    payment: bs.payment || bs.paymentType || 'cash'
  };
}
```

---

*Adapter architecture documentation generated: 2026-08-05*
*Tag: phase23b-stable*
*Commit: e66b6fd*
