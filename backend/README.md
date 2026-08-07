# DigiTronics Backend API

Node.js/Express backend for the DigiTronics ERP. JSON file persistence via atomic
write-to-temp + rename (`utils/fileStore.js`). Feature-flagged on the frontend
(`USE_BACKEND`, default `false`); with the flag off the frontend never calls this API.

## Run

```bash
npm install
npm start          # node server.js
npm run dev        # node --watch server.js
```

Health check: `GET /api/v1/health`

## Configuration

All configuration is via environment variables (dotenv). See `.env.example` for the
full documented list. Key points:

- `JWT_SECRET` — **must be set in production** (boot warning otherwise).
- `AUTH_REQUIRED` — default `false` keeps every route open (legacy behavior).
  Set `true` to require a Bearer token on all business routes and the
  Owner/Admin/Manager role for non-GET requests.
- `CORS_ORIGINS` — empty means open CORS (legacy default); set a comma-separated
  allowlist to restrict.
- `.env` is gitignored; never commit secrets.

## API Overview

All endpoints return the standard envelope:
`{ success, message, data, time }` (errors: `{ success:false, message, statusCode, details, time }`).

### Auth — `/api/v1/auth`

| Method | Path | Description |
|---|---|---|
| POST | `/login` | `{username, password}` → `{user, accessToken, refreshToken}`; sets httpOnly cookies. Passwords verified with bcrypt; legacy plaintext credentials are migrated to bcrypt on successful login. |
| POST | `/refresh` | `{refreshToken}` (or cookie) → new `{accessToken}`. Revoked/expired tokens → 401. |
| POST | `/logout` | Revokes presented access + refresh tokens, clears cookies. |
| GET | `/me` | Bearer token **or** `?username=` (legacy) → `{user}`. |
| GET | `/roles` | Known role list. |
| GET | `/permissions?username=` | `{username, role, permissions}`. |

### Business resources

`sales`, `purchases`, `inventory` (products), `inventory-transactions`,
`customers`, `suppliers`, `treasury`, `employees`, `partners`, `reports`,
`dashboard`, `vouchers`, `users` — all under `/api/v1/<resource>` with:

| Method | Path | Description |
|---|---|---|
| GET | `/` | List — `search`, resource filters, `sortBy`, `sortOrder`, `page`, `limit` (≤100). |
| GET | `/stats` | Persistence metadata only (counts). Mounted **before** `/:id`. |
| GET | `/:id` | Single record (404 when missing). |
| POST | `/` | Create (201). UUID id when not provided. Schema-validated. |
| PUT | `/:id` | Update (404 when missing). `id` immutable, `updatedAt` refreshed. |
| DELETE | `/:id` | Delete (404 when missing). |

### Middleware stack (in order)

helmet → CORS (open or allowlist) → compression → morgan (dev only) →
slow-request perf logger → JSON body parser (limit `BODY_LIMIT`) → body
sanitizer (strips `__proto__`/`constructor`/`prototype`/`$*` keys) → rate
limiter → token resolver (`req.user`, never rejects) → optional auth guard
(`AUTH_REQUIRED`) → per-resource schema validation → routes → 404 handler →
JSON-parse error handler (400/413) → central 500 handler (no internal leakage
in production).

## Password security

Passwords are stored as bcrypt hashes (cost 10). Records created or updated
through the API are hashed automatically. Legacy plaintext credentials still
verify (identical login semantics) and are re-hashed on first successful login.

## Deployment notes

- Single-process design; persistence is synchronous JSON-file I/O — size-appropriate
  for a local/LAN deployment, not for multi-instance horizontal scaling (no
  cross-process file locking).
- Set `NODE_ENV=production`, `JWT_SECRET`, `CORS_ORIGINS`, and optionally
  `AUTH_REQUIRED=true`, `LOG_FILE`.
- The process registers `unhandledRejection` (logs) and `uncaughtException`
  (logs and exits) handlers — run under a process supervisor for auto-restart.
- `backend/data/*.json` stores are auto-created on first use; back them up with
  the host.

## Frontend integration

The frontend (`index.html`, `DigiTronics_v5.html`) talks to this API only when
`USE_BACKEND=true`, through `backendApi` → `digitronicsDataAdapter` → background
sync/refresh → `syncEngine`. With `USE_BACKEND=false` (default) behavior is
100% local and identical to previous versions.
