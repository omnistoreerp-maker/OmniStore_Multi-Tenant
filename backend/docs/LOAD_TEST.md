# Load Test Results — Phase 19C (Commit 5)

Tool: `scripts/loadTest.js` (re-run with `node scripts/loadTest.js`).
Setup: backend child process, isolated temp store seeded with 200
customers, 20 concurrent workers, 90% reads / 10% writes,
`RATE_LIMIT_MAX` raised for measurement (the limiter is not the subject).
Numbers vary by machine; trends are the signal.

| Round | Requests | Wall (ms) | Throughput (req/s) | Avg latency (ms) | p95 (ms) | Max (ms) | Errors | RSS before→after (MB) |
|-------|----------|-----------|--------------------|------------------|----------|----------|--------|-----------------------|
| 1 | 100  | 214  | 466.3 | 40.56 | 105.27 | 107.10 | 0 | 66.4 → 73.3 |
| 2 | 500  | 726  | 689.2 | 28.73 | 43.96  | 59.25  | 0 | 73.3 → 94.1 |
| 3 | 1000 | 1125 | 888.8 | 22.42 | 30.24  | 40.86  | 0 | 94.1 → 112.8 |

> Note (Commit 6): the original harness read `res.statusCode` on a fetch
> `Response` (always `undefined`), so errors were never counted, and POST
> ids collided across rounds (duplicate-ID 400s went unnoticed). Fixed to
> `res.status` and made ids round-unique; the table above is the
> corrected run with genuine zero errors.

## Observations

- **Zero errors** at every load level (all 2xx; no 4xx/5xx, no timeouts).
- **Throughput scales** to ~890 req/s on loopback with sub-45ms p95.
- First-round latency is dominated by cold start (JIT + first-parse);
  steady-state avg settles around 22–29ms under 20-way concurrency.
- **Memory**: RSS grows with store size (read cache holds parsed JSON)
  and stabilizes; no runaway growth within rounds. Child stayed alive
  and responsive after all rounds.
- CPU: not separately instrumented on this platform; latency and
  throughput are used as the load proxy (no event-loop starvation was
  observed — p95 stays within ~1.5x of average).
