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
service that runs `npm install && npm run build:marketplace && npm start` (the marketplace
build regenerates the gitignored `marketplace/dist` and republishes the tracked
`marketplace/index.html` entry — it must never be skipped), health-checks
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

### Login challenge database (Google Login / MFA / tenant selection)

`CHALLENGE_DB_PATH` must point at a SQLite file inside a directory that
already exists and is writable by the service account. The backend refuses to
start when the variable is missing in `NODE_ENV=production` or `staging`, and
it never creates directories on its own:

```bash
# POSIX example (service user "omnistore")
install -d -m 0700 -o omnistore -g omnistore /var/lib/omnistore/challenges
CHALLENGE_DB_PATH=/var/lib/omnistore/challenges/login-challenges.sqlite
```

SQLite also creates `-wal` and `-shm` siblings, so the directory — not just the
file — needs write access. The file holds only SHA-256 hashes of single-use
login challenges (never the tokens themselves). `LOGIN_CHALLENGE_TTL`
(default `5m`) is the single TTL applied to both the signed challenge token and
its database row.

### Token store (refresh rotation / revocation)

Refresh-token rotation, replay detection and durable revocation live in a
SQLite database at `TOKEN_STORE_PATH` (default: `tokenStore.sqlite` inside the
data dir). It is created on first boot and must sit in an existing, writable
directory; it creates `-wal` and `-shm` siblings. Startup is fail-closed: the
process exits rather than serve traffic if the store is missing, corrupt, or
not writable. Back it up with `npm run backup` / validate with
`npm run verify-backup` (see `DISASTER_RECOVERY.md`).

The login-challenge database is a second SQLite file, taken from
`CHALLENGE_DB_PATH` (required in production/staging; locally it defaults to
`challengeStore.sqlite` in the data dir). The same backup/verify/restore
scripts cover both databases: a backup in a production-like environment fails
loudly if the challenge database is unconfigured or missing, rather than
producing a silently incomplete backup.

**Restore permissions and ownership.** A backup records the POSIX permission
bits of each SQLite database and a restore re-applies them, so a hardened
`0600` token/challenge store is not widened to SQLite's default `0644`.
Ownership is not restored: the files belong to the user that runs the restore.
Run the restore as the service account; restoring as `root` leaves `root`-owned
databases that the service user may then be unable to write.

Housekeeping removes only already-expired rows (refresh tokens, access-token
denylist entries, legacy revocation records) in small batches, at most once per
five minutes, triggered by login/refresh traffic. Active refresh tokens, active
session families, replay audit records and legacy revocations with no recorded
expiry are never deleted.

**Deployment requirement — single-instance cutover.** Upgrade this release by
replacing the running process, not by running old and new instances side by
side. A pre-upgrade instance writes revocations to the JSON file
`revoked-tokens.json`, while this release consults the SQLite
`legacy_revocations` table (imported once at startup). During an overlap, a
revocation written by an old instance is not visible to a new instance until
the new process restarts and re-runs the import, so a token revoked in that
window could still be accepted. Rolling / blue-green deployment with both
versions serving at once is **not supported** for this change.

**Client requirement — serialize refresh.** Refresh tokens are strictly
single-use. Two concurrent refresh calls with the same token make the second
one a replay; replay detection revokes the whole session family, including the
successor token issued to the winning request. Clients must serialize refresh
requests (one in flight, shared promise for concurrent callers) and must not
retry a refresh with a token that was already used.


## 3. Upgrade

Replace the running instance; do not overlap old and new versions (see
"Deployment requirement — single-instance cutover" above).

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
