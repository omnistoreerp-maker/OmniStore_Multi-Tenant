# Phase 23 Non-Destructive Rollback

1. Remove `services/auth/`.
2. Remove `templates/auth/`.
3. Remove only Phase 23 scripts, styles, eight navigation entries, eight pages, permission entries, and render hooks from `DigiTronics_v5.html`.
4. Remove Phase 23 assets from `sw.js`.
5. Restore cache identifier `omnistore-erp-v28-data-layer-preview`.
6. Restore previous cache-version assertions.
7. Reload the application/service worker.

No user, password, session, cookie, database, SQL, Supabase, localStorage, accounting, inventory, or customer-copy rollback is required.
