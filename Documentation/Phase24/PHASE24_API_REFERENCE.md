# DigiTronics V2 API Reference

**Version:** 2.0.0  
**Date:** 2026-08-05  
**Status:** Gate C3 Complete — OpenAPI & API Contract Certification

---

## Overview

The DigiTronics V2 API is a RESTful API built with Express.js. All endpoints return JSON responses and follow a consistent response format.

### Base URLs

| Environment | URL |
|-------------|-----|
| Development | `http://localhost:3001` |
| Production | `https://api.digitronics.com` |
| Swagger UI | `http://localhost:3001/api-docs` |
| OpenAPI Spec | `http://localhost:3001/api-docs.json` |

### Authentication

| Method | Header | Description |
|--------|--------|-------------|
| JWT Bearer | `Authorization: Bearer <token>` | Standard JWT authentication |
| OAuth2 | Session-based | Google/GitHub OAuth2 providers |
| API Key | `X-API-Key: <key>` | Service integrations (planned) |

### Rate Limiting

| Endpoint Type | Limit | Window |
|---------------|-------|--------|
| General API | 1000 requests | 15 minutes |
| Login | 20 requests | 15 minutes |
| MFA | 5 requests | 15 minutes |

### Standard Error Format

```json
{
  "success": false,
  "error": "Error message",
  "data": null
}
```

---

## Endpoint Summary

| Category | Endpoints | Operations |
|----------|-----------|------------|
| Health | 3 | 3 |
| Authentication | 6 | 6 |
| MFA | 6 | 6 |
| OAuth2 | 5 | 5 |
| Users | 3 | 6 |
| Sales | 3 | 6 |
| Purchases | 3 | 6 |
| Inventory | 3 | 6 |
| Inventory Transactions | 3 | 6 |
| Customers | 3 | 6 |
| Suppliers | 3 | 6 |
| Treasury | 3 | 6 |
| Employees | 3 | 6 |
| Partners | 3 | 6 |
| Vouchers | 3 | 6 |
| Dashboard | 3 | 6 |
| Reports | 3 | 6 |
| **Total** | **59** | **98** |

---

## Health Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Service health status |
| GET | `/api/v1/liveness` | Process liveness probe |
| GET | `/api/v1/ready` | Service readiness probe |

---

## Authentication Endpoints

| Method | Path | Description | Auth Required |
|--------|------|-------------|---------------|
| POST | `/api/v1/auth/login` | User login | No |
| POST | `/api/v1/auth/refresh` | Refresh access token | No |
| POST | `/api/v1/auth/logout` | User logout | No |
| GET | `/api/v1/auth/me` | Get current user | Yes |
| GET | `/api/v1/auth/roles` | Get available roles | No |
| GET | `/api/v1/auth/permissions` | Get user permissions | Yes |

### Login Request

```json
POST /api/v1/auth/login
{
  "username": "admin",
  "password": "password123",
  "mfaToken": "123456"  // Optional, required if MFA enabled
}
```

### Login Response

```json
{
  "success": true,
  "data": {
    "user": { "id": "...", "username": "admin", "role": "Owner" },
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

### MFA Required Response

```json
{
  "success": true,
  "data": {
    "mfaRequired": true,
    "tempToken": "...",
    "userId": "..."
  }
}
```

---

## MFA Endpoints

All MFA endpoints require JWT authentication.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/mfa/enable` | Enable MFA |
| POST | `/api/v1/auth/mfa/disable` | Disable MFA |
| POST | `/api/v1/auth/mfa/verify` | Verify TOTP code |
| GET | `/api/v1/auth/mfa/secret` | Get MFA secret + QR code |
| GET | `/api/v1/auth/mfa/status` | Get MFA status |
| POST | `/api/v1/auth/mfa/backup-codes` | Generate new backup codes |

---

## OAuth2 Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/providers` | List available OAuth providers |
| GET | `/auth/google` | Initiate Google OAuth |
| GET | `/auth/google/callback` | Google OAuth callback |
| GET | `/auth/github` | Initiate GitHub OAuth |
| GET | `/auth/github/callback` | GitHub OAuth callback |

---

## CRUD Resource Endpoints

All resource endpoints follow a standard CRUD pattern. Each resource supports:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/{resource}` | List items (paginated) |
| GET | `/api/v1/{resource}/stats` | Get statistics |
| GET | `/api/v1/{resource}/:id` | Get item by ID |
| POST | `/api/v1/{resource}` | Create item |
| PUT | `/api/v1/{resource}/:id` | Update item |
| DELETE | `/api/v1/{resource}/:id` | Delete item |

### Resources

| Resource | Path | Tags |
|----------|------|------|
| Users | `/api/v1/users` | Users |
| Sales | `/api/v1/sales` | Sales |
| Purchases | `/api/v1/purchases` | Purchases |
| Inventory | `/api/v1/inventory` | Inventory |
| Inventory Transactions | `/api/v1/inventory-transactions` | InventoryTransactions |
| Customers | `/api/v1/customers` | Customers |
| Suppliers | `/api/v1/suppliers` | Suppliers |
| Treasury | `/api/v1/treasury` | Treasury |
| Employees | `/api/v1/employees` | Employees |
| Partners | `/api/v1/partners` | Partners |
| Vouchers | `/api/v1/vouchers` | Vouchers |
| Dashboard | `/api/v1/dashboard` | Dashboard |
| Reports | `/api/v1/reports` | Reports |

### Common Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Full-text search |
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Items per page (default: 50) |

### Standard List Response

```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 50,
    "totalPages": 2
  }
}
```

---

## Interactive Documentation

Access the Swagger UI at: `http://localhost:3001/api-docs`

The raw OpenAPI 3.1 specification is available at: `http://localhost:3001/api-docs.json`

---

*Generated by Phase 24 Gate C3 — OpenAPI & API Contract Certification*
