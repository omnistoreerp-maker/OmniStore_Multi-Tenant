# Phase 20 Non-Destructive Rollback

1. Remove `services/releaseManager/`.
2. Remove `templates/customerCopy/`.
3. Remove only Phase 20 scripts, styles, four navigation items, four pages, permission entries, and render hooks from `DigiTronics_v5.html`.
4. Remove Phase 20 static assets from `sw.js`.
5. Restore cache identifier `omnistore-erp-v25-client-handoff`.
6. Restore previous cache-version assertions.
7. Reload the service worker/application.

No customer copy rollback is required because Phase 20 does not create or modify customer copies.

No SQL, database, Supabase, accounting, inventory, or localStorage rollback is required.
