(function (root) {
  'use strict';

  const ns = root.OmniAutoPosting = root.OmniAutoPosting || {};
  const list = value => Array.isArray(value) ? value : [];
  const text = value => String(value == null ? '' : value).trim();
  const number = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const money = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function totals(lines) {
    return list(lines).reduce((sum, line) => ({
      debit: money(sum.debit + number(line.debit)),
      credit: money(sum.credit + number(line.credit))
    }), { debit: 0, credit: 0 });
  }

  function validateJournal(lines, options = {}) {
    const errors = [];
    const warnings = [];
    const total = totals(lines);
    const difference = money(total.debit - total.credit);
    if (!list(lines).length) errors.push({ code: 'JOURNAL_LINES_REQUIRED', message: 'Journal preview must include at least one line.' });
    if (Math.abs(difference) > 0.01) errors.push({ code: 'UNBALANCED_JOURNAL', difference, message: 'Debit preview must equal Credit preview.' });
    list(lines).forEach((line, index) => {
      if (!line.account) errors.push({ code: 'ACCOUNT_REQUIRED', line: index + 1, message: 'Journal line account is required.' });
      if (number(line.debit) < 0 || number(line.credit) < 0) errors.push({ code: 'NEGATIVE_AMOUNT', line: index + 1, message: 'Debit/Credit cannot be negative.' });
      if (number(line.debit) > 0 && number(line.credit) > 0) errors.push({ code: 'DOUBLE_SIDED_LINE', line: index + 1, message: 'Line cannot have both debit and credit.' });
      if (number(line.debit) === 0 && number(line.credit) === 0) warnings.push({ code: 'ZERO_LINE', line: index + 1, message: 'Zero amount line.' });
    });
    if (options.requireCost && !(number(options.cost) > 0)) warnings.push({ code: 'COST_MISSING', message: 'Cost is missing; profit preview may be incomplete.' });
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), warnings: Object.freeze(warnings), totals: Object.freeze({ ...total, difference }) });
  }

  function validateOperation(operation, payload = {}) {
    const errors = [];
    const warnings = [];
    if (!operation) errors.push({ code: 'OPERATION_REQUIRED', message: 'Operation is required.' });
    if (['sale', 'purchase', 'sales_return', 'purchase_return'].includes(operation) && !list(payload.items).length) {
      errors.push({ code: 'ITEMS_REQUIRED', message: 'Invoice operation requires items.' });
    }
    if (['customer_payment', 'supplier_payment'].includes(operation) && !(number(payload.amount) > 0)) {
      errors.push({ code: 'PAYMENT_AMOUNT_REQUIRED', message: 'Payment amount must be greater than zero.' });
    }
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), warnings: Object.freeze(warnings) });
  }

  ns.AutoPostingValidator = Object.freeze({ version: '1.0.0', list, text, number, money, clone, totals, validateJournal, validateOperation });
})(typeof globalThis !== 'undefined' ? globalThis : window);
