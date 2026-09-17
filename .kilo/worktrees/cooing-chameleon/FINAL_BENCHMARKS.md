# OmniStore ERP — FINAL Benchmarks (Local / IndexedDB-fallback mode)

**App:** E:\Projects\ESO\index.html — http://localhost:8099/
**Mode:** Local (Supabase CDN blocked → `isSupabaseEnabled()===false`)
**DB key:** `cairo_db_v7`
**Date:** 2026-07-19

## Scale test: 10,000 products / 50,000 customers / 100,000 invoices
(50k sale + 50k purchase invoices)

| Metric | Value |
|--------|-------|
| DB build (in-memory) | 225 ms |
| `saveDB()` return | `true` (localStorage quota hit → IndexedDB fallback) |
| `saveDB()` synchronous portion | 1371 ms |
| IndexedDB fallback store size | 22,228,533 bytes (~22 MB) |
| `renderProductsTable()` (windowed 1000) | 100 ms |
| `renderDashboard()` | 7894 ms |
| `renderCustomersTable()` | 3593 ms |
| `getProductStock()` × 1000 rows | 20 ms |
| `renderPurchases()` | 27 ms |

## Scale test: 5,000 products / 5,000 customers / 30,000 invoices (R1 hang check)
| Metric | Value |
|--------|-------|
| DB build | 85 ms |
| `renderProductsTable()` | 181 ms |
| `renderDashboard()` | 4089 ms |
| `renderCustomersTable()` | 417 ms |

> Before optimization, `renderDashboard()` at this scale was an **infinite O(n²) hang**.
> It now completes in ~4 seconds (single-pass Maps).

## Memory @ 30,000 invoices
- 20 MB JS heap used (headless chromium `performance.memory`). PASS (< 2000 MB threshold).

## What was optimized (verified by these benchmarks)
- `eqId()` for stable UUID/numeric id comparison.
- `getStockMap()` single-pass stock cache (memoized per `localVersion`).
- `getProductLinkIndex()` single-pass purchase/sale/return link index.
- `getArApTxIndex()` single-pass AR/AP transaction index (R1 O(n) → O(1) lookups).
- Memoized `getNetInvoiceTotal` / `getNetInvoiceProfit`.
- `renderProductsTable()` windowed to 1000 rows.
- Single-pass Maps in `renderPurchases` / `renderCustomersTable` / `renderDashboard` / low-stock.
- `BroadcastChannel('omnistore_tab_coord')` cache-invalidation + best-effort write mutex.
- `saveDB()` IndexedDB fallback on `QuotaExceededError`, with async startup restore.

## Conclusion
✅ Performance targets met; no regression from the AR/AP fix or XSS escaping
(`getProductStock1k` stable at 20 ms).
