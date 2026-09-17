# ESO Configurable ERP — Implementation Report

Date: 2026-06-29

## Business Profile

The profile remains stored under `DB.settings.businessProfile`; the existing LocalStorage key is unchanged.

Supported canonical business types:

- `computer_shop`
- `auto_parts`
- `auto_accessories`
- `mobile_shop`
- `electronics`
- `pharmacy`
- `supermarket`
- `restaurant`
- `fashion`
- `hardware`
- `furniture`
- `custom`

Legacy saved values are accepted safely:

- `car_parts` → `auto_parts`
- `car_accessories` → `auto_accessories`
- `general_store` → `custom`

The default remains `computer_shop`.

Profile fields now include business name, logo, currency, currency symbol, language, time zone, business type, and feature flags.

The current type/profile are globally readable through:

- `window.getCurrentBusinessType()`
- `window.getBusinessProfile()`
- `document.documentElement.dataset.businessType`
- the `businessprofilechange` browser event after saving

## Product Schema Engine

`PRODUCT_SCHEMA_PRESETS` defines optional product fields by business type.

Examples implemented:

- Computer shop: CPU, RAM, SSD, GPU.
- Auto parts: compatible vehicles and OEM number, alongside part/model/year fields.
- Auto accessories: material and compatible vehicles, alongside color/size fields.
- Pharmacy: expiration date, batch number, dosage.
- Supermarket: weight and expiration date, alongside barcode/unit fields.
- Restaurant: ingredients and kitchen category, alongside unit.
- Fashion, hardware, furniture, mobile, electronics, and custom presets are included.

Dynamic values are stored in each product's optional `customFields` object. Existing product properties and records are preserved.

The add/edit forms render the current schema automatically. Product details render applicable fields automatically. Product search includes schema values, category, brand, barcode, and part number.

## Reusable master data

- Added `DB.categories` and `DB.brands`.
- Products can optionally reference `categoryId` and `brandId`.
- Existing products receive only safe in-memory defaults (`null` and `{}`) when missing.
- Categories and brands can be archived only when not linked to any product.
- Existing Suppliers, Customers, and Warehouses modules were reused without changing their transaction logic.
- Existing purchase, sale, serial, stock, supplier, customer, and warehouse behavior remains intact.

## Data safety

- No collection or existing feature was removed.
- No base table name changed.
- No Supabase script was executed.
- The LocalStorage database key remains `cairo_db_v7`.
- Existing computer-shop behavior and serial tracking remain the default.
- Old unknown/additional product properties remain untouched.

## Rollback

Restore the previous application files (`DigiTronics_v5.html`, `sw.js`, and `manifest.json`). The older code safely ignores the additional profile, categories, brands, category/brand IDs, and `customFields`.

The Supabase rollback file is intentionally a no-op. It preserves all cloud data and prints a notice only.
