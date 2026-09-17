(function (root) {
  'use strict';
  const ns = root.OmniInventoryEngine = root.OmniInventoryEngine || {};
  const u = () => ns.InventoryUtils;

  function transfer(state = {}, input = {}, options = {}) {
    const reference = input.reference || u().id('transfer');
    const out = ns.InventoryTransactionEngine.issue(state, { ...input, warehouseId: input.fromWarehouseId, reference, type: 'transfer_out' }, options);
    if (!out.accepted) return Object.freeze({ state: out.state, accepted: false, validation: out.validation, reference });
    const inn = ns.InventoryTransactionEngine.receive(out.state, { ...input, warehouseId: input.toWarehouseId, reference, type: 'transfer_in' }, options);
    const next = u().audit(inn.state, 'transfer.complete', { reference, itemId: input.itemId, fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId }, options.user);
    return Object.freeze({ state: next, accepted: inn.accepted, validation: inn.validation, reference });
  }

  ns.TransferEngine = Object.freeze({ version: '1.0.0', transfer });
})(typeof globalThis !== 'undefined' ? globalThis : window);
