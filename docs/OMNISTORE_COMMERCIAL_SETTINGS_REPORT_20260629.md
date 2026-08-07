# OmniStore ERP — Commercial Settings Implementation

Date: 2026-06-29

## Modified files

- `DigiTronics_v5.html`
- `manifest.json`
- `sw.js`

No SQL file was executed or changed in this phase. Supabase was not accessed or modified.

## Added

The central `OmniStore Settings` page now has Business Profile, Subscription, Printing, Barcode, Localization, and Advanced tabs.

Settings are isolated in the browser key `omnistore_settings_v1` and saved locally in `localStorage`. Operational data arrays are not included in settings export/import.

Business fields: company name/logo/phone/address, tax number, currency/symbol, language, timezone, date format, and number format.

Subscription fields: license key, plan, license status, trial end, and user/branch/product limits. They are informational and local only; no external validation was added.

Printing fields: invoice template, A4/80mm/58mm size, logo/tax visibility, and footer. Sales, purchase, and maintenance print views use the configured branding.

Barcode fields: enabled state, prefix, optional automatic generation for new products, and format. Existing products and barcodes are not rewritten.

Advanced actions: Export Settings JSON, Import Settings JSON, and Reset to Defaults. Reset affects settings only.

## Test checklist

1. Open `DigiTronics_v5.html`, log in as Owner/Admin, and open Settings.
2. Move through all six tabs.
3. Set a company name, phone, currency symbol, and save.
4. Verify `OmniStore ERP` and the company name in the sidebar/header.
5. Open a sales, purchase, or maintenance print preview.
6. Enable auto barcode, create a test product, and verify its barcode.
7. Export settings, change a value, then import the JSON.
8. Confirm existing operational data remains unchanged.

## Verification performed

- All inline JavaScript blocks passed syntax compilation.
- New UI IDs were checked for uniqueness.
- Defaults were tested: Arabic, EGP, `computer_shop`, free/trial, A4, barcode enabled without automatic generation.
- The dedicated `omnistore_settings_v1` localStorage key was verified.

## Non-destructive rollback

Restore the previous `DigiTronics_v5.html`, `manifest.json`, and `sw.js`.

Optionally remove only `omnistore_settings_v1`. Older code ignores it, so removal is not required. Never delete `cairo_db_v7`, which contains operational data.
