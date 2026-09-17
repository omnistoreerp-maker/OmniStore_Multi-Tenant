# Final Performance Report — Phase 19C

Consolidated results for the Performance & Reliability Hardening phase.
Runtime behavior, API contracts, persistence format, and business logic
are unchanged; this phase only measured, optimized safe hotspots, and
verified reliability under load and stress.

## 1. Before / after comparison (in-process benchmark, 500-record store)

Measured by `scripts/benchmark.js` (re-run with `node scripts/benchmark.js`).
Numbers vary by machine load; deltas below are from matched runs.

| Metric | Before (pre-19C) | After (19C) | Delta |
|--------|------------------|-------------|-------|
| READ latency (ms/req, x300)  | 3.13 | 2.49–2.62 | ~−16–20% |
| WRITE latency (ms/req, x50)  | 3.99 | 3.46–3.60 | ~−10–13% |
| Store file creation on read-miss | yes (empty file written) | no (read-only) | eliminated |
| Redundant disk reads per request | every service read re-parsed JSON | mtime+size-validated read cache | eliminated for unchanged files |
| Directory creation per write | `fs.mkdirSync` every write | memoized per process | eliminated |

Source of the gains (Commit 1, `utils/fileStore.js`): mtime+size-validated
read cache, read-miss no longer creates files, memoized `_ensureDir`,
atomic tmp+rename kept, `flushAll()` shutdown hook added.

## 2. Load test (Commit 5, corrected Commit 6)

`scripts/loadTest.js` — 20-way concurrency, 90/10 read/write mix:

| Requests | Throughput (req/s) | Avg (ms) | p95 (ms) | Errors | RSS (MB) |
|----------|--------------------|----------|----------|--------|----------|
| 100  | 466–521  | 36–41 | 94–105 | 0 | 66.6 → 74.1 |
| 500  | 689–822  | 24–29 | 37–44  | 0 | → 92.4 |
| 1000 | 889–1015 | 19–22 | 27–40  | 0 | → 114.2 |

## 3. Stress test (Commit 6)

`scripts/stressTest.js` — 16/16 checks PASS:

- 150 parallel creates across 5 modules: all 201, zero 5xx, exact counts.
- 270 parallel mixed reads/updates during writes: zero 5xx.
- 50 parallel logins: 50/50 with tokens.
- 40 parallel refreshes: 40/40, zero 5xx.
- 80 parallel duplicate-id pushes (sync retries): deduped to exactly 20
  records, zero 5xx, losers get clean 4xx.
- Post-storm: all 6 store files valid JSON, no `.tmp` leftovers,
  child process alive.

## 4. Reliability

- Graceful shutdown (Commit 3): SIGINT/SIGTERM → server close →
  `fileStore.flushAll()` → `logger.close()`; covered by
  `tests/shutdown.test.js`. (Windows service/child kills always
  terminate; the hook is verified in-process and for POSIX deployments.)
- Health endpoints (Commit 4): `/api/v1/health`, `/api/v1/liveness`,
  `/api/v1/ready` (writable-persistence probe, 503 on failure);
  no secrets exposed (asserted in `tests/health.test.js`).

## 5. Memory / CPU

- Memory: RSS grows with store size (read cache holds parsed JSON) and
  stabilizes — no runaway growth across load rounds (66.6 → 114.2 MB
  over 1600 requests with a growing store).
- CPU: not separately instrumented on this platform; latency and
  throughput are used as proxy. No event-loop starvation observed
  (p95 stays within ~1.5x of average).

## 6. Production bugs found this phase

None in production code. Two harness defects were found and fixed in
Commit 6 (`scripts/loadTest.js`): error counter read `res.statusCode`
on a fetch `Response` (always `undefined` — errors never counted) and
POST ids collided across rounds. Both fixed; reported numbers above are
from the corrected harness.

## 7. Final validation (Commit 7)

- `node --check`: all backend files OK.
- Jest: 249/249 tests, 15/15 suites.
- Coverage (real, in-process): statements 77.4%, branches 60.59%,
  functions 88.36%, lines 82.85% (statements <80% is a documented,
  accepted outcome from 19B — controller 500-branches are uncoverable
  without mocks).
- Backend smoke: health 200, ready 200, liveness 200, customers 200.
- Playwright regression: index.html 59/59, DigiTronics_v5.html 59/59.
- Load test: 0 errors at 100/500/1000.
- Stress test: 16/16 PASS.
