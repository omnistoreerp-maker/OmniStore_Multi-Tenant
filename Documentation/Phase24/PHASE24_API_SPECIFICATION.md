# PHASE24_API_SPECIFICATION.md
## DigiTronics V2 Enterprise API Specification

**Date:** 2026-08-05
**Status:** PLANNING ONLY
**Phase:** 24 - API Foundation & Authentication
**Version:** v1

---

## 1. API OVERVIEW

### 1.1 Base URL

| Environment | Base URL |
|-------------|----------|
| Production | `https://api.digitronics.app/api/v1` |
| Staging | `https://staging-api.digitronics.app/api/v1` |
| Development | `http://localhost:3000/api/v1` |

### 1.2 Authentication

All endpoints require JWT token in Authorization header:

```
Authorization: Bearer <access_token>
```

### 1.3 Content Type

All requests/responses use JSON:

```
Content-Type: application/json
```

### 1.4 Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| POST /auth/login | 5 requests | 15 minutes |
| POST /auth/register | 3 requests | 1 hour |
| GET /api/* | 100 requests | 15 minutes |
| POST /api/* | 50 requests | 15 minutes |

---

## 2. AUTHENTICATION ENDPOINTS

### 2.1 POST /auth/login

**Description:** Authenticate user and receive tokens

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "tenant_slug": "company-name"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJSUzI1NiIs...",
    "refresh_token": "eyJhbGciOiJSUzI1NiIs...",
    "token_type": "Bearer",
    "expires_in": 900,
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "John Doe",
      "role": "manager",
      "tenant_id": "uuid"
    }
  }
}
```

**Error (401):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password"
  }
}
```

**Error (429):**
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many login attempts. Please try again later.",
    "retry_after": 900
  }
}
```

---

### 2.2 POST /auth/register

**Description:** Register new user

**Request:**
```json
{
  "email": "newuser@example.com",
  "password": "SecurePassword123!",
  "name": "New User",
  "tenant_slug": "company-name"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "newuser@example.com",
      "name": "New User",
      "role": "viewer"
    },
    "message": "Registration successful. Please verify your email."
  }
}
```

---

### 2.3 POST /auth/refresh

**Description:** Refresh access token

**Request:**
```json
{
  "refresh_token": "eyJhbGciOiJSUzI1NiIs..."
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJSUzI1NiIs...",
    "token_type": "Bearer",
    "expires_in": 900
  }
}
```

---

### 2.4 POST /auth/logout

**Description:** Invalidate refresh token

**Request:**
```json
{
  "refresh_token": "eyJhbGciOiJSUzI1NiIs..."
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

### 2.5 POST /auth/forgot-password

**Description:** Send password reset email

**Request:**
```json
{
  "email": "user@example.com",
  "tenant_slug": "company-name"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "If the email exists, a reset link has been sent"
}
```

---

### 2.6 POST /auth/reset-password

**Description:** Reset password with token

**Request:**
```json
{
  "token": "reset-token-abc123",
  "password": "NewSecurePassword123!"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Password reset successful"
}
```

---

### 2.7 POST /auth/mfa/enable

**Description:** Enable MFA for user

**Request:**
```json
{
  "method": "totp"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "secret": "JBSWY3DPEHPK3PXP",
    "qr_code": "data:image/png;base64,...",
    "backup_codes": ["ABCD-EFGH", "IJKL-MNOP"]
  }
}
```

---

### 2.8 POST /auth/mfa/verify

**Description:** Verify MFA code

**Request:**
```json
{
  "code": "123456"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "MFA verified successfully"
}
```

---

### 2.9 POST /auth/mfa/disable

**Description:** Disable MFA

**Request:**
```json
{
  "password": "SecurePassword123!"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "MFA disabled successfully"
}
```

---

## 3. USER ENDPOINTS

### 3.1 GET /users

**Description:** List all users (tenant-scoped)

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| page | integer | 1 | Page number |
| limit | integer | 10 | Items per page |
| search | string | - | Search by name/email |
| role | string | - | Filter by role |
| status | string | active | Filter by status |

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "name": "John Doe",
      "role": "manager",
      "status": "active",
      "last_login": "2026-08-05T12:00:00Z",
      "created_at": "2026-01-01T00:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 50,
    "totalPages": 5
  }
}
```

---

### 3.2 GET /users/:id

**Description:** Get user by ID

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "manager",
    "status": "active",
    "permissions": ["products:read", "products:write"],
    "tenant_id": "uuid",
    "last_login": "2026-08-05T12:00:00Z",
    "created_at": "2026-01-01T00:00:00Z"
  }
}
```

---

### 3.3 POST /users

**Description:** Create new user

**Request:**
```json
{
  "email": "newuser@example.com",
  "name": "New User",
  "role": "sales",
  "send_invite": true
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "newuser@example.com",
    "name": "New User",
    "role": "sales",
    "status": "pending"
  }
}
```

---

### 3.4 PUT /users/:id

**Description:** Update user

**Request:**
```json
{
  "name": "Updated Name",
  "role": "manager"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "Updated Name",
    "role": "manager"
  }
}
```

---

### 3.5 DELETE /users/:id

**Description:** Delete user (soft delete)

**Response (200):**
```json
{
  "success": true,
  "message": "User deleted successfully"
}
```

---

### 3.6 GET /users/me

**Description:** Get current user profile

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "manager",
    "permissions": ["products:read", "products:write"],
    "tenant": {
      "id": "uuid",
      "name": "Company Name",
      "slug": "company-name"
    }
  }
}
```

---

## 4. TENANT ENDPOINTS

### 4.1 GET /tenants

**Description:** List all tenants (Super Admin only)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Company Name",
      "slug": "company-name",
      "plan": "enterprise",
      "status": "active",
      "user_count": 25,
      "created_at": "2026-01-01T00:00:00Z"
    }
  ]
}
```

---

### 4.2 GET /tenants/:id

**Description:** Get tenant by ID

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Company Name",
    "slug": "company-name",
    "settings": {
      "currency": "USD",
      "timezone": "UTC",
      "language": "en"
    },
    "plan": "enterprise",
    "status": "active",
    "created_at": "2026-01-01T00:00:00Z"
  }
}
```

---

### 4.3 POST /tenants

**Description:** Create new tenant

**Request:**
```json
{
  "name": "New Company",
  "slug": "new-company",
  "plan": "professional",
  "admin_email": "admin@newcompany.com"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "New Company",
    "slug": "new-company",
    "plan": "professional",
    "status": "active"
  }
}
```

---

### 4.4 PUT /tenants/:id

**Description:** Update tenant

**Request:**
```json
{
  "name": "Updated Company Name",
  "settings": {
    "currency": "EUR"
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Updated Company Name",
    "settings": {
      "currency": "EUR"
    }
  }
}
```

---

## 5. ROLE ENDPOINTS

### 5.1 GET /roles

**Description:** List all roles

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "manager",
      "display_name": "Manager",
      "permissions_count": 15,
      "users_count": 5
    }
  ]
}
```

---

### 5.2 GET /roles/:id

**Description:** Get role by ID

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "manager",
    "display_name": "Manager",
    "permissions": [
      "products:read",
      "products:write",
      "invoices:read",
      "invoices:write"
    ],
    "description": "Full access to inventory and sales"
  }
}
```

---

### 5.3 POST /roles

**Description:** Create new role

**Request:**
```json
{
  "name": "custom_role",
  "display_name": "Custom Role",
  "permissions": ["products:read", "invoices:read"],
  "description": "Read-only access to products and invoices"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "custom_role",
    "display_name": "Custom Role",
    "permissions": ["products:read", "invoices:read"]
  }
}
```

---

### 5.4 PUT /roles/:id

**Description:** Update role

**Request:**
```json
{
  "permissions": ["products:read", "products:write", "invoices:read"]
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "custom_role",
    "permissions": ["products:read", "products:write", "invoices:read"]
  }
}
```

---

## 6. PERMISSION ENDPOINTS

### 6.1 GET /permissions

**Description:** List all permissions

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "products:read",
      "resource": "products",
      "action": "read",
      "description": "View products"
    }
  ]
}
```

---

### 6.2 GET /permissions/matrix

**Description:** Get permission matrix

**Response (200):**
```json
{
  "success": true,
  "data": {
    "roles": ["super_admin", "tenant_admin", "manager", "sales"],
    "resources": ["products", "invoices", "users"],
    "matrix": {
      "super_admin": {
        "products": ["read", "write", "delete"],
        "invoices": ["read", "write", "delete"],
        "users": ["read", "write", "delete"]
      },
      "manager": {
        "products": ["read", "write"],
        "invoices": ["read", "write"],
        "users": ["read"]
      }
    }
  }
}
```

---

## 7. AUDIT ENDPOINTS

### 7.1 GET /audit

**Description:** List audit logs

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| page | integer | 1 | Page number |
| limit | integer | 10 | Items per page |
| user_id | string | - | Filter by user |
| action | string | - | Filter by action |
| start_date | string | - | Filter from date |
| end_date | string | - | Filter to date |

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "user_email": "user@example.com",
      "action": "login",
      "resource": "auth",
      "ip_address": "192.168.1.1",
      "user_agent": "Mozilla/5.0...",
      "details": {},
      "created_at": "2026-08-05T12:00:00Z"
    }
  ]
}
```

---

## 8. HEALTH ENDPOINTS

### 8.1 GET /health

**Description:** Health check

**Response (200):**
```json
{
  "status": "healthy",
  "timestamp": "2026-08-05T12:00:00Z",
  "services": {
    "database": "healthy",
    "cache": "healthy"
  },
  "version": "1.0.0"
}
```

---

## 9. ERROR CODES

| Code | Description | HTTP Status |
|------|-------------|-------------|
| VALIDATION_ERROR | Invalid input | 400 |
| UNAUTHORIZED | Not authenticated | 401 |
| FORBIDDEN | Not authorized | 403 |
| NOT_FOUND | Resource not found | 404 |
| CONFLICT | Resource already exists | 409 |
| RATE_LIMIT_EXCEEDED | Too many requests | 429 |
| INTERNAL_ERROR | Server error | 500 |
| SERVICE_UNAVAILABLE | Service unavailable | 503 |

---

## 10. PAGINATION

### 10.1 Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| page | integer | 1 | Page number |
| limit | integer | 10 | Items per page |
| sort | string | created_at | Sort field |
| order | string | desc | Sort order (asc/desc) |

### 10.2 Response Meta

```json
{
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "totalPages": 10
  }
}
```

---

## 11. FILTERING

### 11.1 Query Parameters

| Parameter | Operator | Example |
|-----------|----------|---------|
| search | LIKE | `?search=john` |
| status | EQUALS | `?status=active` |
| role | EQUALS | `?role=manager` |
| created_after | GREATER_THAN | `?created_after=2026-01-01` |
| created_before | LESS_THAN | `?created_before=2026-12-31` |

---

## 12. SORTING

### 12.1 Query Parameters

| Parameter | Example |
|-----------|---------|
| sort | `?sort=name` |
| order | `?order=asc` |

### 12.2 Supported Sort Fields

- created_at
- updated_at
- name
- email
- role

---

## 13. SEARCH

### 13.1 Full-Text Search

| Endpoint | Search Fields |
|----------|---------------|
| GET /users | name, email |
| GET /tenants | name, slug |
| GET /roles | name, display_name |

---

## 14. WEBHOOKS

### 14.1 Webhook Events

| Event | Description |
|-------|-------------|
| user.created | User created |
| user.updated | User updated |
| user.deleted | User deleted |
| tenant.created | Tenant created |
| tenant.updated | Tenant updated |
| role.created | Role created |
| role.updated | Role updated |

### 14.2 Webhook Payload

```json
{
  "event": "user.created",
  "timestamp": "2026-08-05T12:00:00Z",
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

---

## 15. SDK STRATEGY

### 15.1 Supported SDKs

| SDK | Language | Status |
|-----|----------|--------|
| @digitronics/sdk | JavaScript/TypeScript | Phase 24 |
| digitronics-python | Python | Phase 31 |
| digitronics-go | Go | Phase 31 |

### 15.2 SDK Usage

```javascript
import { DigiTronics } from '@digitronics/sdk';

const client = new DigiTronics({
  apiKey: 'your-api-key',
  tenant: 'your-tenant'
});

const users = await client.users.list();
```
