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

loadMany('services/integration', [
  'IntegrationValidator.js',
  'AccountingIntegrationAdapter.js',
  'InventoryIntegrationAdapter.js',
  'SalesIntegrationAdapter.js',
  'PurchaseIntegrationAdapter.js',
  'ManufacturingIntegrationAdapter.js',
  'POSIntegrationAdapter.js',
  'PreviewAggregator.js',
  'PreviewDispatcher.js',
  'ERPIntegrationEngine.js'
]);

const accounting = context.globalThis.OmniEnterpriseAccounting;
const inventory = context.globalThis.OmniInventoryEngine;
const autoPosting = context.globalThis.OmniAutoPosting;
const integration = context.globalThis.OmniERPIntegration;

function setup() {
  const accountingEngine = accounting.AccountingEngine.createEngine();
  const inventoryEngine = inventory.InventoryEngine.createEngine();
  inventoryEngine.upsertItem({ id: 'p1', name: 'Product 1', baseUnit: 'pcs', reorderPoint: 2, reorderQty: 5 });
  inventoryEngine.upsertItem({ id: 'fg1', name: 'Finished Good', baseUnit: 'pcs' });
  inventoryEngine.upsertWarehouse({ id: 'main', name: 'Main' });
  inventoryEngine.upsertWarehouse({ id: 'branch', name: 'Branch' });
  inventoryEngine.receive({ itemId: 'p1', warehouseId: 'main', quantity: 10, unitCost: 50 });
  const autoPostingEngine = autoPosting.AutoPostingEngine.createEngine({ accountingEngine, inventoryEngine });
  const engine = integration.ERPIntegrationEngine.createEngine({ accountingEngine, inventoryEngine, autoPostingEngine });
  return { accountingEngine, inventoryEngine, engine };
}

function item(quantity = 2, price = 100) {
  return { itemId: 'p1', warehouseId: 'main', quantity, price };
}

function run() {
  const { accountingEngine, inventoryEngine, engine } = setup();
  assert.strictEqual(engine.contextStatus().readOnly, true);

  const sale = engine.preview({ docType: 'sales_invoice', id: 'S1', customerId: 'C1', paymentType: 'credit', items: [item()] });
  assert.strictEqual(sale.operation, 'sales_invoice');
  assert.strictEqual(sale.inventoryEffect[0].direction, 'out');
  assert.strictEqual(sale.cashEffect, 0);
  assert.strictEqual(sale.customerSupplierEffect, 200);
  assert.strictEqual(sale.profitEffect, 100);
  assert.strictEqual(sale.readOnly, true);

  const purchase = engine.preview({ docType: 'purchase_invoice', id: 'P1', supplierId: 'SUP1', paymentType: 'cash', items: [{ itemId: 'p1', warehouseId: 'main', quantity: 3, price: 40, unitCost: 40 }] });
  assert.strictEqual(purchase.operation, 'purchase_invoice');
  assert.strictEqual(purchase.inventoryEffect[0].direction, 'in');
  assert.strictEqual(purchase.cashEffect, -120);

  const salesReturn = engine.preview({ docType: 'sales_return', id: 'SR1', paymentType: 'cash', items: [item()] });
  assert.strictEqual(salesReturn.operation, 'sales_return');
  assert.strictEqual(salesReturn.inventoryEffect[0].direction, 'in');
  assert.strictEqual(salesReturn.cashEffect, -200);

  const purchaseReturn = engine.preview({ docType: 'purchase_return', id: 'PR1', paymentType: 'credit', items: [{ itemId: 'p1', warehouseId: 'main', quantity: 1, price: 40, unitCost: 40 }] });
  assert.strictEqual(purchaseReturn.operation, 'purchase_return');
  assert.strictEqual(purchaseReturn.inventoryEffect[0].direction, 'out');
  assert.strictEqual(purchaseReturn.customerSupplierEffect, -40);

  const pos = engine.preview({ docType: 'pos_sale', id: 'POS1', pos: true, items: [item(1, 120)] });
  assert.strictEqual(pos.operation, 'pos_sale');
  assert.strictEqual(pos.cashEffect, 120);
  assert.strictEqual(pos.profitEffect, 70);

  const consumption = engine.preview({ docType: 'manufacturing_consumption', productionOrderId: 'MO1', components: [{ itemId: 'p1', warehouseId: 'main', quantity: 2, unitCost: 50 }] });
  assert.strictEqual(consumption.operation, 'manufacturing_consumption');
  assert.strictEqual(consumption.inventoryEffect[0].direction, 'out');
  assert.strictEqual(consumption.costEffect, 100);

  const production = engine.preview({ docType: 'manufacturing_production', productionOrderId: 'MO1', outputs: [{ itemId: 'fg1', warehouseId: 'main', quantity: 1, unitCost: 100 }] });
  assert.strictEqual(production.operation, 'manufacturing_production');
  assert.strictEqual(production.inventoryEffect[0].direction, 'in');
  assert.strictEqual(production.costEffect, 100);

  const transfer = engine.preview({ docType: 'inventory_transfer', id: 'T1', itemId: 'p1', fromWarehouseId: 'main', toWarehouseId: 'branch', quantity: 2, unitCost: 50 });
  assert.strictEqual(transfer.operation, 'inventory_transfer');
  assert.strictEqual(transfer.inventoryEffect.length, 2);
  assert.strictEqual(transfer.inventoryEffect[0].direction, 'out');
  assert.strictEqual(transfer.inventoryEffect[1].direction, 'in');

  const adjustment = engine.preview({ docType: 'inventory_adjustment', id: 'A1', itemId: 'p1', warehouseId: 'main', currentQty: 10, targetQty: 12, quantity: 2, unitCost: 50 });
  assert.strictEqual(adjustment.operation, 'inventory_adjustment');
  assert.strictEqual(adjustment.inventoryEffect[0].direction, 'in');

  const customerPayment = engine.preview({ docType: 'customer_payment', id: 'CP1', customerId: 'C1', amount: 80 });
  assert.strictEqual(customerPayment.operation, 'customer_payment');
  assert.strictEqual(customerPayment.cashEffect, 80);
  assert.strictEqual(customerPayment.customerSupplierEffect, -80);

  const supplierPayment = engine.preview({ docType: 'supplier_payment', id: 'SP1', supplierId: 'SUP1', amount: 60 });
  assert.strictEqual(supplierPayment.operation, 'supplier_payment');
  assert.strictEqual(supplierPayment.cashEffect, -60);
  assert.strictEqual(supplierPayment.customerSupplierEffect, -60);

  const invalid = engine.preview({ docType: 'sales_invoice', id: 'BAD1', items: [] });
  assert.ok(invalid.validationErrors.some(error => error.code === 'ITEMS_REQUIRED'));

  assert.strictEqual(inventoryEngine.onHandQty('p1', 'main'), 10, 'integration preview must not update inventory');
  assert.strictEqual(accountingEngine.getState().vouchers.length, 0, 'integration preview must not save accounting vouchers');
  assert.strictEqual(engine.detectType({ pos: true }), 'pos_sale');

  const batch = engine.previewMany([
    { docType: 'customer_payment', amount: 1, customerId: 'C1' },
    { docType: 'supplier_payment', amount: 1, supplierId: 'S1' }
  ]);
  assert.strictEqual(batch.length, 2);

  return {
    tests: 28,
    previews: 12,
    inventoryOnHandAfterPreview: inventoryEngine.onHandQty('p1', 'main'),
    accountingVouchersAfterPreview: accountingEngine.getState().vouchers.length
  };
}

if (require.main === module) {
  console.log(JSON.stringify(run(), null, 2));
}

module.exports = { run };
