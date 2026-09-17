(function (root) {
  'use strict';
  const ns = root.OmniERPIntegration = root.OmniERPIntegration || {};
  const v = () => ns.IntegrationValidator;

  function itemQty(item) {
    return v().number(item.quantity ?? item.qty, 0);
  }

  function itemCost(item, inventoryEngine) {
    const explicit = v().number(item.unitCost ?? item.cost ?? item.purchasePrice ?? item.buyPrice, NaN);
    if (Number.isFinite(explicit) && explicit > 0) return v().money(explicit);
    if (inventoryEngine && item.itemId && item.warehouseId && inventoryEngine.averageCost) {
      const avg = inventoryEngine.averageCost(item.itemId, item.warehouseId);
      if (avg && avg.averageCost > 0) return v().money(avg.averageCost);
    }
    return 0;
  }

  function effect(items = [], direction, inventoryEngine) {
    return Object.freeze(v().list(items).map(item => {
      const quantity = itemQty(item);
      const unitCost = itemCost(item, inventoryEngine);
      const before = inventoryEngine && item.itemId && item.warehouseId && inventoryEngine.onHandQty
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
        costEffect: v().money(quantity * unitCost),
        onHandBefore: before,
        onHandAfter: before == null ? null : v().money(before + delta),
        relatedDocument: item.reference || ''
      });
    }));
  }

  function transfer(document = {}, inventoryEngine) {
    const items = v().list(document.items).length ? document.items : [document];
    return Object.freeze([
      ...effect(items.map(item => ({ ...item, warehouseId: document.fromWarehouseId })), 'out', inventoryEngine),
      ...effect(items.map(item => ({ ...item, warehouseId: document.toWarehouseId })), 'in', inventoryEngine)
    ]);
  }

  ns.InventoryIntegrationAdapter = Object.freeze({ version: '1.0.0', effect, transfer, itemCost, itemQty });
})(typeof globalThis !== 'undefined' ? globalThis : window);
