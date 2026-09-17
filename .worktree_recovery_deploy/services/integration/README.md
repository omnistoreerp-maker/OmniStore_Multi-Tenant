# OmniStore ERP Integration Preview Layer

Phase 12 adds a read-only integration preview layer.

It detects existing ERP-style documents and generates preview data only. It does not modify POS, Sales, Purchases, Inventory, Reports, Business Profiles, Authentication, Permissions, Supabase, SQL, localStorage, or UI files.

## Files

- `ERPIntegrationEngine.js`
- `AccountingIntegrationAdapter.js`
- `InventoryIntegrationAdapter.js`
- `SalesIntegrationAdapter.js`
- `PurchaseIntegrationAdapter.js`
- `ManufacturingIntegrationAdapter.js`
- `POSIntegrationAdapter.js`
- `PreviewDispatcher.js`
- `PreviewAggregator.js`
- `IntegrationValidator.js`

## Supported Previews

- Sales Invoice
- Purchase Invoice
- Sales Return
- Purchase Return
- POS Sale
- Manufacturing Consumption
- Manufacturing Production
- Inventory Transfer
- Inventory Adjustment
- Customer Payment
- Supplier Payment

## Output Shape

Each preview returns:

- Inventory Effect
- Accounting Effect
- Cost Effect
- Profit Effect
- Cash Effect
- Validation Errors
- Warnings
- Related Documents

## Safety

All results are preview-only:

- `readOnly: true`
- `persisted: false`
- `posted: false`

No save, post, migration, SQL, Supabase, or localStorage integration exists.
