(function (root) {
  'use strict';

  const ns = root.OmniAutoPosting = root.OmniAutoPosting || {};
  const v = () => ns.AutoPostingValidator;

  function itemQty(item) {
    return v().number(item.qty ?? item.quantity, 0);
  }

  function itemPrice(item) {
    const qty = itemQty(item);
    if (item.total != null && qty) return v().money(v().number(item.total) / qty);
    return v().money(item.price ?? item.salePrice ?? item.unitPrice ?? 0);
  }

  function itemCost(item, inventoryEngine) {
    const explicit = v().number(item.cost ?? item.unitCost ?? item.purchasePrice ?? item.buyPrice, NaN);
    if (Number.isFinite(explicit) && explicit > 0) return v().money(explicit);
    if (inventoryEngine && item.itemId && item.warehouseId && inventoryEngine.averageCost) {
      const avg = inventoryEngine.averageCost(item.itemId, item.warehouseId);
      if (avg && avg.averageCost > 0) return v().money(avg.averageCost);
    }
    return 0;
  }

  function buildInventoryImpact(items = [], direction, inventoryEngine) {
    return Object.freeze(v().list(items).map(item => {
      const quantity = itemQty(item);
      const unitCost = itemCost(item, inventoryEngine);
      const onHandBefore = inventoryEngine && item.itemId && item.warehouseId && inventoryEngine.onHandQty
        ? inventoryEngine.onHandQty(item.itemId, item.warehouseId)
        : null;
      const delta = direction === 'in' ? quantity : -quantity;
      return Object.freeze({
        itemId: item.itemId || item.productId || '',
        name: item.name || item.productName || '',
        warehouseId: item.warehouseId || '',
        direction,
        quantity,
        unitCost,
        costImpact: v().money(quantity * unitCost),
        onHandBefore,
        onHandAfter: onHandBefore == null ? null : v().money(onHandBefore + delta),
        batch: item.batch || '',
        lot: item.lot || item.batch || '',
        serialNumber: item.serialNumber || '',
        expiryDate: item.expiryDate || ''
      });
    }));
  }

  function salesCostImpact(items = [], inventoryEngine) {
    return v().money(v().list(items).reduce((sum, item) => sum + itemQty(item) * itemCost(item, inventoryEngine), 0));
  }

  function invoiceAmount(items = [], fallback = 0) {
    const total = v().list(items).reduce((sum, item) => sum + itemQty(item) * itemPrice(item), 0);
    return v().money(total || fallback);
  }

  ns.InventoryAccountingBridge = Object.freeze({ version: '1.0.0', itemQty, itemPrice, itemCost, buildInventoryImpact, salesCostImpact, invoiceAmount });
})(typeof globalThis !== 'undefined' ? globalThis : window);
