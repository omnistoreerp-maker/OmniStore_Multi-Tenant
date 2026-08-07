(function (root) {
  'use strict';
  const ns = root.OmniInventoryEngine = root.OmniInventoryEngine || {};
  const u = () => ns.InventoryUtils;

  function createMovement(input = {}) {
    return Object.freeze({
      id: u().text(input.id) || u().id('move'),
      date: input.date || u().today(),
      type: u().text(input.type || 'adjustment'),
      itemId: u().text(input.itemId),
      warehouseId: u().text(input.warehouseId),
      direction: u().text(input.direction || 'in'),
      quantity: u().qty(input.quantity),
      unitCost: u().money(input.unitCost),
      totalCost: u().money((input.totalCost != null ? input.totalCost : u().number(input.quantity) * u().number(input.unitCost))),
      batch: u().text(input.batch),
      lot: u().text(input.lot || input.batch),
      serialNumber: u().text(input.serialNumber),
      expiryDate: u().text(input.expiryDate),
      reference: u().text(input.reference),
      notes: u().text(input.notes)
    });
  }

  function add(state = {}, movement, options = {}) {
    const next = u().clone(state);
    const record = createMovement(movement);
    next.movements = [...u().list(next.movements), record];
    return u().audit(next, 'movement.add', { movementId: record.id, itemId: record.itemId }, options.user);
  }

  function listByItem(state = {}, itemId, filters = {}) {
    return Object.freeze(u().list(state.movements)
      .filter(move => !itemId || move.itemId === itemId)
      .filter(move => !filters.warehouseId || move.warehouseId === filters.warehouseId)
      .filter(move => !filters.batch || move.batch === filters.batch)
      .filter(move => !filters.serialNumber || move.serialNumber === filters.serialNumber)
      .sort((a, b) => `${a.date}|${a.id}`.localeCompare(`${b.date}|${b.id}`)));
  }

  ns.StockMovementEngine = Object.freeze({ version: '1.0.0', createMovement, add, listByItem });
})(typeof globalThis !== 'undefined' ? globalThis : window);
