# Business Profile — Change Report

Date: 2026-06-28

## Implemented

- Added a backward-compatible `DB.settings.businessProfile` object.
- The default profile is `computer_shop`, business name `DigiTronics`, and currency `EGP`.
- Added presets for:
  - `computer_shop`
  - `car_parts`
  - `car_accessories`
  - `mobile_shop`
  - `electronics`
  - `general_store`
- Added the 12 requested field-visibility switches.
- Added a settings UI for business type, store name, logo, currency, and feature switches.
- Added optional product attributes for barcode, part number, brand, model, car make/model/year, color, size, unit, and storage location.
- Product create/edit forms react to the selected feature switches.
- Existing products are not rewritten. New attributes are optional and old products remain valid.
- The selected name/logo are applied to the login and sidebar branding.
- `formatMoney()` now uses the selected profile currency.
- Updated the PWA cache version so browsers receive the changed app shell.

## Data safety

- No existing table was renamed.
- No existing local data collection was deleted.
- The LocalStorage key remains `cairo_db_v7`.
- Existing invoices, products, serials, customers, suppliers, and all other arrays keep their current shapes and values.
- Missing profile data is filled in memory with the `computer_shop` defaults.
- Supabase was not changed automatically.

## Optional Supabase migration

Run `supabase_migration_business_profile_20260628.sql` manually in Supabase SQL Editor only if a cloud-side profile table is wanted.

The migration:

- Creates only `public.business_profile`.
- Seeds a single `default` profile using `computer_shop`.
- Uses `CREATE TABLE IF NOT EXISTS` and `ON CONFLICT DO NOTHING`.
- Enables RLS and deliberately does not grant anonymous access.
- Does not alter any existing table.

## Rollback

### Application-only rollback

1. Keep/export the current database backup.
2. Restore the previous `DigiTronics_v5.html` and `sw.js`.
3. Existing business profile and optional product fields may remain inside LocalStorage; old code ignores unknown properties, so no data cleanup is required.

### Supabase rollback

`supabase_rollback_business_profile_20260628.sql` is intentionally non-destructive. It performs no schema or data change and prints a notice only. The application can be rolled back independently while preserving the optional `public.business_profile` table and all cloud data.
