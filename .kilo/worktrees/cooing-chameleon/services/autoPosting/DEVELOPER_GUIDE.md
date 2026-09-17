# Developer Guide — Auto Posting Preview Engine

## Load Order

1. Phase 8 Accounting Engine files.
2. Phase 9 Inventory Engine files.
3. Phase 10 files:
   - `AutoPostingValidator.js`
   - `InventoryAccountingBridge.js`
   - `AccountingInventoryReconciler.js`
   - `SalesPostingPreviewEngine.js`
   - `PurchasePostingPreviewEngine.js`
   - `ReturnPostingPreviewEngine.js`
   - `PaymentPostingPreviewEngine.js`
   - `AutoPostingEngine.js`

## Quick Start

```js
const autoPosting = OmniAutoPosting.AutoPostingEngine.createEngine({
  accountingEngine,
  inventoryEngine
});

const preview = autoPosting.previewCashSale({
  id: 'INV-1',
  items: [
    { itemId: 'p1', warehouseId: 'main', quantity: 2, price: 100 }
  ]
});
```

## Important Safety Rule

This engine is preview-only. It must never:

- call accounting `post()`;
- call inventory `receive()` or `issue()`;
- write to Supabase;
- write to localStorage;
- execute SQL;
- mutate caller snapshots.

## Adding a New Operation

Create a new preview function that returns the standard object shape:

- `operation`
- `sourceType`
- `sourceId`
- `journalLines`
- `debitLines`
- `creditLines`
- `inventoryImpact`
- `costImpact`
- `profitImpact`
- `cashImpact`
- `customerSupplierImpact`
- `validationErrors`
- `warnings`
- `journalTotals`
- `valid`

Then expose it through `AutoPostingEngine.createEngine()`.
