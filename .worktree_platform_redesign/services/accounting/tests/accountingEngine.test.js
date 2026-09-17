const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const files = [
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
];

const context = vm.createContext({ console, globalThis: {} });
context.window = context.globalThis;
files.forEach(file => {
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  new vm.Script(code, { filename: file }).runInContext(context);
});

const omni = context.globalThis.OmniEnterpriseAccounting;

function balancedSaleVoucher(engine) {
  return engine.createVoucher({
    voucherType: 'SALE',
    voucherNumber: 'SALE-TEST-0001',
    postingDate: '2026-06-29',
    reference: 'INV-1',
    description: 'Sale with COGS',
    businessProfile: 'computer_shop',
    lines: [
      { account: 'cash_on_hand', debit: 1200, credit: 0 },
      { account: 'sales_revenue', debit: 0, credit: 1200 },
      { account: 'cost_of_sales', debit: 700, credit: 0 },
      { account: 'inventory_asset', debit: 0, credit: 700 }
    ]
  });
}

function run() {
  assert.ok(omni.AccountingEngine, 'AccountingEngine should be registered');

  const engine = omni.AccountingEngine.createEngine();
  const voucher = balancedSaleVoucher(engine);
  assert.strictEqual(voucher.voucherNumber, 'SALE-TEST-0001');
  assert.strictEqual(voucher.lines[0].currency, 'EGP');

  const validation = engine.validate(voucher, { role: 'Accountant', action: 'post' });
  assert.strictEqual(validation.valid, true, 'balanced journal should validate');

  const preview = engine.preview(voucher, { role: 'Auditor' });
  assert.strictEqual(preview.validation.valid, true, 'auditor preview should validate');
  assert.ok(preview.affectedAccounts.length >= 4, 'preview should show affected accounts');

  const beforeState = engine.getState();
  const posted = engine.post(voucher, { role: 'Accountant', user: 'unit-test' });
  assert.strictEqual(posted.posted, true, 'voucher should post in memory');
  assert.strictEqual(beforeState.vouchers.length, 0, 'posting should not mutate previous snapshot');
  assert.strictEqual(engine.getState().vouchers.length, 1, 'engine state should contain posted voucher');

  const cashLedger = engine.ledger('cash_on_hand');
  assert.strictEqual(cashLedger.debitTotal, 1200);
  assert.strictEqual(cashLedger.closingBalance, 1200);

  const trial = engine.trialBalance();
  assert.strictEqual(trial.totals.difference, 0, 'trial balance should balance after posting');

  const reverse = engine.reverse('SALE-TEST-0001', { role: 'Accountant', user: 'unit-test' });
  assert.strictEqual(reverse.reversed, true, 'reverse should create reversal voucher');
  assert.strictEqual(engine.trialBalance().totals.difference, 0, 'trial remains balanced after reverse');

  const opening = engine.createOpeningVoucher('opening_cash', [{ amount: 500, notes: 'Cash drawer' }], { postingDate: '2026-01-01' });
  assert.strictEqual(opening.totals.difference, 0, 'opening balance voucher should be auto-balanced');

  const bad = engine.createVoucher({
    voucherType: 'JV',
    voucherNumber: 'BAD-1',
    postingDate: '2026-06-29',
    lines: [{ account: 'cash_on_hand', debit: 10, credit: 0 }]
  });
  assert.strictEqual(engine.validate(bad, { role: 'Accountant', action: 'post' }).valid, false, 'unbalanced voucher should fail');

  const missing = engine.createVoucher({
    voucherType: 'JV',
    voucherNumber: 'BAD-2',
    postingDate: '2026-06-29',
    lines: [
      { account: 'missing_account', debit: 10, credit: 0 },
      { account: 'cash_on_hand', debit: 0, credit: 10 }
    ]
  });
  assert.strictEqual(engine.validate(missing, { role: 'Accountant', action: 'post' }).valid, false, 'missing account should fail');

  const closedEngine = omni.AccountingEngine.createEngine();
  const closedState = closedEngine.fiscal.closeYear(closedEngine.getState(), 'FY-2026');
  closedEngine.setState(closedState);
  assert.strictEqual(closedEngine.validate(balancedSaleVoucher(closedEngine), { role: 'Accountant', action: 'post' }).valid, false, 'closed fiscal year should block posting');
  closedEngine.setState(closedEngine.fiscal.reopenYear(closedEngine.getState(), 'FY-2026'));
  assert.strictEqual(closedEngine.validate(balancedSaleVoucher(closedEngine), { role: 'Accountant', action: 'post' }).valid, true, 'reopened fiscal year should allow posting');

  const inactiveEngine = omni.AccountingEngine.createEngine({
    chartOfAccounts: omni.AccountingEngine.CHART_OF_ACCOUNTS.map(account => account.id === 'cash_on_hand' ? { ...account, active: false } : account)
  });
  assert.strictEqual(inactiveEngine.validate(balancedSaleVoucher(inactiveEngine), { role: 'Accountant', action: 'post' }).valid, false, 'inactive account should fail');

  const readonly = engine.createVoucher({
    voucherType: 'JV',
    voucherNumber: 'READONLY-1',
    postingDate: '2026-06-29',
    lines: [
      { account: 'retained_earnings', debit: 10, credit: 0 },
      { account: 'cash_on_hand', debit: 0, credit: 10 }
    ]
  });
  assert.strictEqual(engine.validate(readonly, { role: 'Accountant', action: 'post' }).valid, false, 'read-only account should fail');

  const cashierPost = engine.validate(voucher, { role: 'Cashier', action: 'post' });
  assert.strictEqual(cashierPost.valid, false, 'cashier must not post');

  return {
    tests: 14,
    vouchers: engine.getState().vouchers.length,
    auditEvents: engine.getState().auditLog.length,
    accounts: omni.AccountingEngine.CHART_OF_ACCOUNTS.length
  };
}

if (require.main === module) {
  console.log(JSON.stringify(run(), null, 2));
}

module.exports = { run };
