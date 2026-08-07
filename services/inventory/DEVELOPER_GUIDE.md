# Developer Guide — Inventory Engine

## Load Order

1. `InventoryUtils.js`
2. `UnitConversionEngine.js`
3. `ItemEngine.js`
4. `WarehouseEngine.js`
5. `StockMovementEngine.js`
6. `InventoryTransactionEngine.js`
7. `InventoryValidator.js`
8. `TransferEngine.js`
9. `StockAdjustmentEngine.js`
10. `StockCountEngine.js`
11. `ReorderEngine.js`
12. `ReservationEngine.js`
13. `InventoryEngine.js`

## Quick Start

```js
const engine = OmniInventoryEngine.InventoryEngine.createEngine();

engine.upsertItem({
  id: 'item-1',
  name: 'Product',
  baseUnit: 'pcs',
  reorderPoint: 5,
  trackSerial: true,
  trackBatch: true
});

engine.upsertWarehouse({ id: 'main', name: 'Main Warehouse' });

engine.receive({
  itemId: 'item-1',
  warehouseId: 'main',
  quantity: 10,
  unitCost: 100,
  batch: 'B1',
  serialNumber: 'S1'
});
```

## Quantity Terms

- `onHandQty`: physical quantity from stock movements.
- `committedQty`: active reservations.
- `availableQty`: on hand minus committed.

## Costing

- FIFO layers are calculated from receipt and issue movements.
- Average cost is calculated from remaining inventory value and quantity.

## Integration Rule

Current Phase 9 is read-only/in-memory integration only. If UI or database integration is needed later, create a separate adapter and keep this engine unchanged.
