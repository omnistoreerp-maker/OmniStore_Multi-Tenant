# PRODUCTION CHECKLIST — DigiTronics go-live

## Pre-deploy

- [ ] On the intended release tag (e.g. `production-ready-v1` or later).
- [ ] `cd backend && npm test` — 249/249 green.
- [ ] `npm test -- --coverage` — coverage report generated.
- [ ] Playwright regression green for both frontends:
      `cd tests/e2e && npm test` (59/59 × 2).
- [ ] `node backend/scripts/loadTest.js` and `stressTest.js` — 0 errors.
- [ ] Backup of current `backend/data` taken and verified.
- [ ] SECURITY_CHECKLIST.md items done (JWT_SECRET, CORS, TLS, backups).

## Deploy

- [ ] `node backend/scripts/checkEnv.js` passes on the target host.
- [ ] Service started via chosen runtime (docker compose / systemd / PM2).
- [ ] Single backend instance only (fork mode; fileStore is per-process).

## Post-deploy verification

- [ ] `GET /api/v1/health` → 200.
- [ ] `GET /api/v1/ready` → 200 (persistence writable).
- [ ] `GET /api/v1/liveness` → 200 (pid/memory sane).
- [ ] Login works through the frontend (default page flow).
- [ ] One write + read round-trip per critical module (customers,
      sales, purchases) returns 2xx and persists across a restart.
- [ ] Logs flowing (file or journald), rotation configured.
- [ ] Uptime monitor pointing at `/api/v1/ready`.
- [ ] Backup cron installed; first scheduled backup verified.

## Rollback readiness

- [ ] Previous tag known and checked out-able.
- [ ] Latest verified backup location recorded.
- [ ] DISASTER_RECOVERY.md restore path tested within the last quarter.
