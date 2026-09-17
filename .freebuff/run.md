# OmniStore Multi-Tenant — Preview Run Doc

## How to reproduce the uncommitted artifacts

There are NO uncommitted artifacts required to run the app. This project
runs entirely from committed sources:

- No `.env.local` / `.env` copy is needed — the backend defaults are used
  (`PORT=3001`, `JWT_SECRET` dev default, `AUTH_REQUIRED=false`).
- `backend/.env` is gitignored and optional; if present it only overrides
  defaults.
- Dependencies: `npm install` at the repo root installs the backend via the
  root `postinstall` script (`cd backend && npm install`).
- Persistence: JSON files under `backend/data` (default data dir), created
  on first write. `backend/data/apiKeys.json` and `auditLog.json` are
  gitignored runtime stores.

## How to run the server

Canonical (matches production):

```bash
npm start        # = node backend/server.js
```

- Backend API + static frontend on one process: http://127.0.0.1:3001/
- Health: GET /api/v1/health, /api/v1/ready, /api/v1/liveness
- Frontend: GET / serves index.html (services/, plugins/, icons/, sw.js,
  manifest.json served too; backend/, dotfiles, scratch files are 403/404).
- To enable backend mode in the browser UI, set localStorage
  `esoBackendRuntimeConfig = {"enabled":true,"apiBaseUrl":""}` (same-origin)
  and reload, then log in with a user created via POST /api/v1/users.
- Multi-company/tenant features (company selector, effective roles and
  permissions) require the four env flags:
  `ENABLE_MULTI_COMPANY_LOGIN=true ENABLE_TENANT_ROLES=true
  ENABLE_TENANT_CARRY=true ENABLE_TENANT_USER_MEMBERSHIP=true`.

## Freeport note

Port 3001 is occupied on this machine by an unrelated `E:\AI\node.exe`
pid. Use `PORT=3004` (or another free port) for the preview. The dev-server
command then becomes:

```bash
PORT=3004 node backend/server.js
```

Or via PowerShell (detached, with env vars):

The tool's PowerShell `-Command` mode strips `$` from `$env:` assignments.
Two reliable approaches:

1. **Batch wrapper** (`.freebuff/start-preview.cmd`) — set env vars with `set`, then `node backend/server.js`.
   Start with: `Start-Process cmd.exe -ArgumentList '/c','.freebuff\start-preview.cmd' -WorkingDirectory '<repo>' ...`

2. **PowerShell script** (`.freebuff/start-preview.ps1`) — set `$env:PORT`, `$env:NODE_ENV`, `$env:AUTH_REQUIRED`, then `node backend/server.js`.
   Start with: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.freebuff\start-preview.ps1'`

Both run detached on port 3004. Log to `.freebuff/preview-*.log`.
