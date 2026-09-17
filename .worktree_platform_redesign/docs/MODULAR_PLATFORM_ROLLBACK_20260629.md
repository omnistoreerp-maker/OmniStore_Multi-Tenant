# OmniStore Modular Platform — Non-destructive Rollback

## Important

Do not delete `cairo_db_v7`. It contains operational data.

No database or Supabase rollback is required because Phase 4 made no SQL, migration, or Supabase change.

## Rollback steps

1. Restore the previous `DigiTronics_v5.html`.
2. Restore the previous `sw.js`.
3. Reload the application and allow the old service-worker cache to activate.

The `services/modulePlatform` folder may remain. Previous HTML does not load it.

Optionally remove only this local browser key:

`omnistore_modules_v1`

Removing that key resets feature flags and module settings. It does not affect products, invoices, customers, suppliers, stock, treasury, repairs, or reports.

## Emergency feature reset without file rollback

From the OmniStore Settings Advanced tab, press `Reset Modules`.

If the UI cannot be reached, remove only `omnistore_modules_v1` from browser Local Storage and reload. Registry defaults will reactivate.

## Data compatibility

Phase 4 adds no fields to operational records. Therefore rollback requires no data conversion or cleanup.
