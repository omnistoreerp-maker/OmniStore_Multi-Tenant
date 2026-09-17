# Phase 6 Non-Destructive Rollback

Phase 6 created no database objects and wrote no accounting data, so rollback requires no SQL and no data restoration.

## Safe rollback steps

1. Remove the four accounting `<script>` tags from `DigiTronics_v5.html`.
2. Remove the `page-accounting-audit` block.
3. Remove `getAccountingReadOnlyStock`, `getOmniAccountingSnapshot`, its `window` export, the render hook and the route permission rule.
4. Remove the `accounting_core` entry from `services/modulePlatform/moduleRegistry.js`.
5. Remove the four accounting assets from `sw.js` and bump the cache version again.
6. Delete `services/accountingCore/` and the three Phase 6 report files.
7. Reload the application or clear only the PWA app-shell cache.

## Data safety

- Do not delete or edit `cairo_db_v7`.
- Do not change Supabase.
- Do not run a migration.
- No accounting journal records exist to reverse.

Existing products, invoices, purchases, treasury movements, stock movements and settings remain untouched.

