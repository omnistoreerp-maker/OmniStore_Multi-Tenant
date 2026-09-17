# Phase 19 Non-Destructive Rollback

1. Remove `services/clientHandoff/`.
2. Remove only Phase 19 scripts, styles, five Reports navigation items, five pages, permission entries, and render hooks from `DigiTronics_v5.html`.
3. Remove Phase 19 assets from `sw.js`.
4. Restore cache identifier `omnistore-erp-v24-uat-feedback`.
5. Restore previous cache-version assertions in regression tests.
6. Reload the application/service worker.

No SQL, database, Supabase, accounting, inventory, or localStorage rollback is required.
