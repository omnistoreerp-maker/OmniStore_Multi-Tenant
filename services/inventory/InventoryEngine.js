(function (root) {
  'use strict';
  const ns = root.OmniInventoryEngine = root.OmniInventoryEngine || {};
  const u = () => ns.InventoryUtils;

  function createEngine(initialState = {}) {
    let state = u().createState(initialState);
    const set = next => { state = u().createState(next); return state; };
    return Object.freeze({
      getState: () => u().clone(state),
      setState: next => set(next),
      upsertItem: (item, options) => set(ns.ItemEngine.upsert(state, item, options)),
      upsertWarehouse: (warehouse, options) => set(ns.WarehouseEngine.upsert(state, warehouse, options)),
      receive: (input, options) => { const result = ns.InventoryTransactionEngine.receive(state, input, options); state = u().createState(result.state); return result; },
      issue: (input, options) => { const result = ns.InventoryTransactionEngine.issue(state, input, options); state = u().createState(result.state); return result; },
      transfer: (input, options) => { const result = ns.TransferEngine.transfer(state, input, options); state = u().createState(result.state); return result; },
      adjust: (input, options) => { const result = ns.StockAdjustmentEngine.adjust(state, input, options); state = u().createState(result.state); return result; },
      createCount: (input, options) => { const result = ns.StockCountEngine.createCount(state, input, options); state = u().createState(result.state); return result; },
      applyCount: (countId, options) => { const result = ns.StockCountEngine.applyCount(state, countId, options); state = u().createState(result.state); return result; },
      reserve: (input, options) => { const result = ns.ReservationEngine.reserve(state, input, options); state = u().createState(result.state); return result; },
      releaseReservation: (id, options) => { const result = ns.ReservationEngine.release(state, id, options); state = u().createState(result.state); return result; },
      onHandQty: (itemId, warehouseId, filters) => ns.InventoryTransactionEngine.onHandQty(state, itemId, warehouseId, filters),
      committedQty: (itemId, warehouseId) => ns.InventoryTransactionEngine.committedQty(state, itemId, warehouseId),
      availableQty: (itemId, warehouseId, filters) => ns.InventoryTransactionEngine.availableQty(state, itemId, warehouseId, filters),
      fifoLayers: (itemId, warehouseId, filters) => ns.InventoryTransactionEngine.fifoLayers(state, itemId, warehouseId, filters),
      averageCost: (itemId, warehouseId) => ns.InventoryTransactionEngine.averageCost(state, itemId, warehouseId),
      reorderSuggestions: filters => ns.ReorderEngine.suggestions(state, filters || {}),
      validateMovement: movement => ns.InventoryValidator.validateMovement(movement, state)
    });
  }

  ns.InventoryEngine = Object.freeze({ version: '1.0.0', createState: u().createState, createEngine });
})(typeof globalThis !== 'undefined' ? globalThis : window);
