# Phase 26 Rollback Report

## Code rollback

1. Remove `services/supabaseInstaller`.
2. Remove `supabase/functions/omnistore-installer`.
3. Remove Phase 26 pages, scripts, CSS, permissions, and render hooks from `DigiTronics_v5.html`.
4. Remove Phase 26 assets from `sw.js` and restore the Phase 25 cache version.
5. Restore earlier cache-version assertions and run the 629-test Phase 25 baseline.

## Database rollback

Phase 26 deliberately provides rollback preview only. Before a real installation, verify a Supabase backup/snapshot. A production rollback must compare `omnistore.schema_migrations`, generate a version-specific transactional plan, require a second administrator confirmation, and operate only on the isolated `omnistore` schema.

Do not drop the schema automatically: it may contain customer data after activation.
