(function (root) {
  'use strict';
  const ns = root.OmniInventoryEngine = root.OmniInventoryEngine || {};
  const u = () => ns.InventoryUtils;

  function normalizeUnit(item = {}, unit) {
    const target = u().text(unit || item.baseUnit || 'pcs');
    const base = u().text(item.baseUnit || 'pcs');
    if (target === base) return { unit: base, factor: 1 };
    const found = u().list(item.unitConversions).find(row => u().text(row.unit) === target);
    if (!found) throw new Error(`Unknown unit conversion: ${target}`);
    return { unit: target, factor: u().number(found.factor, 1) };
  }

  function toBase(item, quantity, unit) {
    const conversion = normalizeUnit(item, unit);
    return u().qty(u().number(quantity) * conversion.factor);
  }

  function fromBase(item, quantity, unit) {
    const conversion = normalizeUnit(item, unit);
    return u().qty(u().number(quantity) / conversion.factor);
  }

  ns.UnitConversionEngine = Object.freeze({ version: '1.0.0', normalizeUnit, toBase, fromBase });
})(typeof globalThis !== 'undefined' ? globalThis : window);
