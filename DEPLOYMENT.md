# DEPLOYMENT — DigiTronics

Components: static frontend (`index.html`, `DigiTronics_v5.html`) and the
Node/Express backend (`backend/`) with JSON file persistence
(`backend/data/`). The frontend runs fully standalone when
`USE_BACKEND = false` (default); the backend is an opt-in persistence layer.

## 0. Official single-command startup

The canonical way to run the entire application locally or on a single
host (e.g. Render) is:

```bash
cd <repo root>
npm install        # installs the backend too (postinstall)
npm start          # node backend/server.js
```

The API process serves BOTH the backend (`/api/v1/*`, `/api-docs`) and the
static frontend (`/` → `index.html` plus `services/`, `plugins/`, `icons/`,
`manifest.json`, `sw.js`). Open http://localhost:3001/ (PORT env to change).
Private paths (`backend/`, dotfiles, `node_modules/`, backups, docs) are
never served. `npm run check` validates the environment (JWT_SECRET etc.)
before production startup; `npm test` runs the backend suite.

## 0.1 Environment requirements

All configuration is via environment variables (see `backend/.env.example`
and the root `.env.example`). Nothing else is required:

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `NODE_ENV` | Yes (prod) | `production` disables dev request logging |
| `PORT` | No | HTTP port (default `3001`) |
| `JWT_SECRET` | **Yes (prod)** | ≥32 random chars; server warns if default |
| `JWT_REFRESH_SECRET` | No | Optional; defaults to `JWT_SECRET` + `:refresh` |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | No | Token lifetimes (`15m` / `7d`) |
| `AUTH_REQUIRED` | No | `true` = protect all `/api/v1` routes (default `false`) |
| `CORS_ORIGINS` | No | Comma-separated allowlist; empty = open (legacy) |
| `RATE_LIMIT_MAX` | No | Requests per 15 min per IP (default `1000`) |
| `BODY_LIMIT` | No | Max JSON body (default `10mb`) |
| `DIGITRONICS_DATA_DIR` | No | JSON persistence dir (default `backend/data`) |
| `ENABLE_MULTI_COMPANY_LOGIN` | No | Company selector on login (`false` default) |
| `ENABLE_TENANT_ROLES` | No | Per-tenant effective roles (`false` default) |
| `ENABLE_TENANT_CARRY` | No | Bind tenant into signed tokens (`false` default) |
| `ENABLE_TENANT_USER_MEMBERSHIP` | No | Company membership check at login (`false` default) |
| `LOG_FILE` / `SLOW_REQUEST_MS` | No | Structured logs / slow-request threshold |
| `SUPABASE_URL` / `SUPABASE_KEY` | No | Legacy Supabase integration (optional) |

Validation: `npm run check` (backend `node scripts/checkEnv.js`) fails fast
on missing/unsafe production settings. There is no separate database —
persistence is JSON files under the data dir (back them up; see
DISASTER_RECOVERY.md).

## 0.2 Render (single service)

`render.yaml` at the repo root is a complete Render blueprint: one Node web
service that runs `npm install && npm start`, health-checks
`/api/v1/health`, and mounts a 1 GB disk at `backend/data` for persistence.
Create a Render service from the Blueprint, then set `JWT_SECRET` in the
dashboard (it is deliberately not stored in the file).

## 1. Installation

### Option A — Docker (recommended)

```bash
cp .env.example .env          # set JWT_SECRET (required)
docker compose up -d          # backend on :3001, data on volume backend-data
docker compose --profile nginx up -d   # + nginx on :80 (frontend + proxy)
```

### Option B — Bare metal / VM (systemd)

```bash
cd backend
npm ci --omit=dev
cp .env.example .env          # set NODE_ENV=production and JWT_SECRET
node scripts/checkEnv.js      # validates the environment (fails fast)
sudo cp ../deploy/digitronics-backend.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now digitronics-backend
```

### Option C — PM2

```bash
cd backend
npm ci --omit=dev
pm2 start ecosystem.config.js
pm2 install pm2-logrotate     # log rotation
```

## 2. Configuration

All configuration is via environment variables (see `.env.example` at the
repo root for compose, `backend/.env.example` for bare metal). Required in
production: `JWT_SECRET` (≥32 random chars). `node scripts/checkEnv.js`
validates everything before startup.

## 3. Upgrade

```bash
git pull origin main
cd backend && npm ci --omit=dev
npm test                       # verify before restarting
systemctl restart digitronics-backend   # or: pm2 restart / docker compose up -d --build
curl -fsS http://127.0.0.1:3001/api/v1/ready
```

## 4. Rollback

```bash
git checkout <previous-tag>    # e.g. production-ready-v1
cd backend && npm ci --omit=dev
systemctl restart digitronics-backend
# If data was corrupted by the bad release, restore first (see DISASTER_RECOVERY.md).
```

Data format is forward/backward compatible within a phase line; when in
doubt, back up `backend/data` before upgrading.

## 5. Frontend deployment

Serve `index.html` / `DigiTronics_v5.html` as static files (nginx compose
profile does this). No build step. The backend URL is only used when
`USE_BACKEND = true` in the page.

## 6. Verification after deploy

```bash
curl -fsS .../api/v1/health     # 200
curl -fsS .../api/v1/ready      # 200 (persistence writable)
curl -fsS .../api/v1/liveness   # 200 (pid, memory)
```
