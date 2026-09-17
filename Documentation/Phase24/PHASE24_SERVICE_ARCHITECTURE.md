# PHASE24_SERVICE_ARCHITECTURE.md
## DigiTronics V2 Enterprise Service Architecture

**Date:** 2026-08-05
**Status:** PLANNING ONLY
**Phase:** 24 - API Foundation & Authentication

---

## 1. SERVICE OVERVIEW

### 1.1 Current State

| Component | Current | Target |
|-----------|---------|--------|
| Architecture | Monolithic | Modular monolith |
| Services | None | Service layer |
| Communication | Direct calls | Service methods |
| Testing | None | Unit + integration |

### 1.2 Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     API GATEWAY                             │
├─────────────────────────────────────────────────────────────┤
│  Rate Limiter  │  Auth Middleware  │  Validator             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     ROUTE LAYER                             │
├─────────────────────────────────────────────────────────────┤
│  Auth Routes  │  User Routes  │  Tenant Routes             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     CONTROLLER LAYER                        │
├─────────────────────────────────────────────────────────────┤
│  Auth Controller  │  User Controller  │  Tenant Controller  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     SERVICE LAYER                           │
├─────────────────────────────────────────────────────────────┤
│  Auth Service  │  User Service  │  Tenant Service           │
│  Permission Service  │  Audit Service                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     DATA LAYER                              │
├─────────────────────────────────────────────────────────────┤
│  Repository Layer  │  Database Client  │  Cache Client      │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. SERVICE DEFINITIONS

### 2.1 Auth Service

**Responsibility:** Authentication, authorization, token management

**Methods:**
```javascript
class AuthService {
  async login(email, password, tenantSlug) {}
  async register(data) {}
  async logout(refreshToken) {}
  async refreshToken(refreshToken) {}
  async forgotPassword(email, tenantSlug) {}
  async resetPassword(token, password) {}
  async enableMFA(userId) {}
  async verifyMFA(userId, code) {}
  async disableMFA(userId) {}
}
```

### 2.2 User Service

**Responsibility:** User CRUD, profiles, settings

**Methods:**
```javascript
class UserService {
  async list(filters) {}
  async getById(id) {}
  async create(data) {}
  async update(id, data) {}
  async delete(id) {}
  async getProfile(userId) {}
  async updateProfile(userId, data) {}
}
```

### 2.3 Tenant Service

**Responsibility:** Tenant management, settings

**Methods:**
```javascript
class TenantService {
  async list() {}
  async getById(id) {}
  async create(data) {}
  async update(id, data) {}
  async delete(id) {}
  async getSettings(tenantId) {}
  async updateSettings(tenantId, settings) {}
}
```

### 2.4 Permission Service

**Responsibility:** Role and permission management

**Methods:**
```javascript
class PermissionService {
  async listRoles() {}
  async getRoleById(id) {}
  async createRole(data) {}
  async updateRole(id, data) {}
  async deleteRole(id) {}
  async listPermissions() {}
  async getPermissionMatrix() {}
}
```

### 2.5 Audit Service

**Responsibility:** Audit logging, compliance

**Methods:**
```javascript
class AuditService {
  async log(event) {}
  async list(filters) {}
  async getById(id) {}
  async export(filters) {}
}
```

---

## 3. MIDDLEWARE ARCHITECTURE

### 3.1 Middleware Stack

```javascript
// Request pipeline
app.use(helmet());                    // Security headers
app.use(cors());                      // CORS
app.use(express.json());              // Body parsing
app.use(rateLimiter);                 // Rate limiting
app.use(authenticate);                // JWT validation
app.use(tenantIsolation);             // Tenant scoping
app.use(permissionCheck);             // Permission validation
```

### 3.2 Middleware Definitions

| Middleware | Purpose | Priority |
|------------|---------|----------|
| helmet | Security headers | 1 |
| cors | Cross-origin | 2 |
| express.json | Body parsing | 3 |
| rateLimiter | Rate limiting | 4 |
| authenticate | JWT validation | 5 |
| tenantIsolation | Tenant scoping | 6 |
| permissionCheck | Permission validation | 7 |

---

## 4. REPOSITORY PATTERN

### 4.1 Repository Interface

```javascript
class BaseRepository {
  async findAll(filters) {}
  async findById(id) {}
  async create(data) {}
  async update(id, data) {}
  async delete(id) {}
  async count(filters) {}
}
```

### 4.2 Repository Implementations

| Repository | Table | Key Fields |
|------------|-------|------------|
| UserRepository | users | id, email, tenant_id |
| TenantRepository | tenants | id, slug |
| RoleRepository | roles | id, name |
| PermissionRepository | permissions | id, name |

---

## 5. ERROR HANDLING

### 5.1 Error Classes

```javascript
class AppError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

class ValidationError extends AppError { }
class AuthenticationError extends AppError { }
class AuthorizationError extends AppError { }
class NotFoundError extends AppError { }
class ConflictError extends AppError { }
```

### 5.2 Error Handler Middleware

```javascript
const errorHandler = (err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message
      }
    });
  }
  
  // Unexpected error
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred'
    }
  });
};
```

---

## 6. VALIDATION

### 6.1 Validation Library

**Decision:** Joi
- **Reason:** Comprehensive, well-documented
- **Alternative:** Zod (newer, TypeScript-first)
- **Trade-off:** Joi is more mature
- **Long-term:** Consider Zod migration

### 6.2 Validation Schemas

```javascript
const schemas = {
  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(12).required(),
    tenant_slug: Joi.string().required()
  }),
  
  register: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(12).required(),
    name: Joi.string().min(2).max(100).required(),
    tenant_slug: Joi.string().required()
  }),
  
  user: Joi.object({
    email: Joi.string().email().required(),
    name: Joi.string().min(2).max(100).required(),
    role: Joi.string().valid(
      'super_admin', 'tenant_admin', 'manager',
      'sales', 'warehouse', 'accountant',
      'support', 'viewer'
    ).required()
  })
};
```

---

## 7. LOGGING

### 7.1 Logger Configuration

```javascript
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
```

### 7.2 Log Levels

| Level | Use Case |
|-------|----------|
| error | Application errors |
| warn | Potential issues |
| info | Request/response |
| debug | Development |

---

## 8. TESTING

### 8.1 Test Structure

```
tests/
├── unit/
│   ├── services/
│   ├── repositories/
│   └── middleware/
├── integration/
│   ├── auth/
│   ├── users/
│   └── tenants/
└── e2e/
    └── api/
```

### 8.2 Test Coverage Targets

| Component | Target |
|-----------|--------|
| Services | 90% |
| Repositories | 80% |
| Middleware | 90% |
| Routes | 80% |

---

## 9. PERFORMANCE

### 9.1 Caching Strategy

| Cache | TTL | Invalidation |
|-------|-----|--------------|
| User permissions | 5 min | Role change |
| Role permissions | 10 min | Role update |
| Tenant settings | 15 min | Tenant update |

### 9.2 Connection Pooling

| Pool | Size | Timeout |
|------|------|---------|
| Database | 20 | 30s |
| Redis | 10 | 5s |

---

## 10. MONITORING

### 10.1 Health Checks

| Check | Endpoint | Interval |
|-------|----------|----------|
| Database | /health/db | 30s |
| Redis | /health/redis | 30s |
| API | /health | 10s |

### 10.2 Metrics

| Metric | Type | Description |
|--------|------|-------------|
| service_requests_total | Counter | Total requests |
| service_request_duration | Histogram | Request duration |
| service_errors_total | Counter | Total errors |
| service_db_queries_total | Counter | DB queries |
