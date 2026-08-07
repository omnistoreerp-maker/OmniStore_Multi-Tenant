# Phase 23C — Runtime Architecture Documentation

**Repository:** E:\Projects\ESO
**Baseline:** phase23b-stable (tag e66b6fd)
**Date:** 2026-08-05
**Status:** Documentation Only — No Code Changes

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PRESENTATION LAYER                          │
│  index.html / DigiTronics_v5.html (37K+ lines each)                │
│  ┌─────────────┐  ┌─────────────────────┐  ┌────────────────────┐  │
│  │  UI Logic   │  │  backendApi         │  │  syncEngine        │  │
│  │  (render)   │  │  (HTTP client)      │  │  (push/pull)       │  │
│  └─────────────┘  └─────────────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ USE_BACKEND flag
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         ADAPTER LAYER                               │
│  ┌─────────────────────┐  ┌─────────────────────────────────────┐  │
│  │  backendApi         │  │  digitronicsDataAdapter              │  │
│  │  (HTTP → backend)   │ │  (Supabase/Backend → unified API)   │  │
│  └─────────────────────┘  └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP/REST
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         BACKEND LAYER                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  Routes      │  │  Controllers │  │  Services    │              │
│  │  (Express)   │──│  (business)  │──│  (persistence│              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ fileStore (JSON)
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       PERSISTENCE LAYER                             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  backend/data/*.json (sales.json, purchases.json)            │  │
│  │  fileStore (synchronous write-through)                        │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Frontend Layer

### 2.1 Entry Points

| File | Lines | Role |
|------|-------|------|
| `index.html` | 37,827 | Primary entry point (nginx default) |
| `DigiTronics_v5.html` | 37,464 | Legacy entry point (manifest.json default) |

### 2.2 Feature Flag

```javascript
USE_BACKEND = getBackendConfig().enabled;  // localStorage-based
```

- **Default:** `false` (local Supabase mode)
- **Storage:** localStorage key `esoBackendRuntimeConfig`
- **Effect:** Routes all CRUD through `backendApi` when `true`

### 2.3 Adapter Pattern

**backendApi** — HTTP client for backend REST API:
```javascript
const backendApi = {
  _fetch: (method, path, body) => { /* HTTP request */ },
  sales: {
    getAll: () => USE_BACKEND ? backendApi._fetch('GET', '/sales') : null,
    create: (data) => USE_BACKEND ? backendApi._fetch('POST', '/sales', data) : null,
    // ... CRUD for 13 modules
  },
  auth: {
    login: (username, password) => USE_BACKEND ? backendApi._fetch('POST', '/auth/login', ...) : null,
  }
};
```

**digitronicsDataAdapter** — Unified data access layer:
```javascript
const digitronicsDataAdapter = {
  listSales: () => { /* backend or Supabase */ },
  createSale: (data) => { /* backend or Supabase */ },
  // ... unified API for all modules
};
```

### 2.4 Sync Engine

13 registered modules with push/pull handlers:
- `syncPending(module)` — Push local changes to server
- `refreshModule(module)` — Pull server state to local
- `createRecord(module)` / `updateRecord(module)` / `deleteRecord(module)`

---

## 3. Backend Layer

### 3.1 Structure

```
backend/
├── config/index.js          # Environment configuration
├── server.js                # Express app setup
├── routes/                  # Route definitions (15 files)
│   ├── index.js             # Health/readiness endpoints
│   ├── auth.routes.js       # Authentication routes
│   └── [module].routes.js   # 13 module routes
├── controllers/             # Business logic (14 files)
├── services/                # Persistence layer (13 files)
├── middleware/               # Request processing (5 files)
│   ├── auth.js              # JWT verification
│   ├── authorize.js         # Role-based access
│   ├── security.js          # Rate limiting, sanitization
│   ├── errorHandler.js      # Error handling
│   └── validate.js          # Resource validation
├── utils/                   # Utilities (6 files)
├── data/                    # JSON persistence
└── tests/                   # Test suites
```

### 3.2 Request Flow

```
Client Request
    │
    ▼
Express Middleware Stack
    │
    ├─ helmet()                    # Security headers
    ├─ cors()                      # CORS handling
    ├─ compression()               # Gzip
    ├─ morgan('dev')               # Logging (dev only)
    ├─ requestPerfLogger()         # Slow request logging
    ├─ express.json()              # Body parsing
    ├─ sanitizeBody()              # Prototype pollution prevention
    ├─ apiRateLimiter()            # Rate limiting
    ├─ authMiddleware()            # JWT token extraction
    │
    ▼
Route Handler
    │
    ├─ validateResource()          # Resource validation
    │
    ▼
Controller
    │
    ├─ Input validation
    ├─ Business logic
    │
    ▼
Service
    │
    ├─ fileStore operations
    │
    ▼
Response
```

### 3.3 Modules (13)

| Module | Route | Controller | Service |
|--------|-------|------------|---------|
| sales | /api/v1/sales | sales.controller.js | sales.service.js |
| purchases | /api/v1/purchases | purchase.controller.js | purchase.service.js |
| inventory | /api/v1/inventory | inventory.controller.js | inventory.service.js |
| inventory-transactions | /api/v1/inventory-transactions | inventoryTransactions.controller.js | inventoryTransactions.service.js |
| customers | /api/v1/customers | customers.controller.js | customers.service.js |
| suppliers | /api/v1/suppliers | suppliers.controller.js | suppliers.service.js |
| treasury | /api/v1/treasury | treasury.controller.js | treasury.service.js |
| employees | /api/v1/employees | employees.controller.js | employees.service.js |
| partners | /api/v1/partners | partners.controller.js | partners.service.js |
| vouchers | /api/v1/vouchers | voucher.controller.js | voucher.service.js |
| dashboard | /api/v1/dashboard | dashboard.controller.js | dashboard.service.js |
| reports | /api/v1/reports | reports.controller.js | reports.service.js |
| users | /api/v1/users | users.controller.js | users.service.js |

---

## 4. Persistence Layer

### 4.1 fileStore

```javascript
const fileStore = {
  _path: (file) => path.join(DATA_DIR, file),
  _ensureDir: () => fs.mkdirSync(DATA_DIR, { recursive: true }),
  read: (file) => { /* read JSON */ },
  write: (file, data) => { /* write JSON sync */ },
  flushAll: () => { /* flush pending writes */ }
};
```

### 4.2 Data Files

| File | Content |
|------|---------|
| `backend/data/sales.json` | Sales invoices |
| `backend/data/purchases.json` | Purchase invoices |

### 4.3 Write Strategy

- **Synchronous write-through** — Every mutation writes to disk immediately
- **No async buffering** — Data is never in-flight
- **flushAll()** — Called on graceful shutdown (stable hook regardless)

---

## 5. Authentication Flow

```
Login Request
    │
    ▼
POST /api/v1/auth/login
    │
    ├─ Validate credentials
    ├─ Generate JWT access token (15m)
    ├─ Generate JWT refresh token (7d)
    ├─ Store refresh token in tokenStore
    │
    ▼
Response: { accessToken, refreshToken }
    │
    ▼
Subsequent Requests
    │
    ├─ Authorization: Bearer <accessToken>
    │
    ▼
authMiddleware()
    │
    ├─ Extract token from header
    ├─ Verify JWT signature
    ├─ Attach user to request
    │
    ▼
requireAuth() (if AUTH_REQUIRED=true)
    │
    ├─ Check user exists
    ├─ Check token not revoked
    │
    ▼
writeRoleGuard() (if AUTH_REQUIRED=true)
    │
    ├─ Check user role (Owner/Admin/Manager)
    │
    ▼
Route Handler
```

---

## 6. Configuration Architecture

### 6.1 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment |
| `PORT` | `3001` | Server port |
| `JWT_SECRET` | `dev-secret` | JWT signing secret |
| `JWT_REFRESH_SECRET` | `dev-secret:refresh` | Refresh token secret |
| `JWT_ACCESS_TTL` | `15m` | Access token TTL |
| `JWT_REFRESH_TTL` | `7d` | Refresh token TTL |
| `AUTH_REQUIRED` | `false` | Enable authentication |
| `CORS_ORIGINS` | `''` (open) | CORS allowlist |
| `RATE_LIMIT_MAX` | `1000` | Rate limit per window |
| `BODY_LIMIT` | `10mb` | Request body limit |
| `SUPABASE_URL` | `''` | Supabase URL |
| `SUPABASE_KEY` | `''` | Supabase anon key |

### 6.2 Feature Flags

| Flag | Location | Default | Effect |
|------|----------|---------|--------|
| `USE_BACKEND` | localStorage | `false` | Route CRUD through backend |
| `AUTH_REQUIRED` | env/config | `false` | Enable auth enforcement |

---

## 7. Data Flow Diagrams

### 7.1 CRUD Operation (Backend Mode)

```
User Action (e.g., Create Sale)
    │
    ▼
UI Handler (renderSales)
    │
    ├─ digitronicsDataAdapter.createSale(data)
    │
    ▼
digitronicsDataAdapter
    │
    ├─ Check USE_BACKEND
    │   ├─ true: backendApi.sales.create(data)
    │   └─ false: Supabase client.from('sales').insert(data)
    │
    ▼
backendApi._fetch('POST', '/sales', data)
    │
    ├─ HTTP POST to /api/v1/sales
    │
    ▼
Express Route → Controller → Service → fileStore
    │
    ▼
Response: { success: true, data: {...} }
    │
    ▼
UI Update (re-render sales list)
```

### 7.2 Sync Flow

```
Sync Engine (periodic/manual)
    │
    ├─ syncPending('sales')
    │   ├─ Get pending local changes
    │   ├─ Push to server via backendApi.sales.create/update/delete
    │   └─ Clear pending changes on success
    │
    ├─ refreshModule('sales')
    │   ├─ Pull server state via backendApi.sales.getAll
    │   └─ Update local DB state
    │
    ▼
Local DB ←→ Server DB (eventual consistency)
```

---

## 8. Error Handling Flow

```
Controller Error
    │
    ▼
try/catch in Controller
    │
    ├─ Known error (validation, not found)
    │   └─ Return error response
    │
    ├─ Unknown error
    │   └─ Throw to Express error handler
    │
    ▼
Express Error Handler
    │
    ├─ notFound() — 404 for unknown routes
    ├─ jsonParseErrorHandler() — malformed JSON
    ├─ serverError() — 500 with production masking
    │
    ▼
Response: { success: false, error: "..." }
```

---

## 9. Security Architecture

### 9.1 Security Controls (Current)

| Control | Implementation |
|---------|----------------|
| Security headers | Helmet.js |
| CORS | Configurable allowlist |
| Rate limiting | express-rate-limit |
| Body sanitization | Custom middleware |
| JWT tokens | Access + refresh |
| Token revocation | tokenStore blacklist |
| Production error masking | serverError middleware |

### 9.2 Security Gaps

| Gap | Impact |
|-----|--------|
| AUTH_REQUIRED defaults to false | All routes open by default |
| No CSRF protection | Cookie-based vulnerability |
| Supabase anon key in HTML | Client-side exposure |
| Open CORS when unconfigured | Cross-origin requests allowed |

---

*Architecture documentation generated: 2026-08-05*
*Tag: phase23b-stable*
*Commit: e66b6fd*
