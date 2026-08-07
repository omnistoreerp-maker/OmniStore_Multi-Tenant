(function (root) {
  'use strict';
  const ns = root.OmniInventoryEngine = root.OmniInventoryEngine || {};
  const u = () => ns.InventoryUtils;

  function movements(state, itemId, warehouseId, filters = {}) {
    return ns.StockMovementEngine.listByItem(state, itemId, { warehouseId, ...filters });
  }

  function onHandQty(state = {}, itemId, warehouseId, filters = {}) {
    return u().qty(movements(state, itemId, warehouseId, filters).reduce((sum, move) => {
      const sign = move.direction === 'out' ? -1 : 1;
      return sum + sign * u().number(move.quantity);
    }, 0));
  }

  function committedQty(state = {}, itemId, warehouseId) {
    return u().qty(u().list(state.reservations)
      .filter(row => row.status !== 'released')
      .filter(row => row.itemId === itemId)
      .filter(row => !warehouseId || row.warehouseId === warehouseId)
      .reduce((sum, row) => sum + u().number(row.quantity), 0));
  }

  function availableQty(state = {}, itemId, warehouseId, filters = {}) {
    return u().qty(onHandQty(state, itemId, warehouseId, filters) - committedQty(state, itemId, warehouseId));
  }

  function fifoLayers(state = {}, itemId, warehouseId, filters = {}) {
    const layers = [];
    movements(state, itemId, warehouseId, filters).forEach(move => {
      if (move.direction === 'in') {
        layers.push({ movementId: move.id, date: move.date, quantity: move.quantity, remaining: move.quantity, unitCost: move.unitCost, batch: move.batch, expiryDate: move.expiryDate });
      } else {
        let remainingOut = move.quantity;
        layers.forEach(layer => {
          if (remainingOut <= 0 || layer.remaining <= 0) return;
          const consumed = Math.min(layer.remaining, remainingOut);
          layer.remaining = u().qty(layer.remaining - consumed);
          remainingOut = u().qty(remainingOut - consumed);
        });
      }
    });
    return Object.freeze(layers.filter(layer => layer.remaining > 0));
  }

  function averageCost(state = {}, itemId, warehouseId) {
    let qty = 0;
    let value = 0;
    movements(state, itemId, warehouseId).forEach(move => {
      if (move.direction === 'in') {
        qty = u().qty(qty + move.quantity);
        value = u().money(value + move.totalCost);
      } else {
        const avg = qty ? value / qty : 0;
        qty = u().qty(qty - move.quantity);
        value = u().money(value - (avg * move.quantity));
      }
    });
    return Object.freeze({ quantity: qty, value: u().money(value), averageCost: qty ? u().money(value / qty) : 0 });
  }

  function receive(state = {}, input = {}, options = {}) {
    const move = ns.StockMovementEngine.createMovement({ ...input, direction: 'in', type: input.type || 'receipt' });
    const validation = ns.InventoryValidator.validateMovement(move, state, { ...options, checkStock: false });
    if (!validation.valid) return Object.freeze({ state: u().clone(state), movement: move, validation, accepted: false });
    return Object.freeze({ state: ns.StockMovementEngine.add(state, move, options), movement: move, validation, accepted: true });
  }

  function issue(state = {}, input = {}, options = {}) {
    const move = ns.StockMovementEngine.createMovement({ ...input, direction: 'out', type: input.type || 'issue' });
    const validation = ns.InventoryValidator.validateMovement(move, state, options);
    if (!validation.valid) return Object.freeze({ state: u().clone(state), movement: move, validation, accepted: false });
    return Object.freeze({ state: ns.StockMovementEngine.add(state, move, options), movement: move, validation, accepted: true });
  }

  ns.InventoryTransactionEngine = Object.freeze({ version: '1.0.0', receive, issue, onHandQty, committedQty, availableQty, fifoLayers, averageCost });
})(typeof globalThis !== 'undefined' ? globalThis : window);
