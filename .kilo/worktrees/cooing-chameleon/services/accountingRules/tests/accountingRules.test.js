const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRuntime, settings, context } = require('./testRuntime');

test('Rule Registry boots 12 profiles and 180 rules', () => {
  const runtime = createRuntime();
  assert.deepEqual({ ...runtime.OmniAccountingRuleRegistry.stats() }, { profiles: 12, rules: 180 });
});

test('every business profile contains all required rule fields', () => {
  const runtime = createRuntime();
  runtime.OmniAccountingRuleRegistry.listProfiles().forEach(profile => {
    assert.equal(profile.rules.length, 15);
    profile.rules.forEach(rule => assert.equal(runtime.OmniAccountingRuleValidator.validateRule(rule).valid, true));
  });
});

test('Rule Loader materializes a template-only JSON profile', () => {
  const runtime = createRuntime();
  const json = fs.readFileSync(path.join(__dirname, '..', 'sdk', 'example_custom_profile.json'), 'utf8');
  const profile = runtime.OmniAccountingRuleLoader.load(json);
  assert.equal(profile.id, 'pet_store');
  assert.equal(profile.rules.length, 15);
  assert.equal(runtime.OmniAccountingRuleRegistry.getRule('pet_store', 'sale').templateId, 'sale');
});

test('Rule Loader accepts a fully custom JSON rule', () => {
  const runtime = createRuntime();
  const json = fs.readFileSync(path.join(__dirname, '..', 'sdk', 'example_custom_rule_profile.json'), 'utf8');
  runtime.OmniAccountingRuleLoader.load(json);
  const preview = runtime.OmniAccountingRulePreview.preview('service_center', 'service_income', context({ cost: 0, quantity: 0 }), settings(runtime));
  assert.equal(preview.valid, true);
  assert.equal(preview.balanced, true);
});

test('Sales Rule creates revenue, COGS and inventory lines', () => {
  const runtime = createRuntime();
  const preview = runtime.OmniAccountingRulePreview.preview('computer_shop', 'sale', context(), settings(runtime));
  assert.equal(preview.valid, true);
  assert.equal(preview.lines.length, 6);
  assert.equal(preview.effects.profit.amountDelta, 800);
  assert.equal(preview.effects.inventory.quantityDelta, -2);
});

test('Purchase Rule creates balanced inventory and cash preview', () => {
  const runtime = createRuntime();
  const preview = runtime.OmniAccountingRulePreview.preview('pharmacy', 'purchase', context(), settings(runtime));
  assert.equal(preview.balanced, true);
  assert.equal(preview.effects.inventory.quantityDelta, 2);
  assert.equal(preview.effects.cash.amountDelta, -1000);
});

test('Return Rules reverse inventory, cash and profit effects', () => {
  const runtime = createRuntime();
  const saleReturn = runtime.OmniAccountingRulePreview.preview('general_store', 'sales_return', context(), settings(runtime));
  const purchaseReturn = runtime.OmniAccountingRulePreview.preview('general_store', 'purchase_return', context(), settings(runtime));
  assert.equal(saleReturn.effects.inventory.quantityDelta, 2);
  assert.equal(saleReturn.effects.profit.amountDelta, -800);
  assert.equal(purchaseReturn.effects.inventory.quantityDelta, -2);
});

test('Inventory Rule handles in and out directions', () => {
  const runtime = createRuntime();
  const incoming = runtime.OmniAccountingRulePreview.preview('hardware', 'inventory_adjustment', context({ inventoryDirection: 'in' }), settings(runtime));
  const outgoing = runtime.OmniAccountingRulePreview.preview('hardware', 'inventory_adjustment', context({ inventoryDirection: 'out' }), settings(runtime));
  assert.equal(incoming.effects.inventory.quantityDelta, 2);
  assert.equal(outgoing.effects.inventory.quantityDelta, -2);
  assert.equal(incoming.balanced && outgoing.balanced, true);
});

test('Treasury Rules preview deposits and withdrawals without persistence', () => {
  const runtime = createRuntime();
  const deposit = runtime.OmniAccountingRulePreview.preview('electronics', 'treasury_deposit', context(), settings(runtime));
  const withdraw = runtime.OmniAccountingRulePreview.preview('electronics', 'treasury_withdraw', context(), settings(runtime));
  assert.equal(deposit.effects.cash.amountDelta, 1000);
  assert.equal(withdraw.effects.cash.amountDelta, -1000);
  assert.equal(deposit.persisted || withdraw.persisted, false);
});

test('Tax Rules accept correct tax and reject a mismatched calculation', () => {
  const runtime = createRuntime();
  const valid = runtime.OmniAccountingRulePreview.preview('restaurant', 'sale', context({ tax: 140, taxRate: 14 }), settings(runtime));
  const invalid = runtime.OmniAccountingRulePreview.preview('restaurant', 'sale', context({ tax: 100, taxRate: 14 }), settings(runtime));
  assert.equal(valid.valid, true);
  assert.ok(invalid.validation.errors.some(error => error.code === 'TAX_CALCULATION_MISMATCH'));
});

test('Discount Rules remain balanced and reject excess discount', () => {
  const runtime = createRuntime();
  const valid = runtime.OmniAccountingRulePreview.preview('clothes', 'sale', context({ discount: 100 }), settings(runtime));
  const invalid = runtime.OmniAccountingRulePreview.preview('clothes', 'sale', context({ discount: 1100 }), settings(runtime));
  assert.equal(valid.balanced, true);
  assert.equal(valid.effects.profit.amountDelta, 700);
  assert.ok(invalid.validation.errors.some(error => error.code === 'DISCOUNT_INVALID'));
});

test('Profit Rules do not calculate profit without positive cost', () => {
  const runtime = createRuntime();
  const preview = runtime.OmniAccountingRulePreview.preview('mobile_shop', 'sale', context({ cost: 0 }), settings(runtime));
  assert.equal(preview.valid, false);
  assert.ok(preview.validation.errors.some(error => error.code === 'COST_REQUIRED'));
});

test('Validation Rules reject insufficient stock and wrong currency', () => {
  const runtime = createRuntime();
  const preview = runtime.OmniAccountingRulePreview.preview('car_parts', 'sale', context({ quantity: 5, availableStock: 2, currency: 'USD' }), settings(runtime));
  assert.ok(preview.validation.errors.some(error => error.code === 'INSUFFICIENT_STOCK'));
  assert.ok(preview.validation.errors.some(error => error.code === 'CURRENCY_MISMATCH'));
});

test('Validation Rules detect a missing configured account', () => {
  const runtime = createRuntime();
  const configured = settings(runtime, { defaultAccounts: { ...settings(runtime).defaultAccounts, revenue: 'missing_revenue_account' } });
  const preview = runtime.OmniAccountingRulePreview.preview('computer_shop', 'sale', context(), configured);
  assert.ok(preview.validation.errors.some(error => ['REQUIRED_ACCOUNT_MISSING', 'ACCOUNT_MISSING'].includes(error.code)));
});

test('Rule Preview never mutates its context or settings', () => {
  const runtime = createRuntime();
  const sourceContext = context();
  const sourceSettings = settings(runtime);
  const before = JSON.stringify({ sourceContext, sourceSettings });
  const preview = runtime.OmniAccountingRulePreview.preview('supermarket', 'sale', sourceContext, sourceSettings);
  assert.equal(JSON.stringify({ sourceContext, sourceSettings }), before);
  assert.equal(preview.preview, true);
  assert.equal(preview.readOnly, true);
  assert.equal(preview.persisted, false);
});

test('all 180 bundled rules can produce a balanced preview', () => {
  const runtime = createRuntime();
  runtime.OmniAccountingRuleRegistry.listProfiles().forEach(profile => {
    profile.rules.forEach(rule => {
      const input = context();
      if (rule.templateId === 'closing_balance') {
        input.entries = [{ accountKey: 'cash', debit: 1000, credit: 0 }, { accountKey: 'retained_earnings', debit: 0, credit: 1000 }];
      }
      const preview = runtime.OmniAccountingRulePreview.preview(profile.id, rule.templateId, input, settings(runtime));
      assert.equal(preview.balanced, true, `${rule.ruleId} must balance`);
    });
  });
});
