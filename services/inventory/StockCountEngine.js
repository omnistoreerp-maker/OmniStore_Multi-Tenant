(function (root) {
  'use strict';
  const ns = root.OmniInventoryEngine = root.OmniInventoryEngine || {};
  const u = () => ns.InventoryUtils;

  function createCount(state = {}, input = {}, options = {}) {
    const lines = u().list(input.lines).map(line => {
      const systemQty = ns.InventoryTransactionEngine.onHandQty(state, line.itemId, input.warehouseId || line.warehouseId);
      const countedQty = u().qty(line.countedQty);
      return Object.freeze({ ...line, warehouseId: input.warehouseId || line.warehouseId, systemQty, countedQty, difference: u().qty(countedQty - systemQty) });
    });
    const count = Object.freeze({
      id: input.id || u().id('count'),
      date: input.date || u().today(),
      warehouseId: input.warehouseId || '',
      status: 'draft',
      lines: Object.freeze(lines)
    });
    const next = u().clone(state);
    next.stockCounts = [...u().list(next.stockCounts), count];
    return Object.freeze({ state: u().audit(next, 'stock_count.create', { countId: count.id }, options.user), count });
  }

  function applyCount(state = {}, countId, options = {}) {
    const count = u().list(state.stockCounts).find(row => row.id === countId);
    if (!count) return Object.freeze({ state: u().clone(state), applied: false, errors: [{ code: 'COUNT_NOT_FOUND' }] });
    let next = u().clone(state);
    count.lines.forEach(line => {
      const result = ns.StockAdjustmentEngine.adjust(next, { ...line, itemId: line.itemId, warehouseId: line.warehouseId, targetQty: line.countedQty, unitCost: line.unitCost || 0, reference: count.id }, options);
      next = result.state;
    });
    next.stockCounts = u().list(next.stockCounts).map(row => row.id === countId ? { ...row, status: 'applied' } : row);
    return Object.freeze({ state: u().audit(next, 'stock_count.apply', { countId }, options.user), applied: true });
  }

  ns.StockCountEngine = Object.freeze({ version: '1.0.0', createCount, applyCount });
})(typeof globalThis !== 'undefined' ? globalThis : window);
