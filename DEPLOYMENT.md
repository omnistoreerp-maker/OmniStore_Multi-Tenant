# DEPLOYMENT — DigiTronics

Components: static frontend (`index.html`, `DigiTronics_v5.html`) and the
Node/Express backend (`backend/`) with JSON file persistence
(`backend/data/`). The frontend runs fully standalone when
`USE_BACKEND = false` (default); the backend is an opt-in persistence layer.

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
