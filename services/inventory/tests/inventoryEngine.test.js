const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const files = [
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
];

const context = vm.createContext({ console, globalThis: {} });
context.window = context.globalThis;
files.forEach(file => {
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  new vm.Script(code, { filename: file }).runInContext(context);
});

const omni = context.globalThis.OmniInventoryEngine;

function run() {
  assert.ok(omni.InventoryEngine, 'InventoryEngine should be registered');

  const engine = omni.InventoryEngine.createEngine({ settings: { costingMethod: 'FIFO', allowNegativeStock: false } });
  engine.upsertItem({
    id: 'cpu-1',
    sku: 'CPU-I5',
    name: 'Intel CPU',
    baseUnit: 'pcs',
    reorderPoint: 5,
    reorderQty: 10,
    trackSerial: true,
    trackBatch: true,
    trackExpiry: true,
    unitConversions: [{ unit: 'box', factor: 10 }]
  });
  engine.upsertWarehouse({ id: 'main', name: 'Main Warehouse' });
  engine.upsertWarehouse({ id: 'branch', name: 'Branch Warehouse' });

  assert.strictEqual(omni.UnitConversionEngine.toBase(omni.ItemEngine.get(engine.getState(), 'cpu-1'), 2, 'box'), 20);

  const receipt1 = engine.receive({
    itemId: 'cpu-1',
    warehouseId: 'main',
    quantity: 10,
    unitCost: 100,
    batch: 'B1',
    serialNumber: 'S1',
    expiryDate: '2027-01-01',
    date: '2026-06-01'
  });
  assert.strictEqual(receipt1.accepted, true, 'receipt should be accepted');

  const receipt2 = engine.receive({
    itemId: 'cpu-1',
    warehouseId: 'main',
    quantity: 5,
    unitCost: 120,
    batch: 'B2',
    serialNumber: 'S2',
    expiryDate: '2027-02-01',
    date: '2026-06-02'
  });
  assert.strictEqual(receipt2.accepted, true, 'second receipt should be accepted');
  assert.strictEqual(engine.onHandQty('cpu-1', 'main'), 15);

  const reserve = engine.reserve({ itemId: 'cpu-1', warehouseId: 'main', quantity: 4, reference: 'SO-1' });
  assert.strictEqual(reserve.accepted, true, 'reservation should be accepted');
  assert.strictEqual(engine.committedQty('cpu-1', 'main'), 4);
  assert.strictEqual(engine.availableQty('cpu-1', 'main'), 11);

  const issue = engine.issue({
    itemId: 'cpu-1',
    warehouseId: 'main',
    quantity: 3,
    unitCost: 100,
    batch: 'B1',
    serialNumber: 'S1',
    expiryDate: '2027-01-01'
  });
  assert.strictEqual(issue.accepted, true, 'issue should be accepted');
  assert.strictEqual(engine.onHandQty('cpu-1', 'main'), 12);

  const fifo = engine.fifoLayers('cpu-1', 'main');
  assert.strictEqual(fifo[0].remaining, 7, 'FIFO should consume first layer');
  assert.strictEqual(engine.averageCost('cpu-1', 'main').averageCost, 106.67);

  const transfer = engine.transfer({
    itemId: 'cpu-1',
    fromWarehouseId: 'main',
    toWarehouseId: 'branch',
    quantity: 2,
    unitCost: 100,
    batch: 'B1',
    serialNumber: 'S1',
    expiryDate: '2027-01-01'
  });
  assert.strictEqual(transfer.accepted, true, 'transfer should be accepted');
  assert.strictEqual(engine.onHandQty('cpu-1', 'branch'), 2);

  const adjustment = engine.adjust({ itemId: 'cpu-1', warehouseId: 'branch', targetQty: 6, unitCost: 115, batch: 'B3', serialNumber: 'S3', expiryDate: '2027-03-01' });
  assert.strictEqual(adjustment.accepted, true, 'adjustment should be accepted');
  assert.strictEqual(engine.onHandQty('cpu-1', 'branch'), 6);

  const count = engine.createCount({ warehouseId: 'branch', lines: [{ itemId: 'cpu-1', countedQty: 4, unitCost: 115, batch: 'B3', serialNumber: 'S3', expiryDate: '2027-03-01' }] });
  assert.strictEqual(count.count.lines[0].difference, -2);
  const applied = engine.applyCount(count.count.id);
  assert.strictEqual(applied.applied, true, 'stock count should apply');
  assert.strictEqual(engine.onHandQty('cpu-1', 'branch'), 4);

  const reorder = engine.reorderSuggestions({ warehouseId: 'branch' });
  assert.strictEqual(reorder.length, 1, 'reorder suggestion should be generated');

  const blocked = engine.issue({
    itemId: 'cpu-1',
    warehouseId: 'branch',
    quantity: 999,
    unitCost: 1,
    batch: 'B1',
    serialNumber: 'S1',
    expiryDate: '2027-01-01'
  });
  assert.strictEqual(blocked.accepted, false, 'negative stock should be blocked');
  assert.strictEqual(blocked.validation.errors[0].code, 'INSUFFICIENT_STOCK');

  const serialBlocked = engine.receive({ itemId: 'cpu-1', warehouseId: 'main', quantity: 1, unitCost: 1, batch: 'B3' });
  assert.strictEqual(serialBlocked.accepted, false, 'serial tracked item should require serial');

  const before = engine.getState();
  engine.releaseReservation(reserve.reservation.id);
  assert.strictEqual(before.reservations[0].status, 'active', 'snapshots should remain immutable for callers');
  assert.strictEqual(engine.committedQty('cpu-1', 'main'), 0);
  assert.ok(engine.getState().auditLog.length >= 10, 'audit log should capture operations');

  return {
    tests: 18,
    movements: engine.getState().movements.length,
    reservations: engine.getState().reservations.length,
    auditEvents: engine.getState().auditLog.length
  };
}

if (require.main === module) {
  console.log(JSON.stringify(run(), null, 2));
}

module.exports = { run };
