# PHASE24_DEPLOYMENT_STRATEGY.md
## DigiTronics V2 Enterprise Deployment Strategy

**Date:** 2026-08-05
**Status:** REVISED - Aligned with Verified Architecture
**Phase:** 24 - API Foundation & Authentication

---

## 1. DEPLOYMENT OVERVIEW

### 1.1 Deployment Strategy

| Aspect | Decision |
|--------|----------|
| Strategy | Blue-Green |
| Zero-downtime | Yes |
| Rollback | Automated |
| Environment | Docker + Docker Compose |

### 1.2 Environments

| Environment | Purpose | Infrastructure |
|-------------|---------|----------------|
| Development | Local development | Docker Compose |
| Staging | Pre-production testing | Docker Compose |
| Production | Live system | Docker + Nginx |

---

## 2. INFRASTRUCTURE (ALIGNED WITH VERIFIED ARCHITECTURE)

### 2.1 Current State (Verified)

| Component | Status | Technology |
|-----------|--------|------------|
| Runtime | EXISTS | Node.js 22 |
| Framework | EXISTS | Express.js |
| Data Persistence | EXISTS | JSON file storage |
| Authentication | EXISTS | JWT + bcrypt |
| Rate Limiting | EXISTS | express-rate-limit |
| Security | EXISTS | Helmet + Nginx |

### 2.2 Docker Configuration (Aligned)

```dockerfile
# Dockerfile - Aligned with verified backend/Dockerfile
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

FROM node:22-alpine AS runner

WORKDIR /app
RUN addgroup -g 1001 -S digitronics && \
    adduser -S digitronics -u 1001
COPY --from=builder /app ./
RUN chown -R digitronics:digitronics /app
USER digitronics

EXPOSE 3001
CMD ["node", "server.js"]
```

### 2.3 Docker Compose (Development)

```yaml
# docker-compose.yml - Aligned with verified configuration
version: '3.8'

services:
  backend:
    build: ./backend
    ports:
      - "${BACKEND_PORT:-3001}:3001"
    environment:
      - NODE_ENV=development
      - PORT=3001
      - JWT_SECRET=${JWT_SECRET:-dev-secret}
      - JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET:-dev-secret-refresh}
      - AUTH_REQUIRED=${AUTH_REQUIRED:-false}
      - CORS_ORIGINS=${CORS_ORIGINS:-}
      - RATE_LIMIT_MAX=${RATE_LIMIT_MAX:-1000}
    volumes:
      - ./backend/data:/app/data
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3001/api/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  nginx:
    image: nginx:1.27-alpine
    ports:
      - "${HTTP_PORT:-80}:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./index.html:/usr/share/nginx/html/index.html:ro
      - ./manifest.json:/usr/share/nginx/html/manifest.json:ro
      - ./sw.js:/usr/share/nginx/html/sw.js:ro
      - ./icons:/usr/share/nginx/html/icons:ro
    depends_on:
      backend:
        condition: service_healthy
    profiles:
      - nginx
```

### 2.4 Environment Variables

```bash
# .env.example - Aligned with verified configuration
PORT=3001
JWT_SECRET=change-me-to-a-long-random-string
JWT_REFRESH_SECRET=change-me-to-another-long-random-string
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
AUTH_REQUIRED=false
CORS_ORIGINS=
RATE_LIMIT_MAX=1000
BODY_LIMIT=10mb
LOG_FILE=
SLOW_REQUEST_MS=1000
HTTP_PORT=80
```

---

## 3. DATA PERSISTENCE (ALIGNED)

### 3.1 Current State (Verified)

| Aspect | Status |
|--------|--------|
| Storage | JSON file persistence |
| Location | backend/data/ |
| Files | purchases.json, sales.json |
| Pattern | Atomic writes with temp-file-then-rename |
| Cache | In-memory with mtime validation |

### 3.2 Data Volume Mount

```yaml
volumes:
  - ./backend/data:/app/data
```

### 3.3 Backup Strategy

| Type | Frequency | Method |
|------|-----------|--------|
| Full | Daily | Copy backend/data/*.json |
| Incremental | Hourly | rsync |
| Retention | 7 days | Automated cleanup |

---

## 4. NGINX CONFIGURATION (ALIGNED)

### 4.1 Nginx Config

```nginx
# nginx.conf - Aligned with verified configuration
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    sendfile on;
    keepalive_timeout 65;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    upstream digitronics_backend {
        server backend:3001;
        keepalive 32;
    }

    server {
        listen 80;
        server_name _;

        # Security headers
        add_header X-Content-Type-Options nosniff always;
        add_header X-Frame-Options DENY always;
        add_header Referrer-Policy no-referrer always;
        add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

        # Static frontend
        location / {
            root /usr/share/nginx/html;
            try_files $uri $uri/ /index.html;
        }

        # API proxy
        location /api/ {
            proxy_pass http://digitronics_backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Health endpoint
        location /api/v1/health {
            proxy_pass http://digitronics_backend;
            proxy_read_timeout 5s;
        }
    }
}
```

---

## 5. CI/CD PIPELINE (ALIGNED)

### 5.1 GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '22'
      - name: Install dependencies
        run: npm ci
        working-directory: ./backend
      - name: Run tests
        run: npm test
        working-directory: ./backend

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build Docker image
        run: docker build -t digitronics-backend:${{ github.sha }} ./backend
      - name: Push to registry
        run: docker push digitronics-backend:${{ github.sha }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Deploy to production
        run: |
          docker-compose down
          docker-compose up -d
```

---

## 6. MONITORING (ALIGNED)

### 6.1 Health Checks

| Endpoint | Purpose | Interval |
|----------|---------|----------|
| /api/v1/health | Application health | 30s |
| /api/v1/liveness | Liveness probe | 10s |
| /api/v1/ready | Readiness probe | 5s |

### 6.2 Logging

| Type | Technology | Purpose |
|------|------------|---------|
| Access | Morgan | HTTP requests |
| Application | Winston | App logs |
| Error | Winston | Error tracking |

---

## 7. SECURITY (ALIGNED)

### 7.1 Security Measures

| Measure | Implementation |
|---------|----------------|
| HTTPS | Nginx + SSL |
| Security Headers | Helmet + Nginx |
| Rate Limiting | express-rate-limit |
| CORS | cors middleware |
| Input Validation | Joi schemas |
| Password Hashing | bcrypt |

---

## 8. ROLLBACK PROCEDURE

### 8.1 Rollback Steps

```bash
# 1. Stop current deployment
docker-compose down

# 2. Checkout previous version
git checkout <previous-commit>

# 3. Rebuild and deploy
docker-compose build
docker-compose up -d

# 4. Verify health
curl http://localhost:3001/api/v1/health
```

---

## 9. DEPLOYMENT CHECKLIST

### 9.1 Pre-Deployment

| Check | Action |
|-------|--------|
| 1 | Run tests |
| 2 | Build Docker image |
| 3 | Verify health check |
| 4 | Check logs |

### 9.2 Deployment

| Check | Action |
|-------|--------|
| 1 | Pull latest code |
| 2 | Stop services |
| 3 | Start services |
| 4 | Verify health |

### 9.3 Post-Deployment

| Check | Action |
|-------|--------|
| 1 | Monitor logs |
| 2 | Check error rates |
| 3 | Verify API responses |
| 4 | Test critical flows |

---

**Document Generated:** 2026-08-05
**Status:** REVISED - Aligned with Verified Architecture
