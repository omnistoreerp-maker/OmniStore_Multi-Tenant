(function (root) {
  'use strict';
  const ns = root.OmniInventoryEngine = root.OmniInventoryEngine || {};
  const u = () => ns.InventoryUtils;

  function createItem(input = {}) {
    const baseUnit = u().text(input.baseUnit || input.unit || 'pcs');
    return Object.freeze({
      id: u().text(input.id) || u().id('item'),
      sku: u().text(input.sku || input.code),
      name: u().text(input.name),
      type: u().text(input.type || 'stock'),
      baseUnit,
      unitConversions: Object.freeze(u().list(input.unitConversions)),
      barcode: u().text(input.barcode),
      reorderPoint: u().qty(input.reorderPoint),
      reorderQty: u().qty(input.reorderQty || 1),
      costingMethod: u().text(input.costingMethod || ''),
      trackSerial: !!input.trackSerial,
      trackBatch: !!input.trackBatch,
      trackExpiry: !!input.trackExpiry,
      active: input.active !== false,
      metadata: Object.freeze(u().clone(input.metadata || {}))
    });
  }

  function upsert(state = {}, item, options = {}) {
    const next = u().clone(state);
    const record = createItem(item);
    next.items = u().list(next.items).some(row => row.id === record.id)
      ? next.items.map(row => row.id === record.id ? record : row)
      : [...u().list(next.items), record];
    return u().audit(next, 'item.upsert', { itemId: record.id }, options.user);
  }

  function get(state = {}, itemId) {
    return u().list(state.items).find(item => item.id === itemId) || null;
  }

  ns.ItemEngine = Object.freeze({ version: '1.0.0', createItem, upsert, get });
})(typeof globalThis !== 'undefined' ? globalThis : window);
