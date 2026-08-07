const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const context = vm.createContext({ console, globalThis: {} });
context.window = context.globalThis;

function loadMany(folder, files) {
  files.forEach(file => {
    const code = fs.readFileSync(path.join(projectRoot, folder, file), 'utf8');
    new vm.Script(code, { filename: file }).runInContext(context);
  });
}

loadMany('services/accounting', [
  'AccountingValidator.js',
  'JournalEngine.js',
  'AccountBalanceEngine.js',
  'LedgerEngine.js',
  'TrialBalanceEngine.js',
  'FiscalYearEngine.js',
  'VoucherEngine.js',
  'PostingEngine.js',
  'OpeningBalanceEngine.js',
  'AccountingEngine.js'
]);

loadMany('services/inventory', [
  'InventoryUtils.js',
  'UnitConversionEngine.js',
  'ItemEngine.js',
  'WarehouseEngine.js',
  'StockMovementEngine.js',
  'InventoryTransactionEngine.js',
  'InventoryValidator.js',
  'TransferEngine.js',
  'StockAdjustmentEngine.js',
  'StockCountEngine.js',
  'ReorderEngine.js',
  'ReservationEngine.js',
  'InventoryEngine.js'
]);

loadMany('services/autoPosting', [
  'AutoPostingValidator.js',
  'InventoryAccountingBridge.js',
  'AccountingInventoryReconciler.js',
  'SalesPostingPreviewEngine.js',
  'PurchasePostingPreviewEngine.js',
  'ReturnPostingPreviewEngine.js',
  'PaymentPostingPreviewEngine.js',
  'AutoPostingEngine.js'
]);

const accounting = context.globalThis.OmniEnterpriseAccounting;
const inventory = context.globalThis.OmniInventoryEngine;
const autoPosting = context.globalThis.OmniAutoPosting;

function setupInventory() {
  const engine = inventory.InventoryEngine.createEngine();
  engine.upsertItem({ id: 'p1', sku: 'P1', name: 'Product 1', baseUnit: 'pcs', reorderPoint: 2, reorderQty: 5 });
  engine.upsertWarehouse({ id: 'main', name: 'Main' });
  engine.receive({ itemId: 'p1', warehouseId: 'main', quantity: 10, unitCost: 60, batch: 'B1', date: '2026-06-01' });
  return engine;
}

function saleItems() {
  return [{ itemId: 'p1', name: 'Product 1', warehouseId: 'main', quantity: 2, price: 100 }];
}

function run() {
  assert.ok(accounting.AccountingEngine, 'Phase 8 accounting engine should load');
  assert.ok(inventory.InventoryEngine, 'Phase 9 inventory engine should load');
  assert.ok(autoPosting.AutoPostingEngine, 'Phase 10 auto posting engine should load');

  const accountingEngine = accounting.AccountingEngine.createEngine();
  const inventoryEngine = setupInventory();
  const engine = autoPosting.AutoPostingEngine.createEngine({ accountingEngine, inventoryEngine });

  const cashSale = engine.previewCashSale({ id: 'S1', items: saleItems() });
  assert.strictEqual(cashSale.valid, true, 'cash sale preview should be valid');
  assert.strictEqual(cashSale.cashImpact, 200);
  assert.strictEqual(cashSale.costImpact, 120);
  assert.strictEqual(cashSale.profitImpact, 80);
  assert.strictEqual(cashSale.inventoryImpact[0].direction, 'out');
  assert.strictEqual(cashSale.inventoryImpact[0].onHandAfter, 8);
  assert.strictEqual(cashSale.journalTotals.difference, 0);

  const creditSale = engine.previewCreditSale({ id: 'S2', items: saleItems() });
  assert.strictEqual(creditSale.valid, true, 'credit sale preview should be valid');
  assert.strictEqual(creditSale.cashImpact, 0);
  assert.strictEqual(creditSale.customerSupplierImpact, 200);
  assert.ok(creditSale.debitLines.some(line => line.account === 'accounts_receivable'));

  const purchase = engine.previewPurchase({
    id: 'P1',
    paymentType: 'credit',
    items: [{ itemId: 'p1', name: 'Product 1', warehouseId: 'main', quantity: 3, price: 70, unitCost: 70 }]
  });
  assert.strictEqual(purchase.valid, true, 'purchase preview should be valid');
  assert.strictEqual(purchase.costImpact, 210);
  assert.strictEqual(purchase.inventoryImpact[0].direction, 'in');
  assert.ok(purchase.creditLines.some(line => line.account === 'accounts_payable'));

  const salesReturn = engine.previewSalesReturn({ id: 'SR1', paymentType: 'cash', items: saleItems() });
  assert.strictEqual(salesReturn.valid, true, 'sales return preview should be valid');
  assert.strictEqual(salesReturn.cashImpact, -200);
  assert.strictEqual(salesReturn.inventoryImpact[0].direction, 'in');
  assert.strictEqual(salesReturn.profitImpact, -80);

  const purchaseReturn = engine.previewPurchaseReturn({
    id: 'PR1',
    paymentType: 'credit',
    items: [{ itemId: 'p1', warehouseId: 'main', quantity: 1, price: 70, unitCost: 70 }]
  });
  assert.strictEqual(purchaseReturn.valid, true, 'purchase return preview should be valid');
  assert.strictEqual(purchaseReturn.customerSupplierImpact, -70);
  assert.strictEqual(purchaseReturn.inventoryImpact[0].direction, 'out');

  const customerPayment = engine.previewCustomerPayment({ id: 'CP1', amount: 150 });
  assert.strictEqual(customerPayment.valid, true, 'customer payment should be valid');
  assert.strictEqual(customerPayment.cashImpact, 150);
  assert.strictEqual(customerPayment.customerSupplierImpact, -150);

  const supplierPayment = engine.previewSupplierPayment({ id: 'SP1', amount: 90 });
  assert.strictEqual(supplierPayment.valid, true, 'supplier payment should be valid');
  assert.strictEqual(supplierPayment.cashImpact, -90);
  assert.strictEqual(supplierPayment.customerSupplierImpact, -90);

  const unbalanced = engine.validateJournal([
    { account: 'cash_on_hand', debit: 100, credit: 0 },
    { account: 'sales_revenue', debit: 0, credit: 90 }
  ]);
  assert.strictEqual(unbalanced.valid, false, 'unbalanced journal should be detected');
  assert.strictEqual(unbalanced.errors[0].code, 'UNBALANCED_JOURNAL');

  const missingCost = engine.previewCashSale({
    id: 'S3',
    items: [{ itemId: 'missing', name: 'Missing Cost', warehouseId: 'main', quantity: 1, price: 100 }]
  });
  assert.strictEqual(missingCost.valid, true, 'missing cost is warning-only in preview');
  assert.ok(missingCost.warnings.some(warning => warning.code === 'COST_MISSING'));

  assert.strictEqual(inventoryEngine.onHandQty('p1', 'main'), 10, 'auto posting preview must not update inventory');
  assert.strictEqual(accountingEngine.getState().vouchers.length, 0, 'auto posting preview must not post accounting vouchers');

  return {
    tests: 21,
    cashSaleLines: cashSale.journalLines.length,
    inventoryOnHandAfterPreview: inventoryEngine.onHandQty('p1', 'main'),
    accountingVouchersAfterPreview: accountingEngine.getState().vouchers.length
  };
}

if (require.main === module) {
  console.log(JSON.stringify(run(), null, 2));
}

module.exports = { run };
