(function (root) {
  'use strict';

  const ns = root.OmniInventoryEngine = root.OmniInventoryEngine || {};
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const list = value => Array.isArray(value) ? value : [];
  const text = value => String(value == null ? '' : value).trim();
  const number = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const qty = value => Math.round((number(value) + Number.EPSILON) * 1000000) / 1000000;
  const money = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;
  const id = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const today = () => new Date().toISOString().slice(0, 10);

  function audit(state = {}, action, payload = {}, user = 'system') {
    const next = clone(state || {});
    next.auditLog = list(next.auditLog);
    next.auditLog.push(Object.freeze({
      id: id('audit'),
      at: new Date().toISOString(),
      action,
      user,
      payload: clone(payload)
    }));
    return next;
  }

  function createState(input = {}) {
    return Object.freeze({
      items: clone(input.items || []),
      warehouses: clone(input.warehouses || []),
      movements: clone(input.movements || []),
      transactions: clone(input.transactions || []),
      reservations: clone(input.reservations || []),
      stockCounts: clone(input.stockCounts || []),
      auditLog: clone(input.auditLog || []),
      settings: Object.freeze({
        costingMethod: 'FIFO',
        allowNegativeStock: false,
        baseUnit: 'pcs',
        ...clone(input.settings || {})
      })
    });
  }

  ns.InventoryUtils = Object.freeze({ clone, list, text, number, qty, money, id, today, audit, createState });
})(typeof globalThis !== 'undefined' ? globalThis : window);
