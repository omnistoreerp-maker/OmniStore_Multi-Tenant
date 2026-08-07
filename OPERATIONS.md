# OPERATIONS — DigiTronics

## Day-to-day

| Task | Command |
|------|---------|
| Health check | `curl .../api/v1/health` |
| Readiness (persistence OK) | `curl .../api/v1/ready` |
| Liveness (pid, memory) | `curl .../api/v1/liveness` |
| Logs (systemd) | `journalctl -u digitronics-backend -f` |
| Logs (PM2) | `pm2 logs digitronics-backend` |
| Restart | `systemctl restart digitronics-backend` / `pm2 restart ...` / `docker compose restart backend` |
| Env validation | `node backend/scripts/checkEnv.js` |

## Monitoring

- **Health endpoints**: `/api/v1/health` (uptime), `/api/v1/ready`
  (writable-persistence probe, 503 on failure — alert on this),
  `/api/v1/liveness` (pid, RSS, heap). Point your uptime monitor at
  `/api/v1/ready`.
- **Logs**: structured file logs when `LOG_FILE` is set; request logs in
  development; slow-request logging (`SLOW_REQUEST_MS`, default 1000ms) in
  all environments. Rotate with `deploy/logrotate.d-digitronics` or
  `pm2-logrotate`.
- **Metrics to watch**: RSS (stable under load ≈ 70–120MB baseline),
  p95 latency (<50ms at 20-way concurrency on loopback), error rate
  (should be 0 5xx), disk space for `backend/data` and backups.

## Backup schedule

```bash
cd backend && npm run backup           # manual
# cron example (daily 03:17):
# 17 3 * * * cd /opt/digitronics/backend && node scripts/backup.js
```
Verify every backup: `node scripts/verify.js backups/<dir>`.

## Load / stress harnesses (re-runnable)

```bash
node backend/scripts/benchmark.js    # in-process latency benchmark
node backend/scripts/loadTest.js     # 100/500/1000-request rounds
node backend/scripts/stressTest.js   # parallel CRUD/login/refresh/dup-push
```

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `/ready` returns 503 | Data dir not writable — permissions on `backend/data` or the volume |
| 401 on all routes | `AUTH_REQUIRED=true` without a token; or `JWT_SECRET` changed (tokens invalidated) |
| 429 responses | Rate limit hit (`RATE_LIMIT_MAX`, default 1000/15min per IP) |
| Server won't start | Run `node scripts/checkEnv.js` — it lists blocking problems |
| Corrupt store file | Restore from backup (DISASTER_RECOVERY.md); fileStore repairs invalid JSON on read by resetting that store |
| High memory | Single instance only (fork mode) — never cluster: fileStore is per-process |

## Dashboard "Active Users" card semantics

The card and its click-through modal are derived **only from the local
audit log** (`DB.auditLog` in localStorage) — no backend, no timers:

- **KPI number** = distinct usernames with audit activity **today (local
  date)** whose **latest** entry today is not a logout. Pseudo-users
  `system` / `-` are excluded.
- **Modal** (click the card) lists **all** users with activity today:
  Username, Full Name, Role (joined from `DB.users`), First/Last
  Activity Today, and Status — 🟢 Active Today / ⚪ Logged Out —
  decided solely by each user's latest entry today.
- **Known limitation**: if a user closes the browser/app without
  clicking logout, no logout entry is written, so they remain
  "Active Today" for the rest of the day. The day boundary resets at
  local midnight.
- `USE_BACKEND=false` behavior is unchanged: zero API requests.
