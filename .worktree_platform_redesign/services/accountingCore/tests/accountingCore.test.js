const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require(path.join(__dirname, '..', 'chartOfAccounts.js'));
require(path.join(__dirname, '..', 'accountingCore.js'));
require(path.join(__dirname, '..', 'accountingReports.js'));

const core = globalThis.OmniAccountingCore;
const reports = globalThis.OmniAccountingReports;

function fixture() {
  return {
    products: [
      { id: 1, name: 'Laptop', buyPrice: 1000, accountingStock: 3 },
      { id: 2, name: 'Mouse', buyPrice: 50, accountingStock: 10 }
    ],
    sales: [{
      id: 'S-1',
      date: '2026-06-29',
      invoiceType: 'cash',
      total: 1500,
      items: [{ productId: 1, name: 'Laptop', qty: 1, price: 1500, buyPrice: 1000 }]
    }],
    purchases: [{
      id: 'P-1',
      date: '2026-06-28',
      invoiceType: 'ajel',
      total: 3000,
      items: [{ productId: 1, name: 'Laptop', qty: 3, price: 1000, purchasePrice: 1000 }]
    }],
    treasury: [
      { id: 2, type: 'out', amount: 500, balance: 1000 },
      { id: 1, type: 'in', amount: 1500, balance: 1500 }
    ],
    cashBoxes: [{ id: 'cash', balance: 1000 }],
    stockMovements: [],
    expenses: [{ id: 1, amount: 100 }]
  };
}

test('sale accounting preview produces the four expected lines', () => {
  const data = fixture();
  const preview = core.previewSale(data.sales[0], data);
  assert.equal(preview.lines.length, 4);
  assert.equal(preview.lines[0].accountKey, 'cash');
  assert.equal(preview.lines[1].accountKey, 'sales_revenue');
  assert.equal(preview.lines[2].accountKey, 'cost_of_goods_sold');
  assert.equal(preview.lines[3].accountKey, 'inventory_asset');
  assert.equal(preview.profit, 500);
});

test('purchase accounting preview debits inventory and credits supplier', () => {
  const data = fixture();
  const preview = core.previewPurchase(data.purchases[0], data);
  assert.equal(preview.lines[0].accountKey, 'inventory_asset');
  assert.equal(preview.lines[0].debit, 3000);
  assert.equal(preview.lines[1].accountKey, 'accounts_payable');
  assert.equal(preview.lines[1].credit, 3000);
});

test('balanced journal entries pass validation', () => {
  const data = fixture();
  const sale = core.previewSale(data.sales[0], data);
  const purchase = core.previewPurchase(data.purchases[0], data);
  assert.equal(core.validateJournal(sale).balanced, true);
  assert.equal(core.validateJournal(purchase).balanced, true);
});

test('inventory valuation uses stock multiplied by unit cost', () => {
  const valuation = reports.inventoryValuation(fixture());
  assert.equal(valuation.totalValue, 3500);
  assert.equal(valuation.rows.find(row => row.productId === '1').value, 3000);
});

test('profit calculation subtracts COGS and operating expenses', () => {
  const pnl = reports.profitAndLoss(fixture());
  assert.equal(pnl.salesRevenue, 1500);
  assert.equal(pnl.costOfGoodsSold, 1000);
  assert.equal(pnl.grossProfit, 500);
  assert.equal(pnl.netProfit, 400);
  assert.equal(pnl.reliable, true);
});

test('treasury reconciliation detects a matching running balance', () => {
  const reconciliation = reports.cashReconciliation(fixture());
  assert.equal(reconciliation.calculatedBalance, 1000);
  assert.equal(reconciliation.runningDifferences.length, 0);
  assert.equal(reconciliation.reconciled, true);
});

test('missing purchase cost prevents a reliable profit result', () => {
  const data = fixture();
  delete data.products[0].buyPrice;
  delete data.sales[0].items[0].buyPrice;
  const preview = core.previewSale(data.sales[0], data);
  assert.equal(preview.profit, null);
  assert.ok(preview.warnings.some(issue => issue.code === 'SALE_ITEM_WITHOUT_COST'));
});

test('negative stock and unlinked items are reported', () => {
  const data = fixture();
  data.products[0].accountingStock = -1;
  data.sales[0].items.push({ productId: 99, name: 'Missing', qty: 1, price: 10 });
  const audit = core.validateSnapshot(data);
  assert.ok(audit.warnings.some(issue => issue.code === 'NEGATIVE_STOCK'));
  assert.ok(audit.errors.some(issue => issue.code === 'SALE_ITEM_UNLINKED'));
  assert.ok(audit.errors.some(issue => issue.code === 'SALE_EXCEEDS_AVAILABLE_STOCK'));
});

test('simulation does not mutate the source snapshot', () => {
  const data = fixture();
  const before = JSON.stringify(data);
  core.validateSnapshot(data);
  reports.generate(data);
  assert.equal(JSON.stringify(data), before);
});
