const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require(path.join(__dirname, '..', 'chartOfAccounts.js'));
require(path.join(__dirname, '..', 'accountingCore.js'));
require(path.join(__dirname, '..', 'accountingReports.js'));

test('full audit exposes all six reports and remains read-only', () => {
  const snapshot = {
    products: [{ id: 'A', name: 'Item A', buyPrice: 20, accountingStock: 4 }],
    sales: [{ id: 'S', total: 30, items: [{ productId: 'A', qty: 1, price: 30, buyPrice: 20 }] }],
    purchases: [{ id: 'P', total: 100, items: [{ productId: 'A', qty: 5, price: 20 }] }],
    treasury: [{ id: 'T', type: 'in', amount: 30, balance: 30 }],
    cashBoxes: [{ balance: 30 }],
    stockMovements: [],
    expenses: []
  };
  const audit = globalThis.OmniAccountingCore.validateSnapshot(snapshot);
  const result = globalThis.OmniAccountingReports.generate(snapshot);
  assert.equal(audit.readOnly, true);
  assert.equal(result.readOnly, true);
  assert.ok(result.trialBalance);
  assert.ok(result.profitAndLoss);
  assert.ok(result.inventoryValuation);
  assert.ok(result.cashReconciliation);
  assert.ok(result.salesProfitAudit);
  assert.ok(result.purchaseCostAudit);
  assert.equal(result.trialBalance.balanced, true);
});
