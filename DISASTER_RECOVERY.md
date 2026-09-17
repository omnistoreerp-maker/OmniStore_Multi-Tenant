# DISASTER RECOVERY — DigiTronics

The system's persistent state is the JSON files in `backend/data/`
(or the `backend-data` Docker volume). Everything else is redeployable
from git.

## 1. Backup

```bash
cd backend
node scripts/backup.js                       # -> backend/backups/backup-<UTC>/
node scripts/backup.js --out /mnt/offsite    # external target
```

Each backup contains all store files plus `manifest.json` (SHA-256 +
size per file). Backups are validated at creation (JSON parse) — a
corrupt live store cannot silently enter a backup.

## 2. Verify

```bash
node scripts/verify.js backend/backups/backup-<UTC>
```
Exit 0 = every file present, checksum and size match, valid JSON.
Run this after every backup and before every restore.

## 3. Restore

```bash
# stop the backend first (clean state, no concurrent writes)
systemctl stop digitronics-backend          # or: docker compose stop backend

node scripts/restore.js --from backend/backups/backup-<UTC>
# refuses to overwrite a non-empty data dir without --force;
# with --force it first takes a pre-restore snapshot of current data.

systemctl start digitronics-backend
curl -fsS http://127.0.0.1:3001/api/v1/ready
```

## 4. Scenarios

- **Corrupted store file**: restore the affected file from the latest
  verified backup (or the full directory). fileStore resets an
  unreadable store on read, so act before new writes accumulate.
- **Bad release deployed**: `git checkout <previous-tag>`, reinstall,
  restart (see DEPLOYMENT.md §4). Data usually survives; restore only
  if the release wrote bad data.
- **Total host loss**: provision new host → `git clone` → `npm ci
  --omit=dev` → copy latest offsite backup → `restore.js` → start.
- **Accidental delete via API**: records deleted through the API are
  only recoverable from backups. Keep the backup cadence aligned with
  your RPO (daily = up to 24h loss).

## 5. RPO / RTO guidance

- RPO: backup interval (daily cron recommended = 24h; hourly = 1h).
- RTO: ~5 minutes (redeploy + restore + health check), assuming an
  offsite backup copy exists.
- Test the full restore path quarterly: backup → delete scratch copy →
  restore → verify (the scripts support `--dir` for a full dry run
  against a scratch directory without touching live data).
