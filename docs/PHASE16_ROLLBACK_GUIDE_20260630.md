# Phase 16 Non-Destructive Rollback Guide

1. Remove the `services/uat/` folder.
2. Remove only Phase 16 script tags, four Reports navigation items, four UAT page blocks, permission-map entries, and render hooks from `DigiTronics_v5.html`.
3. Remove only `services/uat/` cache entries from `sw.js`.
4. Restore cache identifier `omnistore-erp-v21-runtime-validation`.
5. Restore the Phase 13 and Phase 15 cache-version test assertions if required.
6. Reload the service worker/application shell.

No database, Supabase, SQL, migration, accounting, inventory, or localStorage rollback is required.
