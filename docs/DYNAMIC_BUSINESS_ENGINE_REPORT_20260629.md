# OmniStore ERP — Phase 3 Dynamic Business Engine

Date: 2026-06-29

## New files

- `services/businessEngine/registry.js`
- `services/businessEngine/businessEngine.js`
- `services/businessEngine/README.md`
- `services/businessEngine/tests/businessEngine.test.js`
- `DYNAMIC_BUSINESS_ENGINE_REPORT_20260629.md`

## Modified files

- `DigiTronics_v5.html`
- `sw.js`

No SQL or migration file was created, executed, or modified. Supabase was not accessed.

## Added

### Business Schema Registry

JSON-compatible schemas for:

- `computer_shop`
- `auto_parts`
- `mobile_shop`
- `electronics`
- `restaurant`
- `supermarket`
- `pharmacy`
- `fashion`
- `grocery`
- `hardware`
- `book_store`
- `general_store`

Each schema exposes Product, Customer, Supplier, Invoice, Purchase, and Sale fields, plus categories, brands, units, and product tags.

Existing application aliases such as `auto_accessories`, `custom`, `car_parts`, and `car_accessories` resolve safely to a compatible schema.

### Dynamic engines

- Product activity-field form renderer.
- Value collector separating compatibility properties from `customFields`.
- Validation engine with required/type/select validation.
- Product table columns selected automatically by Business Type.
- Product details generated from the same schema.
- Local master-data defaults scoped by Business Type.
- Runtime custom schema registration.

Supported controls:

- text
- number
- select
- checkbox
- textarea
- date
- serial
- barcode
- currency

### Validation examples

- Auto Parts requires OEM Number, Vehicle Brand, and Compatible Models.
- Restaurant requires Kitchen while Calories remains optional.
- Pharmacy requires Batch Number and Expiration Date.
- Book Store requires ISBN and Author.

### Backward compatibility

- Core name, prices, stock, minimum stock, and serial-tracking controls remain connected to the original transaction logic.
- `computer_shop` stays the default.
- Existing products are not rewritten.
- Existing top-level fields and earlier camelCase custom fields are recognized through `legacyKey`.
- Existing unscoped categories/brands remain visible.
- New dynamic values are additive (`customFields`, `businessType`, `unitId`, and `tags`).

## Test results

All JavaScript syntax checks passed:

- Registry service.
- Engine service.
- Both inline application scripts.
- Standalone test file.

Ten executed engine suites passed:

1. Registry completeness.
2. Six-entity coverage.
3. Supported field-type coverage.
4. Auto Parts validation.
5. Restaurant validation.
6. Dynamic table differences.
7. Master-data isolation.
8. Unknown-type fallback.
9. All control renderers and runtime registration.
10. Details and legacy-key compatibility.

## Manual test

1. Open OmniStore and select `computer_shop`.
2. Add/edit a product and confirm CPU/RAM/SSD/GPU fields.
3. Verify the product table includes the current schema columns.
4. Open product details and verify schema values.
5. Switch to `auto_parts`.
6. Attempt to save without OEM/Vehicle Brand/Compatible Models and verify validation.
7. Fill required values and save.
8. Open Master Data and verify activity-specific categories, brands, units, and tags.
9. Switch to `restaurant` and verify Kitchen is required while Calories is optional.
10. Return to `computer_shop` and verify existing serial, purchase, sale, stock, treasury, reports, and maintenance behavior.

## Breaking changes

None intended.

The old activity-specific inputs remain in source for rollback and compatibility, but are hidden when the Dynamic Business Engine is available. The original core product and transaction controls remain active.

## Non-destructive rollback

Restore the previous:

- `DigiTronics_v5.html`
- `sw.js`

The `services/businessEngine` folder may remain because older HTML does not load it. New optional product/master-data properties are ignored by older code. Do not remove or reset `cairo_db_v7`.
