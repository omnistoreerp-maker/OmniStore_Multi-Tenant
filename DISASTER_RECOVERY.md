# DISASTER RECOVERY — DigiTronics

The system's persistent state lives in `backend/data/` (or the
`backend-data` Docker volume):
- the JSON store files,
- `tokenStore.sqlite` (refresh-token rotation / revocation),
- the login-challenge database: `CHALLENGE_DB_PATH` when set, otherwise
  `challengeStore.sqlite` in the data dir. **Production and staging
  must set `CHALLENGE_DB_PATH`** — a backup there fails rather than
  silently omit it.

Everything else is redeployable from git. The SQLite files use WAL
mode, so they are never copied as raw files.

## 1. Backup

```bash
cd backend
node scripts/backup.js                       # -> backend/backups/backup-<UTC>/
node scripts/backup.js --out /mnt/offsite    # external target
```

Each backup contains the JSON stores, both SQLite databases, and
`manifest.json` (SHA-256 + size per file, plus which databases were
included or skipped). Guarantees:

- JSON stores are parsed, copied, then re-read; a file modified during
  the copy aborts the whole backup.
- SQLite is snapshotted through the online backup API after a WAL
  checkpoint, then `-wal`/`-shm` are folded in and removed, so the
  backup directory is self-contained.
- A failed backup leaves no partial directory behind.
- A backup dir is never written over; a same-second run gets a `-1`
  suffix.

Best-effort consistency only: JSON and SQLite are not covered by one
shared transaction. Stop the service for a strict cross-store
guarantee.

## 2. Verify

```bash
node scripts/verify.js backend/backups/backup-<UTC>
```
Exit 0 = every file present, checksum and size match, valid JSON, and
both SQLite files pass `integrity_check` plus their schema check.
Run this after every backup and before every restore.

## 3. Restore

```bash
# stop the backend first — this is a required precondition
systemctl stop digitronics-backend          # or: docker compose stop backend

node scripts/restore.js --from backend/backups/backup-<UTC> [--dir <dataDir>] [--force] [--allow-unlisted]

systemctl start digitronics-backend
curl -fsS http://127.0.0.1:3001/api/v1/ready
```

Restore verifies the whole backup before copying anything and refuses to
replace a database an active writer holds: every SQLite target is probed
before the first target is moved and again immediately before its swap,
and the refusal names the database and states that the service must be
stopped. The probe only observes a live write lock — an open-but-idle
connection or a read-only reader cannot be detected, so stopping the
service remains a mandatory precondition, not a hint.

If the destination file cannot be replaced because another process
still holds it open — Windows reports EBUSY/EPERM for a rename over an
open handle even when no writer lock is active — the restore refuses
with an actionable error naming that database, the OS error code, and
the instruction to stop the service and close every connection. The
original database and its sidecars are restored; unrelated filesystem
errors (EACCES, ENOENT) are reported as themselves, never as "in use".

A restore holds a lock set covering every destination it will actually
replace, not just the backup directory:

- `.restore.lock` in the data directory (JSON stores and staging), and
- one `<database>.restore-lock` next to each SQLite destination, so a
  relocated `TOKEN_STORE_PATH` or `CHALLENGE_DB_PATH` is protected even
  when another restore uses a different `--dir`.

Destination paths are canonicalised (symlinks resolved) before locking,
and the locks are acquired in a sorted global order, so two restores
sharing even one database cannot overlap and a partial overlap cannot
deadlock. All locks are held through preflight, staging, apply, final
validation, rollback and cleanup, and released on every success and
failure path. A second restore fails with an explicit contention error
naming the lock it could not take. Lock files end in `-lock`/`.lock`,
so they are never picked up by backup or by the unlisted-artifact check.

The lock set serialises restores against each other only. It cannot
stop a running service from writing; the service-stop precondition
above is what makes a restore safe.

Destinations are handled per target: each incoming copy and each
preserved original are created in that target's own directory, so the
JSON stores in the data directory, `TOKEN_STORE_PATH` and
`CHALLENGE_DB_PATH` may sit on different volumes (a rename is used where
possible, otherwise a size-verified copy plus unlink). Originals
(`<name>.origin.<nonce>`, together with their `-wal`/`-shm`/`-journal`
sidecars) are kept until every target passes final validation and are
only then removed; any failure rolls all applied targets back in reverse
order.

`--force` solely permits overwriting existing targets. A destination
holding `*.json`/`*.sqlite` stores the backup does not contain is refused
by default, because restoring would leave a mixed dataset; pass
`--allow-unlisted` (independent of `--force`) to keep them on purpose.

LIMIT — reconciliation is operation-level, not crash-atomic. There is no
durable recovery journal and no automatic crash recovery: if the process
is killed mid-apply, the originals survive beside their targets and must
be reconciled by hand. If a rollback itself fails, the error lists the
exact paths that still need manual recovery.

Every move carries the same operation tag, so related files can be
matched without guessing:

- `<name>.origin.<tag>` — the preserved main file (JSON store or SQLite
  database) that was in place before this restore.
- `<name>.origin.<tag>-wal`, `-shm`, `-journal` — that same database's
  sidecars, moved with it.
- `<name>.incoming.<tag>` — a staged replacement that was never swapped
  in (safe to delete once you have confirmed the target is intact).

Recovery after a crash:

1. Stop the service. Do not start it against a half-restored directory.
2. List the directory and group files by the tag after `.origin.`. One
   tag is one restore attempt; newer attempts have later timestamps.
3. Identify the state per target before moving anything:
   - Case A - the main file was moved aside, its sidecars were not. The
     target name is missing, `<target>.origin.<tag>` exists, and
     `<target>-wal` / `<target>-shm` / `<target>-journal` are still under
     their normal target names and no `<target>.origin.<tag>-wal` / `-shm` /
     `-journal` exists. Those sidecars belong to the origin file:
     a rename changes neither the database nor the salt in its `-wal`, so
     they are the same generation. Recover by renaming
     `<target>.origin.<tag>` back to `<target>` and leaving the sidecars
     exactly where they are. Do not rename `<target>-wal` to
     `<target>.origin.<tag>-wal`: the main file would come back without the
     committed transactions that live only in the WAL.
   - Case B - the main file and its sidecars were already moved aside.
     `<target>` is missing, and `<target>.origin.<tag>`,
     `<target>.origin.<tag>-wal`, `<target>.origin.<tag>-shm` and
     `<target>.origin.<tag>-journal` exist. Recover by moving the whole
     matching group back as one generation:
     `<target>.origin.<tag>` to `<target>`,
     `<target>.origin.<tag>-wal` to `<target>-wal`,
     `<target>.origin.<tag>-shm` to `<target>-shm`, and
     `<target>.origin.<tag>-journal` to `<target>-journal`.
   - Intermediate state - the main file and only some of its sidecars were
     moved aside before the crash. `<target>` is missing,
     `<target>.origin.<tag>` exists, one or more of
     `<target>.origin.<tag>-wal` / `<target>.origin.<tag>-shm` /
     `<target>.origin.<tag>-journal` exist, and the sidecars that were not
     moved yet still sit under `<target>-wal` / `<target>-shm` /
     `<target>-journal`. Every `<target>.origin.<tag>` file is one
     generation, including the sidecars that were never moved: the
     replacement is moved into the target name only after every sidecar of
     the previous generation has been moved aside, so a target-named
     sidecar cannot belong to the incoming copy. Recover the sidecars
     first: rename each `<target>.origin.<tag><suffix>` back to
     `<target><suffix>`, matching the exact same tag and suffix for every
     file, and leave the sidecars that were never moved exactly where
     they are. Only after every sidecar is back under its target name,
     rename `<target>.origin.<tag>` to `<target>`. Never delete
     `<target>.origin.<tag>-wal` because `<target>` is missing: the
     committed transactions in it are then the only copy.
   - Already swapped - `<target>` exists and `<target>.origin.<tag>` also
     exists: the replacement is in place for that target. Leave it, verify
     it, and only then delete the originals. Do not rename an origin back
     over a target that already validated.
4. Match files by the tag between `.origin.` and any `-wal`/`-shm`/`-journal`
   suffix: for example `tokenStore.sqlite.origin.<tag>` and
   `tokenStore.sqlite.origin.<tag>-wal` share one tag. The tag is
   `<UTC start>-<pid>`, so newer attempts have later timestamps. Never pair
   files whose tags differ, and never combine a main file with sidecars from
   another restore or another database generation: a `-wal` or `-journal`
   from another generation replays changes that do not belong to that file
   and can corrupt it or silently resurrect deleted data.
5. Do not open, checkpoint, delete or "tidy up" a partially recovered
   database before the matching main file and all of its sidecars are back
   under the same target name. Opening or checkpointing a database while its
   `-wal` sits under a different name makes SQLite ignore those committed
   transactions, and deleting a sidecar discards them permanently.
6. Delete leftover `.incoming.<tag>` files only after the target is
   verified with `verify.js` on the source backup and the database opens
   cleanly.
7. If you cannot tell which generation a sidecar belongs to, discard the
   sidecar and restore that database from the last verified backup.

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
