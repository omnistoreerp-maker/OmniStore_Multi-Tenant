# Phase 33 Performance Flow

## UI scale

- Virtual scrolling calculates only the visible window and overscan.
- Chunked rendering calculates frame-sized batches.
- Pagination calculates offsets and limits without materializing records.
- Lazy-loading and image optimization are configuration previews.
- Background workers remain disabled plans.

## Database and realtime

Slow-query and large-table metadata produce index/pagination recommendations without SQL generation or execution. Connection pooling, repository profiling, Realtime reconnect, offline queue, and sync latency are preview-only.

## Memory and assets

The package evaluates injected memory snapshots, growth, large objects, cache hit rate, bundle size, compression savings, and lazy candidates. It never triggers garbage collection or edits assets.

## Scale simulation

100,000 products produce a small virtual window and 100 chunk descriptors. One million transactions produce pagination metadata for 10,000 pages. Allocated simulated records: zero.
