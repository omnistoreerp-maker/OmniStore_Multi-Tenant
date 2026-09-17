# OmniStore Phase 5 — Non-destructive Rollback

## No database rollback

Phase 5 did not run or modify SQL, migrations, tables, or Supabase. No database rollback is required.

## File rollback

Restore the previous versions of:

- `DigiTronics_v5.html`
- `sw.js`
- `services/businessEngine/businessEngine.js`
- `services/modulePlatform/moduleRegistry.js`
- `services/modulePlatform/navigationBuilder.js`
- `services/modulePlatform/dashboardBuilder.js`

The following new folders may remain safely because previous HTML does not load them:

- `services/pluginSdk`
- `plugins/business`

## Local configuration rollback

Optionally remove only:

`omnistore_business_plugins_v1`

This resets Marketplace installation/enabled state and plugin settings.

Never delete:

`cairo_db_v7`

It contains operational data.

## Emergency reset without file rollback

Run in the browser console:

```js
localStorage.removeItem('omnistore_business_plugins_v1');
location.reload();
```

All bundled plugins return to their defaults. Products, invoices, stock, customers, suppliers, treasury, and maintenance data remain unchanged.

## Compatibility

If all Business Plugins are removed or disabled, the existing Phase 3 Business Schema Registry remains the non-destructive fallback.
