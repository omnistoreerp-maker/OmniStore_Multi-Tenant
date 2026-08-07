# Performance Review — Phase 19C

## Hotspot review (Commit 2)

Reviewed for synchronous hotspots, repeated parsing, repeated
allocations, and duplicate filesystem access:

| Finding | Status |
|---------|--------|
| `fileStore.read` re-read + re-parsed the JSON file on **every** request | **Fixed in Commit 1** (mtime+size validated read cache) |
| `fileStore.read` created the store file on read-miss (write-on-GET) | **Fixed in Commit 1** (reads are now read-only) |
| `_ensureDir()` ran `existsSync` on every write | **Fixed in Commit 1** (memoized) |
| Repeated `_load()` calls inside service methods (e.g. create → duplicate-check) | Now served from the read cache — two cheap `stat` calls instead of full read+parse; no further change needed |
| Sort comparators allocate lowercase strings per comparison | Lists are small (hundreds of records); measured impact negligible — left unchanged to avoid speculative churn |
| Auth middleware cookie parsing | Early-returns when a Bearer token is present; no change needed |
| Pretty-print `JSON.stringify(data, null, 2)` | Required by the persistence format — contract, unchanged |
| Response envelope `time` field defeats ETag caching | Changing it alters the API contract — out of scope |

No other behavior-identical optimization was worth the churn.

## Benchmark (`scripts/benchmark.js`, 500-record store, loopback)

| Measurement | Before (5375626) | After Commit 1 (f118413) | Delta |
|-------------|------------------|--------------------------|-------|
| Sequential reads, 300x | 3.13 ms/req | 2.49 ms/req | **−20%** |
| Sequential writes, 50x | 3.99 ms/req | 3.46 ms/req | **−13%** |

Absolute numbers vary by machine; the delta is the signal. Re-run any
time with `node scripts/benchmark.js`.
