# Phase 17 Non-Destructive Rollback

1. Remove `services/demoPolish/`.
2. Remove only the Phase 17 script tags, demo safety badges/styles, customer guide container, Arabic wording changes, and customer-guide render hook from `DigiTronics_v5.html`.
3. Remove only Phase 17 assets from `sw.js`.
4. Restore cache identifier `omnistore-erp-v22-uat-readiness`.
5. Restore the previous cache-version assertions in Phase 13, 15, and 16 tests.
6. Reload the service worker.

No database, SQL, Supabase, accounting, inventory, or localStorage rollback is required.
