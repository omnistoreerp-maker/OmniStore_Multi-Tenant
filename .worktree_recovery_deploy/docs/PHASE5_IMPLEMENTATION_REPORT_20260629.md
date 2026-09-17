# OmniStore Phase 5 — Multi Business Plugin Platform

Date: 2026-06-29

## Summary

OmniStore now loads each supported Business Type from an independent plugin folder. The Plugin SDK connects installed modules to existing Phase 3/4 services without replacing DigiTronics transaction logic.

## New platform files

- `services/pluginSdk/pluginSdk.js`
- `services/pluginSdk/pluginUi.js`
- `services/pluginSdk/DEVELOPER_GUIDE.md`
- `services/pluginSdk/tests/pluginSdk.unit.test.js`
- `services/pluginSdk/tests/pluginPlatform.integration.test.js`

## New plugin folders

- `plugins/business/computer_shop`
- `plugins/business/auto_parts`
- `plugins/business/restaurant`
- `plugins/business/supermarket`
- `plugins/business/pharmacy`
- `plugins/business/mobile_shop`
- `plugins/business/clothes`
- `plugins/business/jewelry`
- `plugins/business/hardware`
- `plugins/business/bookstore`
- `plugins/business/agriculture`
- `plugins/business/generic_store`

Each folder contains `manifest.json` and `plugin.js`.

## Modified files

- `DigiTronics_v5.html`
- `sw.js`
- `services/businessEngine/businessEngine.js`
- `services/modulePlatform/moduleRegistry.js`
- `services/modulePlatform/navigationBuilder.js`
- `services/modulePlatform/dashboardBuilder.js`

No SQL, migration, schema, or Supabase file was modified.

## Implemented

- Business Plugin Registry and SDK.
- Install/uninstall/enable/disable lifecycle.
- Local Marketplace.
- Independent plugin settings pages.
- Plugin permissions and feature flags.
- Arabic/English localization.
- Plugin product schemas and validation.
- Dynamic Product Forms through Business Engine.
- Dynamic Sidebar and routes.
- Dynamic Dashboard cards.
- Dynamic plugin report definitions and report cards.
- Plugin-scoped categories, brands, units, and tags.
- Alias compatibility for legacy names such as `fashion`, `book_store`, `general_store`, and `grocery`.
- Offline PWA cache entries for every bundled plugin.

## Local storage

Plugin state is stored only in:

`omnistore_business_plugins_v1`

Existing operational data stays in its current storage and is not migrated.

## Backward compatibility

- `computer_shop` remains the default.
- DigiTronics functions were not deleted or renamed.
- Sales, purchases, products, stock, treasury, reports, and maintenance keep their original implementation.
- Phase 3 schemas remain fallback when a plugin is disabled/uninstalled.
- Existing products and custom fields are not rewritten.

## Breaking changes

None intended.
