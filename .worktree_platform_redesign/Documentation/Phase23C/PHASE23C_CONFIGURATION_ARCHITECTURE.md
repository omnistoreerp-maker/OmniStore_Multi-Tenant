# Phase 23C — Configuration Architecture

**Repository:** E:\Projects\ESO
**Baseline:** phase23b-stable (tag e66b6fd)
**Date:** 2026-08-05
**Status:** Documentation Only — No Code Changes

---

## 1. Configuration Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      CONFIGURATION SOURCES                              │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Backend (Node.js)                                               │  │
│  │  ├─→ Environment variables (process.env)                         │  │
│  │  ├─→ config/index.js (defaults + env)                            │  │
│  │  └─→ dotenv (.env file)                                          │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Frontend (Browser)                                              │  │
│  │  ├─→ localStorage (feature flags, settings)                      │  │
│  │  ├─→ Hardcoded constants (keys, defaults)                        │  │
│  │  └─→ Runtime detection (isSupabaseEnabled())                     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Backend Configuration

### 2.1 Environment Variables

| Variable | Default | Source | Description |
|----------|---------|--------|-------------|
| NODE_ENV | development | Environment | Runtime environment |
| PORT | 3001 | Environment | Server port |
| JWT_SECRET | dev-secret | Environment | JWT signing secret |
| JWT_REFRESH_SECRET | JWT_SECRET + ':refresh' | Environment | Refresh token secret |
| JWT_ACCESS_TTL | 15m | Environment | Access token TTL |
| JWT_REFRESH_TTL | 7d | Environment | Refresh token TTL |
| AUTH_REQUIRED | false | Environment | Require authentication |
| CORS_ORIGINS | '' (empty) | Environment | Allowed CORS origins |
| RATE_LIMIT_MAX | 1000 | Environment | Rate limit max requests |
| BODY_LIMIT | 10mb | Environment | Request body limit |
| LOG_FILE | '' (empty) | Environment | Log file path |
| SLOW_REQUEST_MS | 1000 | Environment | Slow request threshold |
| SUPABASE_URL | '' (empty) | Environment | Supabase project URL |
| SUPABASE_KEY | '' (empty) | Environment | Supabase anon key |

### 2.2 Configuration Defaults

```javascript
module.exports = {
  env: 'development',
  isProduction: false,
  port: 3001,
  jwtSecret: 'dev-secret',
  jwtRefreshSecret: 'dev-secret:refresh',
  jwtAccessTtl: '15m',
  jwtRefreshTtl: '7d',
  authRequired: false,
  corsOrigins: '',
  rateLimitMax: 1000,
  bodyLimit: '10mb',
  logFile: '',
  slowRequestMs: 1000,
  supabase: {
    url: '',
    key: ''
  }
};
```

### 2.3 Configuration Matrix

| Config | Production | Development | Test |
|--------|------------|-------------|------|
| NODE_ENV | production | development | test |
| PORT | 3001 | 3001 | 3001 |
| AUTH_REQUIRED | true | false | false |
| CORS_ORIGINS | (required) | '' | '' |
| JWT_SECRET | (required) | dev-secret | test-secret |
| RATE_LIMIT_MAX | 1000 | 1000 | 10000 |
| SLOW_REQUEST_MS | 1000 | 1000 | 10000 |

---

## 3. Frontend Configuration

### 3.1 Feature Flags

| Flag | Source | Default | Description |
|------|--------|---------|-------------|
| USE_BACKEND | localStorage | false | Use backend API |
| isSupabaseEnabled() | localStorage | false | Use Supabase |
| GH_TOKEN_KEY | localStorage | '' | GitHub token |
| GH_GIST_KEY | localStorage | '' | GitHub gist ID |

### 3.2 localStorage Keys

| Key | Purpose | Type |
|-----|---------|------|
| DB_KEY | Main database | JSON |
| USER_REG_KEY | User registration | JSON |
| SESSION_USER_KEY | Current user | String |
| GH_TOKEN_KEY | GitHub token | String |
| GH_GIST_KEY | GitHub gist ID | String |
| ERROR_LOG_KEY | Error log | JSON |
| CHANGE_LOG_KEY | Change log | JSON |
| OMNISTORE_SETTINGS_KEY | OmniStore settings | JSON |
| PRODUCT_UUID_MAP_KEY | Product UUID map | JSON |
| PRE_RESTORE_BACKUP_KEY | Pre-restore backup | JSON |
| DIGITRONICS_PWA_SETTINGS_KEY | PWA settings | JSON |
| LIVE_SYNC_STATE_KEY | Live sync state | JSON |
| LIVE_SYNC_DEVICE_ID_KEY | Device ID | String |
| COMMAND_CENTER_STATE_KEY | Command center | JSON |
| DOCUMENT_CENTER_STATE_KEY | Document center | JSON |
| ENTERPRISE_RECOVERY_STATE_KEY | Recovery state | JSON |
| ENTERPRISE_RECOVERY_BASELINE_KEY | Recovery baseline | JSON |
| ENTERPRISE_PERFORMANCE_STATE_KEY | Performance state | JSON |
| ENTERPRISE_QA_STATE_KEY | QA state | JSON |
| ENTERPRISE_TRAINING_STATE_KEY | Training state | JSON |
| WORKFLOW_STORAGE_KEY | Workflow state | JSON |
| SMART_BI_STORAGE_KEY | Smart BI | JSON |
| AI_OWNER_STORAGE_KEY | AI owner | JSON |
| AUTOMATION_STORAGE_KEY | Automation | JSON |
| PLUGIN_CENTER_STORAGE_KEY | Plugin center | JSON |
| PREMIUM_UI_PREFS_KEY | UI preferences | JSON |

### 3.3 Hardcoded Constants

| Constant | Value | Location |
|----------|-------|----------|
| GH_TOKEN_KEY | 'gh_token' | index.html |
| GH_GIST_KEY | 'gh_gist_id' | index.html |
| DB_KEY | 'digitronicsDB' | index.html |
| USER_REG_KEY | 'user_registration' | index.html |
| SESSION_USER_KEY | 'session_user' | index.html |
| ERROR_LOG_KEY | 'error_log' | index.html |
| CHANGE_LOG_KEY | 'change_log' | index.html |
| OMNISTORE_SETTINGS_KEY | 'omnistore_settings' | index.html |
| PRODUCT_UUID_MAP_KEY | 'product_uuid_map' | index.html |
| PRE_RESTORE_BACKUP_KEY | 'pre_restore_backup' | index.html |
| DIGITRONICS_PWA_SETTINGS_KEY | 'digitronics_pwa_settings' | index.html |
| LIVE_SYNC_STATE_KEY | 'live_sync_state' | index.html |
| LIVE_SYNC_DEVICE_ID_KEY | 'live_sync_device_id' | index.html |
| COMMAND_CENTER_STATE_KEY | 'command_center_state' | index.html |
| DOCUMENT_CENTER_STATE_KEY | 'document_center_state' | index.html |
| ENTERPRISE_RECOVERY_STATE_KEY | 'enterprise_recovery_state' | index.html |
| ENTERPRISE_RECOVERY_BASELINE_KEY | 'enterprise_recovery_baseline' | index.html |
| ENTERPRISE_PERFORMANCE_STATE_KEY | 'enterprise_performance_state' | index.html |
| ENTERPRISE_QA_STATE_KEY | 'enterprise_qa_state' | index.html |
| ENTERPRISE_TRAINING_STATE_KEY | 'enterprise_training_state' | index.html |
| WORKFLOW_STORAGE_KEY | 'workflow_state' | index.html |
| SMART_BI_STORAGE_KEY | 'smart_bi' | index.html |
| AI_OWNER_STORAGE_KEY | 'ai_owner' | index.html |
| AUTOMATION_STORAGE_KEY | 'automation' | index.html |
| PLUGIN_CENTER_STORAGE_KEY | 'plugin_center' | index.html |
| PREMIUM_UI_PREFS_KEY | 'premium_ui_prefs' | index.html |

---

## 4. Configuration Gaps

### 4.1 Backend Gaps

| Gap | Impact | Severity |
|-----|--------|----------|
| AUTH_REQUIRED defaults to false | Security risk in production | Critical |
| JWT_SECRET defaults to 'dev-secret' | Predictable tokens | Critical |
| CORS_ORIGINS defaults to empty | Open CORS in production | High |
| No CSRF protection | Vulnerable to CSRF attacks | High |
| No input length validation | Potential DoS | Medium |

### 4.2 Frontend Gaps

| Gap | Impact | Severity |
|-----|--------|----------|
| Feature flags in localStorage | User can bypass restrictions | Medium |
| Supabase keys in HTML | Exposed in source | High |
| No configuration validation | Silent failures | Medium |
| Hardcoded defaults | No runtime override | Low |

---

## 5. Configuration Recommendations

### 5.1 Backend Recommendations

| Recommendation | Priority | Effort |
|----------------|----------|--------|
| Change AUTH_REQUIRED default to true | High | Low |
| Change JWT_SECRET default to random | High | Low |
| Change CORS_ORIGINS default to localhost | High | Low |
| Add CSRF protection middleware | High | Medium |
| Add input length validation | Medium | Medium |

### 5.2 Frontend Recommendations

| Recommendation | Priority | Effort |
|----------------|----------|--------|
| Remove Supabase keys from HTML | High | Medium |
| Add configuration validation | Medium | Medium |
| Move feature flags to backend | Low | High |
| Add configuration documentation | Low | Low |

---

*Configuration architecture documentation generated: 2026-08-05*
*Tag: phase23b-stable*
*Commit: e66b6fd*
