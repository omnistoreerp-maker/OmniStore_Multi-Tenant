# PHASE 24 — DEPLOYMENT CHECKLIST

**Target:** single PM2 instance, JSON persistence, graceful shutdown (per certified baseline). No infra change.

| # | Step | Command / Action | Verify |
|---|---|---|---|
| 1 | Fetch latest release | `git fetch origin` | expected `phase24` tag present |
| 2 | Checkout release | `git checkout phase24` | clean tree, HEAD = tag |
| 3 | Install deps | `npm ci --omit=dev` (in `backend/`) | lockfile sync |
| 4 | Env verification | confirm `DIGITRONICS_DATA_DIR`, `PORT`, `SESSION_SECRET` set | env-check passes |
| 5 | Health smoke | `GET /api/v1/health` | 200, ready=true |
| 6 | Metrics smoke | `GET /api/v1/metrics` | Prometheus format |
| 7 | Restart via PM2 | `pm2 restart digitronics` | stable after 30s |
| 8 | No open handles | monitor logs for leaked timers | clean |
| 9 | Post-deploy suite | run 447-test suite on deployed tag | 447/447 |

**Rollback:** `git checkout <prior tag>` (e.g. `phase23f-release`) → `npm ci` → `pm2 restart`.

**Hold:** this checklist is executable only after B-01 resolves (commit + `phase24` tag exist).