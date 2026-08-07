(function (root) {
  'use strict';
  const ns = root.OmniInventoryEngine = root.OmniInventoryEngine || {};
  const u = () => ns.InventoryUtils;

  function adjust(state = {}, input = {}, options = {}) {
    const current = ns.InventoryTransactionEngine.onHandQty(state, input.itemId, input.warehouseId);
    const target = u().qty(input.targetQty);
    const diff = u().qty(target - current);
    if (diff === 0) return Object.freeze({ state: u().clone(state), accepted: true, difference: 0 });
    const payload = { ...input, quantity: Math.abs(diff), unitCost: input.unitCost || 0, type: 'stock_adjustment' };
    const result = diff > 0
      ? ns.InventoryTransactionEngine.receive(state, payload, options)
      : ns.InventoryTransactionEngine.issue(state, payload, { ...options, checkStock: false });
    return Object.freeze({ ...result, difference: diff });
  }

  ns.StockAdjustmentEngine = Object.freeze({ version: '1.0.0', adjust });
})(typeof globalThis !== 'undefined' ? globalThis : window);
