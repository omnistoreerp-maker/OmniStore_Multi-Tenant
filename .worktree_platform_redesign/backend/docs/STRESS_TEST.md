# Stress Test Results — Phase 19C (Commit 6)

Tool: `scripts/stressTest.js` (re-run with `node scripts/stressTest.js`).
Setup: backend child process on a scratch port, isolated temp store,
`RATE_LIMIT_MAX` raised for measurement. All scenarios run fully in
parallel (`Promise.all`), then on-disk integrity is verified.

## Scenarios and results (all PASS, 16/16)

| Scenario | What it does | Result |
|----------|--------------|--------|
| Parallel CRUD storm | 150 creates (30 × 5 modules: customers, suppliers, treasury, employees, partners) fired simultaneously, then 270 parallel mixed reads/updates | All creates 201; zero 5xx; exact per-module counts (30 each) |
| Parallel logins | 50 simultaneous `POST /auth/login` for one user | 50/50 returned 200 + tokens |
| Parallel token refresh | 40 simultaneous `POST /auth/refresh` with the same refresh token | 40/40 succeeded; zero 5xx |
| Duplicate-push (sync retry) | 80 parallel pushes of 20 unique client-supplied ids (4 pushes each) | Zero 5xx; deduped final count exactly 20 |
| Store integrity | Every `.json` in the data dir parsed after the storm | 6/6 valid JSON; no `.tmp` leftovers |
| Process health | Child process checked after all scenarios | Alive and responsive |

## Conclusions

- **No corruption**: concurrent writes through `fileStore` (atomic
  tmp+rename) leave every store valid, with exact record counts.
- **No deadlocks / no crashes**: ~580 parallel requests across CRUD,
  auth, and sync-retry patterns produced zero 5xx and the process
  stayed alive.
- **Duplicate-ID safety**: racing sync retries of the same client id
  resolve to exactly one persisted record (losers get a clean 4xx,
  not a 5xx or a duplicate row).
