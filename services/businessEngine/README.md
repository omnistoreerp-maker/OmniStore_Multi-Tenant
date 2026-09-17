# OmniStore Dynamic Business Engine

## Architecture

```text
registry.js
  └─ JSON-compatible schemas
       ├─ product fields
       ├─ customer fields
       ├─ supplier fields
       ├─ invoice fields
       ├─ purchase fields
       ├─ sale fields
       └─ categories / brands / units / tags

businessEngine.js
  ├─ schema lookup and aliases
  ├─ dynamic form rendering
  ├─ value collection
  ├─ validation
  ├─ dynamic table headers/cells
  ├─ details rendering
  └─ runtime schema registration

DigiTronics_v5.html
  └─ compatibility adapter
       ├─ existing product identity/prices/stock/serial tracking
       ├─ dynamic activity fields
       ├─ local master data
       └─ existing sales/purchase/inventory logic
```

The service is DOM-light. Schema lookup, validation, table selection, and details resolution can run without the application. `renderFields` and `collectValues` are the only APIs that optionally use DOM containers.

## Runtime flow

1. OmniStore reads the current local Business Type.
2. `OmniBusinessEngine.getSchema(type)` resolves the schema or falls back to `computer_shop`.
3. The product modal calls `renderFields("product", type)`.
4. On save, `collectValues()` separates direct compatibility fields from `customFields`.
5. `validate()` enforces the current schema.
6. The product is stored in the existing LocalStorage database shape.
7. Product table columns and product details are rendered from the same schema.

No Supabase read/write is used by the engine.

## Field definition

```js
{
  key: "oem_number",
  label: "OEM Number",
  type: "text",
  required: true,
  table: true,
  storage: "custom"
}
```

Supported types:

- `text`
- `number`
- `select`
- `checkbox`
- `textarea`
- `date`
- `serial`
- `barcode`
- `currency`

Set `storage: "direct"` only when a field must remain a top-level product property for backward compatibility. Otherwise it is stored under `product.customFields`.

## Add a business in under one minute

Open `registry.js`, copy one entry inside `definitions`, and change its fields/defaults:

```js
pet_store: {
  product: [
    field("pet_type", "Pet Type", "select", {
      required: true,
      table: true,
      options: ["cat", "dog", "bird"]
    }),
    field("age_months", "Age (months)", "number")
  ],
  masterData: {
    categories: ["Pets", "Food", "Accessories"],
    brands: [],
    units: ["قطعة", "عبوة"],
    tags: ["Vaccinated", "Imported"]
  }
}
```

Then add `pet_store` to the Business Type selector and the compatibility `BUSINESS_TYPES` array in the application. All six entity arrays are created automatically from common defaults; add `customer`, `supplier`, `invoice`, `purchase`, or `sale` arrays only for extra fields.

For a runtime-only schema, call:

```js
OmniBusinessEngine.registerSchema("pet_store", completeSchemaObject);
```

## Public API

- `listBusinessTypes()`
- `normalizeType(type)`
- `getSchema(type)`
- `getFields(entity, type)`
- `getMasterData(type)`
- `renderFields(entity, type, values, options)`
- `collectValues(container)`
- `validate(entity, values, type)`
- `getTableFields(type, limit)`
- `renderTableHeaders(type, limit)`
- `renderTableCells(product, type, limit)`
- `renderDetails(product, type)`
- `registerSchema(type, schema)`

## Tests

Run from the project root when Node.js is available:

```powershell
node --test services/businessEngine/tests/businessEngine.test.js
```

Tests cover registry completeness, entity definitions, every input type, conditional required fields, table differences, master-data isolation, custom registration, and fallback behavior.

## Non-destructive rollback

Restore the previous `DigiTronics_v5.html` and `sw.js`. The new service folder can remain because old HTML does not load it. Existing products containing `customFields`, `businessType`, `unitId`, or `tags` remain valid and are ignored safely by older code.
