# Phase 22 Non-Destructive Rollback

1. Remove `services/dataLayer/`.
2. Remove `templates/dataLayer/`.
3. Remove only Phase 22 scripts, styles, seven navigation entries, seven pages, permission entries, and render hooks from `DigiTronics_v5.html`.
4. Remove Phase 22 assets from `sw.js`.
5. Restore cache identifier `omnistore-erp-v27-configuration-preview`.
6. Restore previous cache-version assertions.
7. Reload the application/service worker.

No data, database, SQL, Supabase, localStorage, accounting, inventory, or customer-copy rollback is required.
