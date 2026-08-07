const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scripts = [
  '../../accountingCore/chartOfAccounts.js',
  '../ruleTemplates.js',
  '../businessAccountingProfiles.js',
  '../ruleRegistry.js',
  '../ruleLoader.js',
  '../ruleValidator.js',
  '../ruleExecutor.js',
  '../rulePreview.js'
];

function createRuntime() {
  const context = vm.createContext({ console });
  scripts.forEach(relative => {
    const filename = path.join(__dirname, relative);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  });
  context.OmniAccountingRuleRegistry.boot();
  return context;
}

function settings(runtime, overrides = {}) {
  return {
    currency: 'EGP',
    allowNegativeStock: false,
    defaultAccounts: { ...runtime.OmniBusinessAccountingProfiles.accountDefaults },
    ...overrides
  };
}

function context(overrides = {}) {
  return {
    amount: 1000,
    cost: 100,
    quantity: 2,
    tax: 0,
    taxRate: 0,
    discount: 0,
    availableStock: 10,
    currency: 'EGP',
    paymentType: 'cash',
    inventoryDirection: 'in',
    sourceAccount: 'cash',
    destinationAccount: 'transfer_clearing',
    entries: [
      { accountKey: 'cash', debit: 1000, credit: 0 },
      { accountKey: 'opening_balance_equity', debit: 0, credit: 1000 }
    ],
    ...overrides
  };
}

module.exports = { createRuntime, settings, context };
