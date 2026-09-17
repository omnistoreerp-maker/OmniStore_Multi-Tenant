# PHASE24_ARCHITECTURE_BASELINE.md
## DigiTronics V2 Enterprise Architecture Baseline

**Date:** 2026-08-05
**Status:** APPROVED
**Phase:** 24 - API Foundation & Authentication
**Authority:** ADR-001 (Role Model), ADR-002 (Tenant Model)

---

## 1. ARCHITECTURE PRINCIPLES

| # | Principle | Description |
|---|-----------|-------------|
| 1 | Evidence-Based | All architecture decisions must be backed by verified evidence |
| 2 | Backward Compatible | New features must not break existing functionality |
| 3 | Incremental Enhancement | Phase 24 extends existing systems, not rewrites |
| 4 | Production Baseline | Phase 23D/E/F released and certified systems are immutable |
| 5 | Least Privilege | Users receive minimal necessary permissions |
| 6 | Defense in Depth | Multiple security layers protect resources |
| 7 | Separation of Concerns | Each component has a single responsibility |
| 8 | Documentation First | Architecture decisions documented before implementation |

---

## 2. CURRENT VERIFIED ARCHITECTURE

### 2.1 Frontend (EXISTS)

| Component | Status | Evidence |
|-----------|--------|----------|
| Monolithic SPA | ✅ EXISTS | index.html (40,288 lines) |
| PWA Manifest | ✅ EXISTS | manifest.json (80 lines) |
| Service Worker | ✅ EXISTS | sw.js (447 lines) |
| Frontend Services | ✅ EXISTS | 34 service modules |
| Business Plugins | ✅ EXISTS | 12 plugins |

### 2.2 Backend (EXISTS)

| Component | Status | Evidence |
|-----------|--------|----------|
| Express.js Server | ✅ EXISTS | backend/server.js (127 lines) |
| REST API | ✅ EXISTS | 14 route groups |
| JWT Authentication | ✅ EXISTS | backend/utils/jwt.js |
| bcrypt Hashing | ✅ EXISTS | backend/utils/password.js (cost=10) |
| RBAC Authorization | ✅ EXISTS | backend/middleware/authorize.js |
| Rate Limiting | ✅ EXISTS | backend/middleware/security.js |
| Security Headers | ✅ EXISTS | Helmet + Nginx |
| Token Revocation | ✅ EXISTS | backend/utils/tokenStore.js (in-memory) |
| File Persistence | ✅ EXISTS | backend/utils/fileStore.js (JSON) |

### 2.3 Infrastructure (EXISTS)

| Component | Status | Evidence |
|-----------|--------|----------|
| Docker | ✅ EXISTS | docker-compose.yml |
| Nginx | ✅ EXISTS | nginx.conf (94 lines) |
| CI/CD | ✅ EXISTS | .github/workflows/ci.yml |
| Tests | ✅ EXISTS | backend/tests/ (15 files) |
| Dockerfile | ✅ EXISTS | backend/Dockerfile (node:22-alpine) |

### 2.4 Data Layer (EXISTS)

| Component | Status | Evidence |
|-----------|--------|----------|
| JSON Persistence | ✅ EXISTS | backend/utils/fileStore.js |
| Atomic Writes | ✅ EXISTS | Temp-file-then-rename pattern |
| mtime Cache | ✅ EXISTS | In-memory with mtime validation |

---

## 3. TARGET ARCHITECTURE

### 3.1 Enhanced Backend (Post Phase 24)

```
┌─────────────────────────────────────────────────────────────┐
│                     API GATEWAY (NEW)                       │
├─────────────────────────────────────────────────────────────┤
│  Rate Limiting  │  CORS  │  Auth  │  Validation            │
│  API Versioning │  Documentation  │  Monitoring             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     BACKEND (ENHANCED)                      │
├─────────────────────────────────────────────────────────────┤
│  Express.js API (EXISTS)                                    │
│  JWT Authentication (EXISTS)                                │
│  OAuth2 Integration (NEW)                                   │
│  MFA Support (NEW)                                          │
│  RBAC Authorization (EXISTS + ENHANCED)                     │
│  Rate Limiting (EXISTS)                                     │
│  Webhook Framework (NEW)                                    │
│  API Key Management (NEW)                                   │
│  Tenant Isolation (NEW)                                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     DATA LAYER                              │
├─────────────────────────────────────────────────────────────┤
│  JSON File Persistence (EXISTS)                             │
│  Supabase (Optional, DRAFT schemas)                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. NON-GOALS

| # | Non-Goal | Reason |
|---|----------|--------|
| 1 | Rewrite backend | Backend already exists and is certified |
| 2 | Replace JWT | JWT already implemented and working |
| 3 | Replace bcrypt | bcrypt already implemented (cost=10) |
| 4 | Replace RBAC | RBAC already implemented |
| 5 | Replace PWA | PWA already implemented |
| 6 | Replace Docker | Docker already implemented |
| 7 | Replace CI/CD | CI/CD already implemented |
| 8 | Force PostgreSQL migration | JSON persistence remains supported |
| 9 | Remove existing tests | Tests already exist and passing |

---

## 5. TECHNOLOGY STACK

### 5.1 Existing Stack (No Changes)

| Component | Technology | Status |
|-----------|------------|--------|
| Runtime | Node.js 22 | EXISTS |
| Framework | Express.js | EXISTS |
| Authentication | JWT (jsonwebtoken) | EXISTS |
| Password Hashing | bcryptjs (cost=10) | EXISTS |
| Rate Limiting | express-rate-limit | EXISTS |
| Security Headers | helmet | EXISTS |
| Logging | Morgan + Winston | EXISTS |
| Testing | Jest + Supertest | EXISTS |
| E2E Testing | Playwright | EXISTS |
| Docker | Docker + Compose | EXISTS |
| CI/CD | GitHub Actions | EXISTS |

### 5.2 New Dependencies (Phase 24)

| Dependency | Purpose | Priority |
|------------|---------|----------|
| passport | OAuth2 framework | HIGH |
| passport-google-oauth20 | Google OAuth | HIGH |
| speakeasy | TOTP generation | HIGH |
| qrcode | QR code generation | HIGH |
| swagger-jsdoc | OpenAPI generation | HIGH |
| swagger-ui-express | Swagger UI | HIGH |
| bull | Job queue (webhooks) | MEDIUM |
| prom-client | Prometheus metrics | MEDIUM |

---

## 6. DEPLOYMENT MODEL

### 6.1 Infrastructure

| Aspect | Current | Target |
|--------|---------|--------|
| Container | Docker + Compose | No change |
| Web Server | Nginx 1.27 | No change |
| Backend Port | 3001 | No change |
| Frontend Port | 80 | No change |
| SSL/TLS | Nginx | No change |
| CI/CD | GitHub Actions | Enhanced |

### 6.2 Environment Variables

```bash
# Existing (No Change)
PORT=3001
JWT_SECRET=change-me
JWT_REFRESH_SECRET=change-me
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
AUTH_REQUIRED=false
CORS_ORIGINS=
RATE_LIMIT_MAX=1000
BODY_LIMIT=10mb
LOG_FILE=
SLOW_REQUEST_MS=1000
HTTP_PORT=80

# New (Phase 24)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
MFA_ISSUER=DigiTronics
WEBHOOK_SECRET=
API_KEY_PREFIX=digi_
```

---

## 7. PERSISTENCE MODEL

### 7.1 Current State (Verified)

| Aspect | Implementation |
|--------|----------------|
| Storage | JSON file persistence |
| Location | backend/data/ |
| Pattern | Atomic writes (temp-file-then-rename) |
| Cache | In-memory with mtime validation |
| Backup | Daily copy |

### 7.2 Data Files

| File | Purpose |
|------|---------|
| users.json | User accounts |
| products.json | Product catalog |
| sales.json | Sales invoices |
| purchases.json | Purchase invoices |
| customers.json | Customer records |
| suppliers.json | Supplier records |

### 7.3 Future Evolution

| Phase | Change | Migration |
|-------|--------|-----------|
| Phase 24 | Add tenant_id to JSON files | Optional |
| Phase 25 | Formalize multi-tenant | Required |
| Phase 30 | PostgreSQL migration | Optional |

---

## 8. AUTHENTICATION MODEL

### 8.1 Current State (Verified)

| Feature | Implementation | Status |
|---------|----------------|--------|
| JWT Access Tokens | 15min TTL | EXISTS |
| JWT Refresh Tokens | 7d TTL | EXISTS |
| bcrypt Hashing | Cost factor 10 | EXISTS |
| Token Revocation | In-memory Set | EXISTS |
| Rate Limiting | 20 attempts/15min | EXISTS |

### 8.2 Phase 24 Enhancements

| Feature | Implementation | Priority |
|---------|----------------|----------|
| OAuth2 | Google, GitHub | HIGH |
| MFA | TOTP | HIGH |
| API Keys | Prefixed strings | MEDIUM |
| Session Management | In-memory (current) | LOW |

---

## 9. AUTHORIZATION MODEL

### 9.1 Current State (Verified)

| Feature | Implementation | Status |
|---------|----------------|--------|
| Role-based Access | requireRole() | EXISTS |
| Permission-based Access | requirePermission() | EXISTS |
| Write Guard | writeRoleGuard() | EXISTS |
| Owner/Admin Bypass | Yes | EXISTS |

### 9.2 ADR-001 Role Model

| Current Role | Target Role | Migration |
|--------------|-------------|-----------|
| Owner | Super Admin | Automatic alias |
| Admin | Tenant Admin | Automatic alias |
| Manager | Manager | No change |
| Sales | Sales | No change |
| Viewer | Viewer | No change |
| - | Warehouse | New role |
| - | Accountant | New role |
| - | Support | New role |

---

## 10. TENANT MODEL

### 10.1 ADR-002 Tenant Hierarchy

```
Tenant (Company)
    └── Branch (Location)
            └── Warehouse (Storage)
```

### 10.2 Implementation Strategy

| Aspect | Decision |
|--------|----------|
| Multi-tenancy | Application-level |
| Isolation | Middleware-based |
| Persistence | JSON files with tenant_id |
| Database | Optional (Supabase DRAFT) |

---

## 11. EXTENSION STRATEGY

### 11.1 Phase 24 Extensions

| Extension | Approach |
|-----------|----------|
| OAuth2 | Add passport strategies |
| MFA | Add speakeasy + qrcode |
| API Docs | Add swagger-jsdoc |
| Webhooks | Add bull job queue |
| API Keys | Add key management |

### 11.2 Future Extensions

| Phase | Extension | Dependencies |
|-------|-----------|--------------|
| Phase 25 | Multi-Branch | ADR-002 |
| Phase 26 | Advanced Inventory | Phase 25 |
| Phase 27 | Advanced Reporting | Phase 26 |
| Phase 28 | Mobile App | Phase 24 |
| Phase 29 | SaaS Platform | Phase 25 |

---

## 12. FUTURE EVOLUTION

### 12.1 Technology Evolution

| Phase | Change | Impact |
|-------|--------|--------|
| Phase 24 | OAuth2, MFA, API Docs | Low |
| Phase 25 | Multi-Branch | Medium |
| Phase 30 | PostgreSQL | High |
| Phase 31 | Microservices | High |

### 12.2 Architecture Evolution

| Phase | Change | Impact |
|-------|--------|--------|
| Phase 24 | Enhanced monolith | Low |
| Phase 25 | Branch isolation | Medium |
| Phase 30 | Database migration | High |
| Phase 31 | Service decomposition | High |

---

## 13. CONSTRAINTS

| # | Constraint | Source |
|---|------------|--------|
| 1 | JSON persistence must remain supported | ADR-002 |
| 2 | Existing 5 roles must remain functional | ADR-001 |
| 3 | Phase 23D/E/F must not be modified | Production Baseline |
| 4 | No breaking API changes | Backward Compatibility |
| 5 | No forced PostgreSQL migration | ADR-002 |
| 6 | Owner/Admin must map to Super Admin/Tenant Admin | ADR-001 |

---

## 14. APPROVED ADR REFERENCES

| ADR | Title | Status | Authority |
|-----|-------|--------|-----------|
| ADR-001 | Role Model | APPROVED | Role definitions, hierarchy, migration |
| ADR-002 | Tenant Model | APPROVED | Tenant hierarchy, isolation, persistence |

---

**Document Generated:** 2026-08-05
**Status:** APPROVED
**Authority:** ADR-001, ADR-002
