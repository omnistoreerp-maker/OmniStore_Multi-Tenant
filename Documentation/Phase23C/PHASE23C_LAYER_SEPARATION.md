# Phase 23C — Layer Separation Documentation

**Repository:** E:\Projects\ESO
**Baseline:** phase23b-stable (tag e66b6fd)
**Date:** 2026-08-05
**Status:** Documentation Only — No Code Changes

---

## 1. Layer Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      PRESENTATION LAYER                                 │
│  index.html / DigiTronics_v5.html                                       │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  CSS Styles (embedded)     │  HTML Structure   │  UI Logic       │  │
│  │  Variables, Themes         │  Login, Dashboard │  render*()      │  │
│  │  Glass morphism            │  Modals, Forms    │  Event handlers │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ calls
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        BUSINESS LAYER                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Validation Rules    │  Business Logic    │  Calculations        │  │
│  │  _validateRequired() │  createSale()      │  calculateProfit()   │  │
│  │  validateSerials()   │  closeDay()        │  roundMoney()        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ delegates to
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         DATA LAYER                                      │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Adapters (frontend)          │  Sync Engine                     │  │
│  │  backendApi                   │  syncPending*()                  │  │
│  │  digitronicsDataAdapter       │  refresh*()                      │  │
│  │  Supabase client              │  conflict resolution             │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Backend Services             │  Controllers                     │  │
│  │  sales.service.js             │  sales.controller.js             │  │
│  │  inventory.service.js         │  inventory.controller.js         │  │
│  │  fileStore (JSON)             │  Request validation              │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ persists to
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       PERSISTENCE LAYER                                 │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Frontend                    │  Backend                          │  │
│  │  localStorage (DB.*)         │  backend/data/*.json              │  │
│  │  Supabase (cloud)            │  fileStore (sync write-through)   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Presentation Layer

### 2.1 Location
- `index.html` (37,827 lines)
- `DigiTronics_v5.html` (37,464 lines)

### 2.2 Responsibilities
| Component | Responsibility |
|-----------|---------------|
| CSS Styles | Visual design, themes, responsive layout |
| HTML Structure | DOM elements, forms, tables, modals |
| UI Logic | render*() functions, event handlers, DOM manipulation |

### 2.3 Key Components

**CSS (Embedded):**
- CSS variables (themes: light, dark, glass morphism)
- Responsive design (mobile-first)
- Animation and transitions

**HTML Structure:**
- Login screen
- Dashboard
- Module views (Sales, Purchases, Inventory, etc.)
- Modals and forms
- Settings panel

**UI Logic (JavaScript):**
- `renderSales()` — Render sales list
- `renderPurchases()` — Render purchases list
- `renderInventory()` — Render inventory list
- `showModal()` / `hideModal()` — Modal management
- Event handlers for user interactions

### 2.4 Layer Boundaries
- **MAY:** Call business layer functions
- **MAY:** Call data layer adapters
- **MUST NOT:** Directly access persistence layer
- **MUST NOT:** Contain business rules (validation, calculations)

---

## 3. Business Layer

### 3.1 Location
- Frontend: Embedded in HTML files (JavaScript functions)
- Backend: `backend/controllers/*.js`

### 3.2 Responsibilities
| Component | Responsibility |
|-----------|---------------|
| Validation | Input validation, data integrity checks |
| Business Rules | Order processing, stock management |
| Calculations | Profit calculation, totals, discounts |

### 3.3 Key Components

**Frontend Business Logic:**
```javascript
// Validation
_validateRequired(data, forCreate)
validateSaleSerialsOrWarn(items)
validatePurchaseSerialsOrWarn(items)

// Calculations
calculateSaleInvoiceProfit({ items, discount })
roundMoney(value)
clampNumber(value, min, max)
toSafeFloat(value, default)
toSafeInt(value, default)
```

**Backend Controllers:**
```javascript
// sales.controller.js
list(req, res)           // List invoices with filtering
getById(req, res)        // Get single invoice
create(req, res)         // Create new invoice
update(req, res)         // Update existing invoice
remove(req, res)         // Delete invoice
getStats(req, res)       // Get sales statistics
```

### 3.4 Layer Boundaries
- **MAY:** Call data layer adapters/services
- **MUST NOT:** Directly manipulate DOM (presentation layer)
- **MUST NOT:** Directly access persistence layer (data layer handles)

---

## 4. Data Layer

### 4.1 Location
- Frontend: `backendApi`, `digitronicsDataAdapter` (in HTML files)
- Backend: `backend/services/*.js`

### 4.2 Responsibilities
| Component | Responsibility |
|-----------|---------------|
| Adapters | Abstract data source differences |
| Sync Engine | Bidirectional synchronization |
| Services | Backend data operations |

### 4.3 Key Components

**Frontend Adapters:**
```javascript
// backendApi — HTTP client
backendApi.sales.getAll()
backendApi.sales.create(data)

// digitronicsDataAdapter — Unified API
digitronicsDataAdapter.listSales()
digitronicsDataAdapter.createSale(payload)

// Sync Engine
syncPendingSales()     // Push local changes to server
refreshSales()         // Pull server state to local
```

**Backend Services:**
```javascript
// sales.service.js
class SalesService {
  list(query)           // List with filtering/pagination
  getById(id)           // Get by ID
  create(data)          // Create new record
  update(id, data)      // Update record
  delete(id)            // Delete record
  stats()               // Get statistics
}
```

### 4.4 Layer Boundaries
- **MAY:** Access persistence layer (fileStore, localStorage)
- **MUST NOT:** Manipulate DOM (presentation layer)
- **MUST NOT:** Contain business rules (business layer)

---

## 5. Persistence Layer

### 5.1 Location
- Frontend: `localStorage` (browser)
- Backend: `backend/data/*.json` (file system)

### 5.2 Responsibilities
| Component | Responsibility |
|-----------|---------------|
| localStorage | Client-side data persistence |
| fileStore | Server-side JSON file persistence |
| Supabase | Cloud database (optional) |

### 5.3 Key Components

**Frontend Persistence:**
```javascript
// localStorage
DB.saleInvoices        // Sales data
DB.purchaseInvoices    // Purchases data
DB.inventory           // Inventory data
// ... etc.

saveDB()               // Persist to localStorage
loadDB()               // Load from localStorage
```

**Backend Persistence:**
```javascript
// fileStore.js
fileStore.read(storeName)    // Read JSON file
fileStore.write(storeName, db) // Write JSON file (sync)
fileStore.flushAll()         // Flush pending writes
```

### 5.4 Layer Boundaries
- **MUST NOT:** Contain business logic
- **MUST NOT:** Manipulate DOM
- **SHOULD:** Only handle data storage/retrieval

---

## 6. Layer Communication Patterns

### 6.1 Request Flow (Frontend)

```
User Action (click button)
    │
    ▼
Presentation Layer (event handler)
    │
    ├─→ Business Layer (validation, calculation)
    │       │
    │       ▼
    │   Data Layer (adapter call)
    │       │
    │       ├─→ Backend API (HTTP)
    │       │       │
    │       │       ▼
    │       │   Backend Controller → Service → fileStore
    │       │
    │       └─→ Supabase / localStorage (fallback)
    │
    ▼
Presentation Layer (re-render UI)
```

### 6.2 Request Flow (Backend)

```
HTTP Request
    │
    ▼
Express Middleware
    │
    ├─→ Route Handler
    │       │
    │       ▼
    │   Controller (input validation, response formatting)
    │       │
    │       ▼
    │   Service (business logic, data operations)
    │       │
    │       ▼
    │   fileStore (JSON persistence)
    │
    ▼
HTTP Response
```

### 6.3 Sync Flow

```
Local Changes (unsynced)
    │
    ▼
Sync Engine (syncPending*)
    │
    ├─→ Backend API (push)
    │
    ▼
Server State (source of truth)
    │
    ▼
Sync Engine (refresh*)
    │
    ├─→ Local DB (update)
    │
    ▼
Presentation Layer (re-render)
```

---

## 7. Layer Violations Analysis

### 7.1 Current Violations

| Violation | Location | Impact |
|-----------|----------|--------|
| Business logic in presentation | HTML files contain validation functions | Moderate |
| Direct Supabase calls | ~30 `client.from()` calls in HTML | Medium |
| UI logic in data layer | Some render logic in adapters | Low |

### 7.2 Violation Details

**Business Logic in Presentation:**
- Validation functions (`_validateRequired`, `validateSerials`) are in HTML files
- Calculation functions (`calculateSaleInvoiceProfit`, `roundMoney`) are in HTML files
- These should ideally be in a separate business layer module

**Direct Supabase Calls:**
- Device tracking uses `client.from('devices').select()`
- UUID migration utilities use direct Supabase calls
- These bypass the adapter layer

### 7.3 Recommended Fixes (Future Phases)

| Fix | Phase | Priority |
|-----|-------|----------|
| Extract validation functions to separate module | 23D+ | Low |
| Replace direct Supabase calls with adapters | 23E | Medium |
| Consolidate business logic in services | 23D+ | Low |

---

## 8. Layer Dependency Matrix

| Layer | Depends On | Called By |
|-------|------------|-----------|
| Presentation | Business, Data | User |
| Business | Data | Presentation |
| Data | Persistence | Business |
| Persistence | None | Data |

---

*Layer separation documentation generated: 2026-08-05*
*Tag: phase23b-stable*
*Commit: e66b6fd*
