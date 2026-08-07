# Phase 24 Rollback Report

Rollback is non-destructive because Phase 24 created no live tenant or database state.

1. Remove `services/tenancy`.
2. Remove `services/supabaseSetup`.
3. Remove `database/supabasePreview` (draft files only).
4. Remove the Phase 24 script tags, CSS, navigation items, pages, permission mappings, and render hooks from `DigiTronics_v5.html`.
5. Remove Phase 24 assets from `sw.js` and restore the previous cache name.
6. Restore the earlier Phase 23 cache-version test assertion if required.
7. Remove the seven Phase 24 documentation files.
8. Run the Phase 8–23 regression suite; expected baseline is 507/507.

Do not run `rollback_multi_tenant_preview.sql`; it is a future database rollback draft, not the rollback mechanism for this preview-only phase.
