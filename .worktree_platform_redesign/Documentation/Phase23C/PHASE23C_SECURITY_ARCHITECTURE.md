# Phase 23C — Security Architecture

**Repository:** E:\Projects\ESO
**Baseline:** phase23b-stable (tag e66b6fd)
**Date:** 2026-08-05
**Status:** Documentation Only — No Code Changes

---

## 1. Security Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      SECURITY CONTROLS                                  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Transport Security                                               │  │
│  │  ├─→ HTTPS (TLS)                                                  │  │
│  │  ├─→ Helmet.js (security headers)                                 │  │
│  │  └─→ CORS (Cross-Origin Resource Sharing)                        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Authentication                                                   │  │
│  │  ├─→ JWT access tokens (15m TTL)                                  │  │
│  │  ├─→ JWT refresh tokens (7d TTL)                                  │  │
│  │  ├─→ Token revocation blacklist                                   │  │
│  │  └─→ Password hashing (bcrypt)                                    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Authorization                                                    │  │
│  │  ├─→ Role-based access control (Owner, Admin, Manager)            │  │
│  │  ├─→ writeRoleGuard (write operations)                            │  │
│  │  └─→ requireAuth (protected routes)                               │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Input Validation                                                 │  │
│  │  ├─→ Body sanitization (prototype pollution prevention)           │  │
│  │  ├─→ JSON parse error handling                                    │  │
│  │  └─→ Request size limits (10mb)                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Rate Limiting                                                    │  │
│  │  ├─→ Global API rate limiter (1000 req/15min)                     │  │
│  │  └─→ Login rate limiter (20 req/15min per IP+user)                │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Error Handling                                                   │  │
│  │  ├─→ Production error masking (no stack traces)                   │  │
│  │  └─→ Structured error responses                                  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Current Security Controls

### 2.1 Authentication

| Control | Implementation | Status |
|---------|----------------|--------|
| JWT access tokens | utils/jwt.js | Implemented |
| JWT refresh tokens | utils/jwt.js | Implemented |
| Token revocation | utils/tokenStore.js | Implemented |
| Password hashing | utils/password.js | Implemented |
| Cookie-based auth | middleware/auth.js | Implemented |
| Header-based auth | middleware/auth.js | Implemented |

### 2.2 Authorization

| Control | Implementation | Status |
|---------|----------------|--------|
| Role-based access | middleware/authorize.js | Implemented |
| writeRoleGuard | middleware/authorize.js | Implemented |
| requireAuth | middleware/auth.js | Implemented |
| Optional auth | middleware/auth.js | Implemented |

**Roles:**
- Owner: Full access
- Admin: Full access
- Manager: Write access
- Viewer: Read-only (implied)

### 2.3 Rate Limiting

| Control | Implementation | Status |
|---------|----------------|--------|
| Global API rate limiter | middleware/security.js | Implemented |
| Login rate limiter | middleware/security.js | Implemented |

**Configuration:**
- Global: 1000 requests per 15 minutes
- Login: 20 requests per 15 minutes per IP+username

### 2.4 Input Validation

| Control | Implementation | Status |
|---------|----------------|--------|
| Body sanitization | middleware/security.js | Implemented |
| JSON parse error handling | middleware/security.js | Implemented |
| Request size limits | express.json (10mb) | Implemented |
| Prototype pollution prevention | middleware/security.js | Implemented |

### 2.5 Transport Security

| Control | Implementation | Status |
|---------|----------------|--------|
| Helmet.js | server.js | Implemented |
| CORS | server.js | Configurable |
| Compression | server.js | Implemented |

---

## 3. Security Gaps

### 3.1 Critical Gaps

| Gap | Impact | Risk | Mitigation |
|-----|--------|------|------------|
| AUTH_REQUIRED defaults to false | All routes open by default | HIGH | Change default to true |
| JWT_SECRET defaults to dev-secret | Predictable tokens | HIGH | Require in production |
| Supabase anon key in HTML | Exposed in source | HIGH | Remove from HTML |

### 3.2 Medium Gaps

| Gap | Impact | Risk | Mitigation |
|-----|--------|------|------------|
| No CSRF protection | Cookie-based token vulnerability | MEDIUM | Implement CSRF middleware |
| Open CORS when not configured | Cross-origin attacks | MEDIUM | Default to localhost |
| No input length validation | Potential DoS | MEDIUM | Add per-field validation |

### 3.3 Low Gaps

| Gap | Impact | Risk | Mitigation |
|-----|--------|------|------------|
| Feature flags in localStorage | User can bypass restrictions | LOW | Move to backend |
| No CSP headers | XSS risk | LOW | Add Content-Security-Policy |

---

## 4. Target Security Architecture

### 4.1 Target State

| Control | Current | Target |
|---------|---------|--------|
| AUTH_REQUIRED | false | true |
| JWT_SECRET | dev-secret | (required) |
| CORS_ORIGINS | '' | localhost |
| CSRF | None | Implemented |
| Input validation | Basic | Per-field |
| CSP headers | None | Implemented |

### 4.2 Security Hardening Plan

| Phase | Action | Effort | Risk |
|-------|--------|--------|------|
| Phase 1 | Document AUTH_REQUIRED requirement | Low | Low |
| Phase 2 | Add CSRF protection | Medium | Medium |
| Phase 3 | Default CORS_ORIGINS to localhost | Low | Medium |
| Phase 4 | Remove Supabase keys from HTML | Medium | Low |
| Phase 5 | Add input length validation | Medium | Low |

---

## 5. CSRF Protection Design

### 5.1 CSRF Token Flow

```
Client                          Server
  │                               │
  ├─→ GET /api/v1/csrf-token ────→│
  │                               ├─→ Generate CSRF token
  │←── Set-Cookie: csrf_token ────┤
  │                               │
  ├─→ POST /api/v1/sales ────────→│
  │   X-CSRF-Token: <token>      │
  │   Cookie: csrf_token=<token> │
  │                               ├─→ Validate CSRF token
  │←── 200 OK ───────────────────┤
```

### 5.2 CSRF Implementation

| Component | Description |
|-----------|-------------|
| Token generation | Random 32-byte token |
| Token storage | httpOnly cookie |
| Token validation | Compare header vs cookie |
| Bearer bypass | Skip CSRF for Authorization header |
| Expiry | 1 hour |

---

## 6. Security Controls Matrix

| Control | Backend | Frontend | Status |
|---------|---------|----------|--------|
| JWT auth | middleware/auth.js | backendApi | Implemented |
| Role-based access | middleware/authorize.js | N/A | Implemented |
| Rate limiting | middleware/security.js | N/A | Implemented |
| Body sanitization | middleware/security.js | N/A | Implemented |
| Helmet.js | server.js | N/A | Implemented |
| CORS | server.js | N/A | Configurable |
| CSRF | (not implemented) | (not implemented) | Gap |
| CSP | (not implemented) | (not implemented) | Gap |
| Input validation | middleware/validate.js | N/A | Partial |

---

*Security architecture documentation generated: 2026-08-05*
*Tag: phase23b-stable*
*Commit: e66b6fd*
