(function (root) {
  'use strict';
  const ns = root.OmniInventoryEngine = root.OmniInventoryEngine || {};
  const u = () => ns.InventoryUtils;

  function reserve(state = {}, input = {}, options = {}) {
    const available = ns.InventoryTransactionEngine.availableQty(state, input.itemId, input.warehouseId);
    if (available < u().number(input.quantity) && !state.settings?.allowNegativeStock) {
      return Object.freeze({ state: u().clone(state), accepted: false, error: { code: 'INSUFFICIENT_AVAILABLE_QTY', available } });
    }
    const reservation = Object.freeze({
      id: input.id || u().id('res'),
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      quantity: u().qty(input.quantity),
      reference: input.reference || '',
      status: 'active',
      createdAt: new Date().toISOString()
    });
    const next = u().clone(state);
    next.reservations = [...u().list(next.reservations), reservation];
    return Object.freeze({ state: u().audit(next, 'reservation.create', { reservationId: reservation.id }, options.user), reservation, accepted: true });
  }

  function release(state = {}, reservationId, options = {}) {
    const next = u().clone(state);
    next.reservations = u().list(next.reservations).map(row => row.id === reservationId ? { ...row, status: 'released' } : row);
    return Object.freeze({ state: u().audit(next, 'reservation.release', { reservationId }, options.user), released: true });
  }

  ns.ReservationEngine = Object.freeze({ version: '1.0.0', reserve, release });
})(typeof globalThis !== 'undefined' ? globalThis : window);
