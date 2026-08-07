# PHASE24_AUTHENTICATION_DESIGN.md
## DigiTronics V2 Enterprise Authentication Design

**Date:** 2026-08-05
**Status:** PLANNING ONLY
**Phase:** 24 - API Foundation & Authentication

---

## 1. AUTHENTICATION OVERVIEW

### 1.1 Current State

| Aspect | Current | Target |
|--------|---------|--------|
| Method | Plaintext password | bcrypt + JWT |
| Storage | localStorage | HttpOnly cookie |
| Validation | Client-side only | Server-side |
| MFA | None | TOTP/SMS |
| Session | localStorage | Redis |

### 1.2 Authentication Methods

| Method | Use Case | Priority |
|--------|----------|----------|
| Email/Password | Primary login | HIGH |
| MFA (TOTP) | Additional security | HIGH |
| API Keys | Service integration | MEDIUM |
| OAuth2 | Third-party login | MEDIUM |
| Biometric | Mobile only | LOW |

---

## 2. AUTHENTICATION FLOWS

### 2.1 Email/Password Login

```
┌─────────────────────────────────────────────────────────────┐
│                     LOGIN FLOW                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Client → POST /auth/login                               │
│     { email, password, tenant_slug }                        │
│                                                             │
│  2. API Gateway → Rate limit check                          │
│                                                             │
│  3. Auth Service → Validate credentials                     │
│     a. Find user by email                                   │
│     b. Compare password with bcrypt                         │
│     c. Check tenant membership                              │
│     d. Check MFA status                                     │
│                                                             │
│  4. If MFA required → Return temp_token                     │
│     → Client → POST /auth/mfa/verify                        │
│     → Auth Service → Verify TOTP code                       │
│                                                             │
│  5. Generate JWT tokens                                     │
│     a. Access token (15 min)                                │
│     b. Refresh token (7 days)                               │
│                                                             │
│  6. Store refresh token in Redis                            │
│                                                             │
│  7. Return tokens + user info                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Token Refresh Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     TOKEN REFRESH                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Client → POST /auth/refresh                             │
│     { refresh_token }                                       │
│                                                             │
│  2. Auth Service → Validate refresh token                   │
│     a. Check JWT signature                                  │
│     b. Check expiration                                     │
│     c. Check Redis store                                    │
│                                                             │
│  3. Generate new access token                               │
│                                                             │
│  4. Return new access token                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Logout Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     LOGOUT FLOW                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Client → POST /auth/logout                              │
│     { refresh_token }                                       │
│                                                             │
│  2. Auth Service → Invalidate refresh token                 │
│     a. Remove from Redis                                    │
│     b. Add access token to blacklist                        │
│                                                             │
│  3. Clear cookies                                           │
│                                                             │
│  4. Return success                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.4 Password Reset Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     PASSWORD RESET                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Client → POST /auth/forgot-password                     │
│     { email, tenant_slug }                                  │
│                                                             │
│  2. Auth Service → Generate reset token                     │
│     a. Create token (1 hour expiry)                         │
│     b. Store in Redis                                       │
│                                                             │
│  3. Send email with reset link                              │
│     → https://app.digitronics.app/reset?token=xxx           │
│                                                             │
│  4. Client → POST /auth/reset-password                      │
│     { token, password }                                     │
│                                                             │
│  5. Auth Service → Validate token                           │
│     a. Check expiration                                     │
│     b. Hash new password                                    │
│     c. Update user                                          │
│     d. Invalidate all refresh tokens                        │
│                                                             │
│  6. Return success                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. JWT TOKEN DESIGN

### 3.1 Access Token

```json
{
  "header": {
    "alg": "RS256",
    "typ": "JWT",
    "kid": "key-id-2026-08"
  },
  "payload": {
    "sub": "user-uuid-123",
    "email": "user@example.com",
    "name": "John Doe",
    "tenant_id": "tenant-uuid-456",
    "tenant_slug": "company-name",
    "role": "manager",
    "permissions": [
      "products:read",
      "products:write",
      "invoices:read",
      "invoices:write"
    ],
    "mfa_verified": true,
    "iat": 1691234567,
    "exp": 1691238167,
    "iss": "digitronics",
    "aud": "digitronics-api"
  }
}
```

### 3.2 Refresh Token

```json
{
  "header": {
    "alg": "RS256",
    "typ": "JWT",
    "kid": "key-id-2026-08"
  },
  "payload": {
    "sub": "user-uuid-123",
    "tenant_id": "tenant-uuid-456",
    "token_id": "refresh-token-uuid",
    "iat": 1691234567,
    "exp": 1691839367,
    "iss": "digitronics"
  }
}
```

### 3.3 Token Storage

| Token | Storage | Security |
|-------|---------|----------|
| Access Token | Memory | In-memory only |
| Refresh Token | HttpOnly cookie | Secure, SameSite=Strict |
| MFA Token | Memory | In-memory only |

### 3.4 Token Rotation

| Event | Action |
|-------|--------|
| Access token expiry | Use refresh token |
| Refresh token use | Issue new refresh token |
| Password change | Invalidate all refresh tokens |
| MFA enable/disable | Invalidate all refresh tokens |

---

## 4. PASSWORD SECURITY

### 4.1 Password Hashing

| Algorithm | Cost Factor | Purpose |
|-----------|-------------|---------|
| bcrypt | 12 | Password hashing |

**Decision:** bcrypt over argon2
- **Reason:** Better library support, proven security
- **Alternative:** argon2 (newer, memory-hard)
- **Trade-off:** bcrypt is more battle-tested
- **Long-term:** Consider argon2 migration

### 4.2 Password Policy

| Rule | Requirement |
|------|-------------|
| Minimum length | 12 characters |
| Maximum length | 128 characters |
| Uppercase | At least 1 |
| Lowercase | At least 1 |
| Number | At least 1 |
| Special character | At least 1 |
| Common passwords | Reject top 100,000 |
| Breached passwords | Check HaveIBeenPwned |
| History | Last 5 passwords |
| Expiry | 90 days |

### 4.3 Password Validation

```javascript
const passwordSchema = Joi.string()
  .min(12)
  .max(128)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{12,}$/)
  .custom((value, helpers) => {
    // Check common passwords
    if (commonPasswords.includes(value.toLowerCase())) {
      return helpers.error('password.common');
    }
    return value;
  });
```

---

## 5. MULTI-FACTOR AUTHENTICATION

### 5.1 MFA Methods

| Method | Priority | Use Case |
|--------|----------|----------|
| TOTP | HIGH | Primary MFA |
| SMS | MEDIUM | Backup method |
| Email | LOW | Backup method |

### 5.2 TOTP Implementation

**Decision:** TOTP over SMS
- **Reason:** No SMS costs, works offline, more secure
- **Alternative:** SMS-based OTP
- **Trade-off:** SMS is simpler but less secure
- **Long-term:** Support both TOTP and SMS

### 5.3 TOTP Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     TOTP SETUP                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. User → Enable MFA                                       │
│                                                             │
│  2. Server → Generate secret (32 bytes)                     │
│                                                             │
│  3. Server → Create QR code                                 │
│     otpauth://totp/DigiTronics:user@example.com?secret=xxx  │
│                                                             │
│  4. User → Scan QR with authenticator app                   │
│                                                             │
│  5. User → Enter 6-digit code                               │
│                                                             │
│  6. Server → Verify code                                    │
│                                                             │
│  7. Server → Generate backup codes (10)                     │
│                                                             │
│  8. Server → Enable MFA for user                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.4 Backup Codes

| Property | Value |
|----------|-------|
| Count | 10 |
| Length | 8 characters |
| Format | XXXX-XXXX |
| Storage | bcrypt hashed |
| Usage | Single use |

---

## 6. API KEYS

### 6.1 API Key Types

| Type | Use Case | Permissions |
|------|----------|-------------|
| Read-only | Integrations | Read only |
| Read-write | Full access | Read + Write |
| Admin | Service accounts | All permissions |

### 6.2 API Key Format

```
digi_live_abc123def456ghi789
```

### 6.3 API Key Storage

| Aspect | Implementation |
|--------|----------------|
| Format | Prefixed string |
| Hashing | SHA-256 |
| Storage | Database only |
| Transmission | Header: X-API-Key |

---

## 7. SESSION MANAGEMENT

### 7.1 Session Store

**Decision:** Redis for session storage
- **Reason:** Fast, supports TTL, pub/sub for invalidation
- **Alternative:** Database sessions
- **Trade-off:** Redis requires infrastructure
- **Long-term:** Consider distributed Redis

### 7.2 Session Data

```json
{
  "session_id": "uuid",
  "user_id": "uuid",
  "tenant_id": "uuid",
  "ip_address": "192.168.1.1",
  "user_agent": "Mozilla/5.0...",
  "created_at": "2026-08-05T12:00:00Z",
  "expires_at": "2026-08-12T12:00:00Z",
  "last_active": "2026-08-05T13:00:00Z"
}
```

### 7.3 Session Limits

| Limit | Value |
|-------|-------|
| Max sessions per user | 5 |
| Session timeout | 7 days |
| Idle timeout | 30 minutes |

---

## 8. OAUTH2 SUPPORT

### 8.1 Supported Providers

| Provider | Priority | Use Case |
|----------|----------|----------|
| Google | HIGH | SSO |
| GitHub | MEDIUM | Developer login |
| Microsoft | MEDIUM | Enterprise SSO |

### 8.2 OAuth2 Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     OAUTH2 FLOW                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Client → Redirect to provider                           │
│     /auth/google?redirect_uri=xxx                           │
│                                                             │
│  2. User → Authenticate with provider                       │
│                                                             │
│  3. Provider → Redirect back with code                      │
│     /auth/callback?code=xxx&state=xxx                       │
│                                                             │
│  4. Server → Exchange code for tokens                       │
│                                                             │
│  5. Server → Get user info from provider                    │
│                                                             │
│  6. Server → Find or create user                            │
│                                                             │
│  7. Server → Generate JWT tokens                            │
│                                                             │
│  8. Server → Redirect to app with tokens                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. DEVICE AUTHENTICATION

### 9.1 Device Types

| Type | Trust Level | MFA Required |
|------|-------------|--------------|
| Web | Medium | Every 7 days |
| Mobile | High | Every 30 days |
| Desktop | High | Every 30 days |
| API | Low | Every request |

### 9.2 Device Registration

```json
{
  "device_id": "uuid",
  "user_id": "uuid",
  "type": "web",
  "name": "Chrome on Windows",
  "ip_address": "192.168.1.1",
  "user_agent": "Mozilla/5.0...",
  "last_active": "2026-08-05T12:00:00Z",
  "trusted": true
}
```

---

## 10. RATE LIMITING

### 10.1 Rate Limit Rules

| Endpoint | Limit | Window | Action |
|----------|-------|--------|--------|
| POST /auth/login | 5 | 15 minutes | Block IP |
| POST /auth/register | 3 | 1 hour | Block IP |
| POST /auth/forgot-password | 3 | 1 hour | Block IP |
| POST /auth/mfa/verify | 5 | 15 minutes | Block user |
| GET /api/* | 100 | 15 minutes | Throttle |
| POST /api/* | 50 | 15 minutes | Throttle |

### 10.2 Rate Limit Response

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "retry_after": 900
  }
}
```

---

## 11. AUDIT LOGGING

### 11.1 Auth Events to Log

| Event | Level | Details |
|-------|-------|---------|
| login_success | INFO | user_id, ip, user_agent |
| login_failure | WARN | email, reason, ip |
| logout | INFO | user_id, ip |
| password_change | INFO | user_id, ip |
| password_reset_request | INFO | email, ip |
| password_reset_complete | INFO | user_id, ip |
| mfa_enable | INFO | user_id, ip |
| mfa_disable | INFO | user_id, ip |
| mfa_failure | WARN | user_id, ip |
| token_refresh | INFO | user_id |
| token_revoke | INFO | user_id |

### 11.2 Log Format

```json
{
  "timestamp": "2026-08-05T12:00:00Z",
  "level": "INFO",
  "event": "login_success",
  "user_id": "uuid",
  "tenant_id": "uuid",
  "ip_address": "192.168.1.1",
  "user_agent": "Mozilla/5.0...",
  "details": {
    "method": "password",
    "mfa_used": true
  }
}
```

---

## 12. SECURITY CONSIDERATIONS

### 12.1 Token Security

| Measure | Implementation |
|---------|----------------|
| Short-lived access tokens | 15 minutes |
| Refresh token rotation | On every use |
| Token blacklisting | Redis blacklist |
| Secure storage | HttpOnly cookies |

### 12.2 Password Security

| Measure | Implementation |
|---------|----------------|
| Bcrypt hashing | Cost factor 12 |
| Password policy | 12+ chars, complexity |
| Breached password check | HaveIBeenPwned |
| Password history | Last 5 |

### 12.3 MFA Security

| Measure | Implementation |
|---------|----------------|
| TOTP | 6-digit codes |
| Backup codes | 10 single-use codes |
| Rate limiting | 5 attempts per 15 min |
| Device trust | Configurable |

### 12.4 Transport Security

| Measure | Implementation |
|---------|----------------|
| HTTPS | Enforced |
| HSTS | Enabled |
| Secure cookies | Secure flag |
| SameSite | Strict |

---

## 13. MIGRATION STRATEGY

### 13.1 Migration Steps

| Step | Action | Risk |
|------|--------|------|
| 1 | Deploy API alongside legacy | LOW |
| 2 | Create user migration script | MEDIUM |
| 3 | Migrate passwords to bcrypt | MEDIUM |
| 4 | Update frontend to use API | HIGH |
| 5 | Deprecate legacy auth | LOW |

### 13.2 Backward Compatibility

| Feature | Support |
|---------|---------|
| Legacy login | 6 months |
| GitHub sync | Continue |
| localStorage | Phase out |

---

## 14. TESTING STRATEGY

### 14.1 Unit Tests

- Password hashing
- JWT generation/validation
- Token refresh
- Rate limiting

### 14.2 Integration Tests

- Login flow
- MFA flow
- Password reset
- OAuth2 flow

### 14.3 Security Tests

- Brute force protection
- Token replay attacks
- Session hijacking
- CSRF protection

---

## 15. MONITORING

### 15.1 Metrics

| Metric | Type | Description |
|--------|------|-------------|
| auth_login_attempts | Counter | Total login attempts |
| auth_login_success | Counter | Successful logins |
| auth_login_failure | Counter | Failed logins |
| auth_mfa_attempts | Counter | MFA attempts |
| auth_token_refresh | Counter | Token refreshes |
| auth_rate_limit_hits | Counter | Rate limit hits |

### 15.2 Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| High failure rate | > 10 failures/min | High |
| Brute force detected | > 20 failures/min | Critical |
| Token anomalies | > 100 refreshes/min | Medium |
