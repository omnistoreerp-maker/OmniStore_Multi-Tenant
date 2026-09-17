# Phase 15 Non-Destructive Rollback

Rollback does not require data restoration because Phase 15 creates no records and changes no storage format.

1. Remove the `services/runtimeValidation/` folder.
2. Remove only the Phase 15 runtime-validation script tags, panel, and render call from `DigiTronics_v5.html`.
3. Remove only the runtime-validation asset entries from `sw.js` and restore the previous cache identifier `omnistore-erp-v20-posting-readiness-center`.
4. Restore the Phase 13 cache-version assertion in `services/integration/tests/erpPreviewUi.test.js` if desired.
5. Reload the app/service worker.

No SQL rollback, migration rollback, Supabase action, database repair, or localStorage conversion is required.
