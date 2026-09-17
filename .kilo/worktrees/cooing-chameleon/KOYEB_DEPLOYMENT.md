# Koyeb Deployment Guide — OmniStore Multi-Tenant

## Overview

This guide covers deploying OmniStore Multi-Tenant to Koyeb using the **FREE tier**.

### Koyeb Free Tier Specifications

- **RAM**: 512 MB
- **CPU**: 0.1 vCPU
- **Disk**: 2 GB SSD (ephemeral)
- **Persistent Volumes**: ❌ NOT supported on free tier
- **Credit Card**: ❌ NOT required
- **Regions**: Frankfurt or Washington D.C.

### ⚠️ Important Limitation

**Koyeb Free does NOT support persistent volumes.**

The application uses JSON file storage (`backend/data/`). On the free tier:
- Data is stored in ephemeral disk
- Data is **lost** when the service restarts or scales down to zero
- The application will re-initialize with seed data on each cold start

This is acceptable for:
- Development/testing
- Demonstrations
- Proof of concept

This is NOT suitable for:
- Production with real business data
- Long-term data retention

---

## Prerequisites

1. GitHub account with access to `omnistoreerp-maker/OmniStore_Multi-Tenant`
2. Koyeb account (free signup, no credit card)
3. The repository must be public or Koyeb must have GitHub access

---

## Step 1: Sign Up for Koyeb

1. Go to https://app.koyeb.com
2. Sign up with GitHub (recommended) or email
3. No credit card required

---

## Step 2: Create a New Service

1. In Koyeb dashboard, click **Create Web Service**
2. Select **GitHub** as the deployment source
3. Select repository: `omnistoreerp-maker/OmniStore_Multi-Tenant`
4. Select branch: `main`

---

## Step 3: Configure Build Settings

### Build Options

- **Builder**: Buildpack (recommended) or Dockerfile
- **Build Command**: `npm install`
- **Start Command**: `npm start`

### Instance Type

- **Select**: Nano (FREE)
- **Do NOT select** any paid instance type

---

## Step 4: Configure Environment Variables

Add these environment variables in the Koyeb dashboard:

| Variable | Value | Notes |
|----------|-------|-------|
| `NODE_ENV` | `production` | Required |
| `AUTH_REQUIRED` | `false` | For initial bootstrap |
| `JWT_SECRET` | *(generate strong secret)* | See below |
| `ENABLE_MULTI_COMPANY_LOGIN` | `true` | Required for multi-company |
| `ENABLE_TENANT_ROLES` | `true` | Required for tenant roles |
| `ENABLE_TENANT_CARRY` | `true` | Required for tenant carry |
| `ENABLE_TENANT_USER_MEMBERSHIP` | `true` | Required for membership |
| `RATE_LIMIT_MAX` | `1000` | Optional |

### Generate JWT_SECRET

Run this locally to generate a secure secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**⚠️ NEVER commit this value to Git.**

**⚠️ NEVER share this value in chat/logs.**

---

## Step 5: Deploy

1. Click **Deploy** button
2. Wait for build to complete (2-5 minutes)
3. Once deployed, Koyeb will provide a URL like: `https://your-service.koyeb.app`

---

## Step 6: Verify Deployment

After deployment completes, verify these endpoints:

```bash
# Replace with your actual Koyeb URL
KOYEB_URL="https://your-service.koyeb.app"

# Health check
curl -s "$KOYEB_URL/api/v1/health"

# Liveness check
curl -s "$KOYEB_URL/api/v1/liveness"

# Root (frontend)
curl -s -o /dev/null -w "%{http_code}" "$KOYEB_URL/"
```

Expected responses:
- `/api/v1/health` → HTTP 200 with `{"status":"ok"}`
- `/api/v1/liveness` → HTTP 200 with process info
- `/` → HTTP 200 (frontend HTML)

---

## Step 7: Bootstrap First Owner

**IMPORTANT**: Keep `AUTH_REQUIRED=false` until Owner is created.

### Create Owner Account

```bash
curl -X POST "$KOYEB_URL/api/v1/users" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "owner",
    "password": "YourStrongPassword123!",
    "role": "Owner",
    "fullName": "System Owner"
  }'
```

**⚠️ Replace `YourStrongPassword123!` with a strong password.**

**⚠️ NEVER use weak passwords in production.**

### Verify Owner Login

```bash
curl -X POST "$KOYEB_URL/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "owner",
    "password": "YourStrongPassword123!"
  }'
```

Expected: HTTP 200 with JWT token

---

## Step 8: Enable Authentication (Optional)

After verifying Owner login, you can enable authentication:

1. Go to Koyeb dashboard → Environment Variables
2. Change `AUTH_REQUIRED` from `false` to `true`
3. Save and redeploy

**⚠️ Only do this AFTER verifying Owner login works.**

---

## Troubleshooting

### Service Won't Start

1. Check build logs in Koyeb dashboard
2. Verify `npm install` completes without errors
3. Verify `npm start` runs correctly

### PORT Errors

The application automatically uses Koyeb's `PORT` environment variable. No manual PORT configuration needed.

### Data Loss

Expected behavior on free tier. Data is ephemeral and will be lost on restarts.

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | `development` | Set to `production` |
| `PORT` | No | `3001` | Auto-set by Koyeb |
| `JWT_SECRET` | Yes (prod) | `dev-secret` | Strong random secret |
| `AUTH_REQUIRED` | No | `false` | Enable route protection |
| `ENABLE_MULTI_COMPANY_LOGIN` | No | `false` | Company selector |
| `ENABLE_TENANT_ROLES` | No | `false` | Per-tenant roles |
| `ENABLE_TENANT_CARRY` | No | `false` | Tenant in JWT |
| `ENABLE_TENANT_USER_MEMBERSHIP` | No | `false` | Membership check |
| `RATE_LIMIT_MAX` | No | `1000` | Requests per 15 min |

---

## Security Notes

- ✅ JWT_SECRET is never committed to Git
- ✅ No hardcoded secrets in code
- ✅ Private paths blocked (`.env`, `.git`, `backend/data/`)
- ✅ Authentication middleware intact
- ✅ Tenant isolation intact
- ✅ RBAC intact

---

## Next Steps

After successful deployment:

1. Test the application in browser
2. Create test data
3. Verify all ERP features work
4. Consider paid tier for production use with persistent storage
