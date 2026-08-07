# Developer Guide — ERP Integration Preview Layer

## Load Order

1. Phase 8 Accounting Engine.
2. Phase 9 Inventory Engine.
3. Phase 10 Auto Posting Preview.
4. Phase 12 Integration files:
   - `IntegrationValidator.js`
   - `AccountingIntegrationAdapter.js`
   - `InventoryIntegrationAdapter.js`
   - `SalesIntegrationAdapter.js`
   - `PurchaseIntegrationAdapter.js`
   - `ManufacturingIntegrationAdapter.js`
   - `POSIntegrationAdapter.js`
   - `PreviewAggregator.js`
   - `PreviewDispatcher.js`
   - `ERPIntegrationEngine.js`

## Quick Start

```js
const integration = OmniERPIntegration.ERPIntegrationEngine.createEngine({
  accountingEngine,
  inventoryEngine,
  autoPostingEngine
});

const preview = integration.preview({
  docType: 'sales_invoice',
  paymentType: 'credit',
  customerId: 'C1',
  items: [{ itemId: 'p1', warehouseId: 'main', quantity: 2, price: 100 }]
});
```

## Adding an Adapter

1. Create a small adapter that returns raw preview data.
2. Add dispatch logic in `PreviewDispatcher.js`.
3. Let `PreviewAggregator.js` normalize the final output.

Never call save/post methods from adapters.
