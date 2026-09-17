# PHASE24_API_CHANGELOG_PLAN.md
## Phase 24 API Changelog

**Date:** 2026-08-05
**Status:** READY FOR IMPLEMENTATION
**Gate:** C0

---

## 1. NEW ENDPOINTS

### 1.1 Authentication — OAuth2

| Method | Endpoint | Auth | Description | Version |
|--------|----------|------|-------------|---------|
| GET | /auth/google | None | Initiate Google OAuth | v1 |
| GET | /auth/google/callback | OAuth | Google OAuth callback | v1 |
| GET | /auth/github | None | Initiate GitHub OAuth | v1 |
| GET | /auth/github/callback | OAuth | GitHub OAuth callback | v1 |

### 1.2 Authentication — MFA

| Method | Endpoint | Auth | Description | Version |
|--------|----------|------|-------------|---------|
| POST | /auth/mfa/enable | JWT | Enable TOTP MFA for user | v1 |
| POST | /auth/mfa/verify | Temp Token | Verify MFA code during login | v1 |
| POST | /auth/mfa/disable | JWT | Disable MFA for user | v1 |
| GET | /auth/mfa/backup-codes | JWT | Get backup codes for user | v1 |

### 1.3 API Keys

| Method | Endpoint | Auth | Description | Version |
|--------|----------|------|-------------|---------|
| GET | /api-keys | JWT | List all API keys for user | v1 |
| POST | /api-keys | JWT | Create new API key | v1 |
| DELETE | /api-keys/:id | JWT | Revoke API key | v1 |
| PUT | /api-keys/:id | JWT | Update API key metadata | v1 |

### 1.4 Webhooks

| Method | Endpoint | Auth | Description | Version |
|--------|----------|------|-------------|---------|
| GET | /webhooks | JWT | List all webhooks | v1 |
| POST | /webhooks | JWT | Create webhook subscription | v1 |
| DELETE | /webhooks/:id | JWT | Delete webhook | v1 |
| POST | /webhooks/:id/test | JWT | Test webhook delivery | v1 |

### 1.5 Service Accounts

| Method | Endpoint | Auth | Description | Version |
|--------|----------|------|-------------|---------|
| GET | /service-accounts | JWT | List service accounts | v1 |
| POST | /service-accounts | JWT | Create service account | v1 |
| DELETE | /service-accounts/:id | JWT | Delete service account | v1 |

### 1.6 Monitoring & Health

| Method | Endpoint | Auth | Description | Version |
|--------|----------|------|-------------|---------|
| GET | /metrics | None | Prometheus metrics | v1 |
| GET | /health | None | Health check | v1 |
| GET | /health/ready | None | Readiness probe | v1 |
| GET | /health/live | None | Liveness probe | v1 |

### 1.7 Documentation

| Method | Endpoint | Auth | Description | Version |
|--------|----------|------|-------------|---------|
| GET | /api-docs | None | Swagger UI | v1 |
| GET | /api-docs.json | None | OpenAPI JSON spec | v1 |

---

## 2. CHANGED ENDPOINTS

### 2.1 Login Flow

| Endpoint | Change | Backward Compatible | Migration |
|----------|--------|---------------------|-----------|
| POST /auth/login | Add MFA step | YES | Optional — MFA only triggers if user has MFA enabled |

**Before:**
```json
POST /auth/login
Request: { "email": "...", "password": "..." }
Response: { "token": "...", "user": {...} }
```

**After:**
```json
POST /auth/login
Request: { "email": "...", "password": "..." }

Response (no MFA):
  { "token": "...", "user": {...} }

Response (MFA required):
  { "mfa_required": true, "temp_token": "...", "user_id": "..." }

POST /auth/mfa/verify
Request: { "temp_token": "...", "code": "123456" }
Response: { "token": "...", "user": {...} }
```

---

## 3. DEPRECATED ENDPOINTS

| Endpoint | Deprecated | Replacement | Removal Date |
|----------|------------|-------------|--------------|
| None | — | — | — |

**Note:** No existing endpoints are deprecated in Phase 24. All changes are additive.

---

## 4. VERSIONING STRATEGY

### 4.1 Version Detection

| Method | Priority | Example |
|--------|----------|---------|
| URL Path | 1 | /api/v1/products |
| Header | 2 | Accept-Version: v1 |
| Query Parameter | 3 | ?version=v1 |
| Default | — | v1 |

### 4.2 Version Support

| Version | Status | Support |
|---------|--------|---------|
| v1 | CURRENT | Full support |
| v2 | PLANNED | Future development |

### 4.3 Backward Compatibility Rules

| Rule | Description |
|------|-------------|
| No breaking changes | v1 endpoints always work |
| Additive only | New fields never break existing consumers |
| Deprecation notice | 6 months before removal |
| Default version | Always falls back to v1 |

---

## 5. NEW REQUEST/RESPONSE SCHEMAS

### 5.1 OAuth Login

**GET /auth/google**
```yaml
Response: Redirect to Google OAuth consent screen
```

**GET /auth/google/callback**
```yaml
Query Parameters:
  code: string (OAuth authorization code)
  state: string (CSRF protection)

Response (success):
  Content-Type: application/json
  Body:
    token: string (JWT)
    user:
      id: string
      email: string
      name: string
      role: string

Response (error):
  Status: 302
  Location: /login?error=oauth_failed
```

### 5.2 MFA Enable

**POST /auth/mfa/enable**
```yaml
Headers:
  Authorization: Bearer <jwt_token>

Response:
  Status: 200
  Body:
    secret: string (TOTP secret for QR code)
    qr_code: string (data:image/png;base64,...)
    backup_codes: array of string
```

### 5.3 MFA Verify

**POST /auth/mfa/verify**
```yaml
Request:
  Body:
    temp_token: string (from login response)
    code: string (6-digit TOTP code)

Response (success):
  Status: 200
  Body:
    token: string (JWT)
    user:
      id: string
      email: string
      name: string
      role: string

Response (invalid code):
  Status: 401
  Body:
    error: "Invalid MFA code"
```

### 5.4 API Key Create

**POST /api-keys**
```yaml
Headers:
  Authorization: Bearer <jwt_token>

Request:
  Body:
    name: string
    permissions: array of string
    expires_in: number (seconds, optional)

Response:
  Status: 201
  Body:
    id: string
    name: string
    key: string (ONLY DISPLAYED ONCE)
    prefix: string (first 8 chars)
    permissions: array of string
    created_at: datetime
    expires_at: datetime (optional)
```

### 5.5 Webhook Create

**POST /webhooks**
```yaml
Headers:
  Authorization: Bearer <jwt_token>

Request:
  Body:
    url: string (HTTPS required)
    events: array of string
    secret: string (for signature verification)

Response:
  Status: 201
  Body:
    id: string
    url: string
    events: array of string
    secret: string (hashed)
    active: boolean
    created_at: datetime
```

### 5.6 Health Check

**GET /health**
```yaml
Response:
  Status: 200
  Body:
    status: "healthy"
    version: string
    uptime: number
    timestamp: datetime
```

### 5.7 Metrics

**GET /metrics**
```yaml
Response:
  Content-Type: text/plain
  Body: Prometheus exposition format

  # HELP http_requests_total Total HTTP requests
  # TYPE http_requests_total counter
  http_requests_total{method="GET",route="/api/products",status="200"} 1234
```

---

## 6. ERROR RESPONSE STANDARDS

### 6.1 Standard Error Format

```json
{
  "error": {
    "code": "MFA_CODE_INVALID",
    "message": "The provided MFA code is invalid",
    "details": {
      "attempts_remaining": 3
    }
  }
}
```

### 6.2 New Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| MFA_REQUIRED | 200 | MFA verification needed (with temp_token) |
| MFA_CODE_INVALID | 401 | Invalid MFA code |
| MFA_CODE_EXPIRED | 401 | MFA code expired |
| MFA_ALREADY_ENABLED | 409 | MFA already enabled for user |
| MFA_NOT_ENABLED | 400 | MFA not enabled for user |
| API_KEY_INVALID | 401 | Invalid API key |
| API_KEY_EXPIRED | 401 | API key expired |
| API_KEY_REVOKED | 401 | API key revoked |
| WEBHOOK_URL_INVALID | 400 | Webhook URL must be HTTPS |
| WEBHOOK_SECRET_REQUIRED | 400 | Webhook secret is required |
| OAUTH_PROVIDER_ERROR | 502 | OAuth provider returned error |
| OAUTH_EMAIL_CONFLICT | 409 | Email already exists with different auth method |

---

## 7. RATE LIMITING

### 7.1 New Rate Limits

| Endpoint | Limit | Window | Scope |
|----------|-------|--------|-------|
| POST /auth/login | 5 | 15 min | IP |
| POST /auth/mfa/verify | 5 | 15 min | User |
| GET /auth/google | 10 | 15 min | IP |
| POST /api-keys | 10 | 1 hour | User |
| POST /webhooks | 10 | 1 hour | User |
| GET /metrics | 60 | 1 min | IP |
| GET /health | 60 | 1 min | IP |

---

## 8. BACKWARD COMPATIBILITY MATRIX

| Consumer Type | Impact | Action Required |
|---------------|--------|-----------------|
| Existing API consumers | NONE | No changes required |
| Existing web app | NONE | Frontend changes are optional |
| Existing mobile app | NONE | Can ignore new endpoints |
| New integrations | POSITIVE | Use new API key auth |
| External webhooks | POSITIVE | Subscribe to webhook events |

---

## 9. MIGRATION GUIDE

### 9.1 For Existing Users

| Step | Action | Required |
|------|--------|----------|
| 1 | Continue using email/password login | NO |
| 2 | Optionally enable MFA in settings | NO |
| 3 | Optionally link OAuth providers | NO |
| 4 | Create API keys for integrations | NO |

### 9.2 For New Integrations

| Step | Action | Required |
|------|--------|----------|
| 1 | Create API key via /api-keys | YES |
| 2 | Use X-API-Key header for authentication | YES |
| 3 | Subscribe to webhooks for event notifications | NO |
| 4 | Use versioned endpoints (/api/v1/*) | YES |

---

**Document Generated:** 2026-08-05
