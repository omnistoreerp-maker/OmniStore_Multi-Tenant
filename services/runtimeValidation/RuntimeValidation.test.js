const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..');
const sandbox = vm.createContext({ console, Date, globalThis: {} });
sandbox.window = sandbox.globalThis;

function load(folder, files) {
  files.forEach(file => {
    const source = fs.readFileSync(path.join(projectRoot, folder, file), 'utf8');
    new vm.Script(source, { filename: file }).runInContext(sandbox);
  });
}

load('services/accounting', [
  'AccountingValidator.js', 'JournalEngine.js', 'AccountBalanceEngine.js', 'LedgerEngine.js',
  'TrialBalanceEngine.js', 'FiscalYearEngine.js', 'VoucherEngine.js', 'PostingEngine.js',
  'OpeningBalanceEngine.js', 'AccountingEngine.js'
]);
load('services/runtimeValidation', [
  'BusinessRuleValidator.js', 'WarehouseRuntimeValidator.js', 'InventoryRuntimeValidator.js',
  'AccountingRuntimeValidator.js', 'CurrencyRuntimeValidator.js', 'TaxRuntimeValidator.js',
  'DocumentRuntimeValidator.js', 'PermissionRuntimeValidator.js', 'PostingRuntimeValidator.js',
  'RuntimeValidationReportBuilder.js', 'RuntimeValidationEngine.js'
]);

const accounting = sandbox.globalThis.OmniEnterpriseAccounting;
const runtime = sandbox.globalThis.OmniRuntimeValidation;

function healthyContext() {
  return {
    validationDate: '2026-06-30',
    businessProfile: { type: 'computer_shop', companyName: 'DigiTronics', accounting: { inventoryAccount: 'inventory_asset' } },
    accountingEngine: accounting.AccountingEngine.createEngine(),
    warehouses: [{ id: 'main', name: 'Main Warehouse', active: true }],
    products: [{ id: 'p1', name: 'Laptop', cost: 100, stock: 10, unitConversion: 1 }],
    documents: [{
      id: 'S-1', reference: 'S-1', type: 'sales_invoice', customerId: 'c1',
      warehouseId: 'main', currency: 'EGP', exchangeRate: 1,
      items: [{ productId: 'p1', quantity: 1 }]
    }],
    previews: [{
      readOnly: true, persisted: false, posted: false, valid: true,
      accountingEffect: { totals: { debit: 150, credit: 150, difference: 0 }, costImpact: 100 },
      inventoryEffect: { costImpact: 100 }
    }],
    currencySettings: { baseCurrency: 'EGP' },
    taxConfiguration: { enabled: true },
    role: 'Owner',
    reconciliation: { inventoryBalanced: true, accountingBalanced: true }
  };
}

function run() {
  const good = runtime.RuntimeValidationEngine.validate(healthyContext());
  assert.strictEqual(good.readOnly, true);
  assert.strictEqual(good.persisted, false);
  assert.strictEqual(good.posted, false);
  assert.strictEqual(good.inventoryUpdated, false);
  assert.strictEqual(good.databaseTouched, false);
  assert.strictEqual(good.report.overallRuntimeScore, 100);
  assert.strictEqual(good.report.postingEligibility.eligible, true);
  assert.strictEqual(good.report.businessReadiness.ready, true);
  assert.strictEqual(good.report.inventoryReadiness.ready, true);
  assert.strictEqual(good.report.accountingReadiness.ready, true);
  assert.strictEqual(good.report.permissionReadiness.ready, true);

  const bad = healthyContext();
  bad.businessProfile = {};
  bad.warehouses = [];
  bad.products = [{ id: 'p1', name: '', cost: 0, stock: -2, unitConversion: 0 }];
  bad.documents = [
    { id: 'DUP', reference: 'DUP', type: 'sales_invoice', items: [{ quantity: 5 }], exchangeRate: 0, taxRate: 120 },
    { id: 'DUP', reference: 'DUP', type: 'unknown', items: [] }
  ];
  bad.previews = [{ readOnly: false, valid: false, errors: [{ code: 'X' }], accountingEffect: { totals: { debit: 10, credit: 0, difference: 10 }, costImpact: 8 }, inventoryEffect: { costImpact: 4 } }];
  bad.role = 'Cashier';
  bad.permissions = [];
  bad.taxConfiguration = {};
  bad.reconciliation = { inventoryBalanced: false, accountingBalanced: false };
  const failed = runtime.RuntimeValidationEngine.validate(bad);
  const codes = failed.report.criticalErrors.map(item => item.code);
  [
    'BUSINESS_PROFILE_MISSING', 'WAREHOUSE_UNAVAILABLE', 'ITEM_COST_MISSING',
    'NEGATIVE_INVENTORY', 'INVALID_UNIT_CONVERSION', 'JOURNAL_UNBALANCED',
    'DUPLICATE_REFERENCE', 'UNSUPPORTED_OPERATION', 'DOCUMENT_PRODUCT_LINK_MISSING',
    'POSTING_PERMISSION_DENIED', 'EXCHANGE_RATE_INVALID', 'TAX_RATE_INVALID',
    'PREVIEW_COUNT_MISMATCH', 'CROSS_MODULE_COST_MISMATCH',
    'INVENTORY_RECONCILIATION_FAILED', 'ACCOUNTING_RECONCILIATION_FAILED'
  ].forEach(code => assert.ok(codes.includes(code), `Expected ${code}`));
  assert.strictEqual(failed.report.postingEligibility.eligible, false);
  assert.ok(failed.report.blockingErrors.length >= 16);
  assert.ok(failed.report.runtimeChecklist.length >= 10);

  const serviceDir = path.join(projectRoot, 'services', 'runtimeValidation');
  const productionFiles = fs.readdirSync(serviceDir).filter(name => name.endsWith('.js') && name !== 'RuntimeValidation.test.js');
  const productionSource = productionFiles.map(name => fs.readFileSync(path.join(serviceDir, name), 'utf8')).join('\n');
  assert.strictEqual(/localStorage\s*\.\s*(setItem|removeItem|clear)|supabase|createClient|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|\.post\s*\(|\.unPost\s*\(|\.reverse\s*\(|\.receive\s*\(|\.issue\s*\(|saveDB|ghPush/i.test(productionSource), false);

  const html = fs.readFileSync(path.join(projectRoot, 'DigiTronics_v5.html'), 'utf8');
  const sectionStart = html.indexOf('id="runtimeValidationSection"');
  const section = html.slice(sectionStart, sectionStart + 3500);
  assert.ok(sectionStart > 0);
  assert.ok(section.includes('onclick="validateRuntime()"'));
  assert.ok(section.includes('onclick="readRuntimeReport()"'));
  assert.ok(section.includes('onclick="exportRuntimeReport()"'));
  assert.ok(section.includes('فحص الجاهزية الآن'));
  assert.strictEqual(/Save Runtime|Post Runtime|Repair Runtime|Execute SQL|Run SQL/i.test(section), false);
  assert.ok(html.includes('RuntimeValidationEngine.js'));
  assert.ok(html.includes('renderRuntimeValidationSection()'));

  const sw = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
  assert.ok(/omnistore-erp-v(21-runtime-validation|22-uat-readiness|23-demo-polish|24-uat-feedback|25-client-handoff|26-master-release|27-configuration-preview|28-data-layer-preview|29-auth-preview|30-tenancy-preview|31-deployment-simulation|32-real-supabase-installer|33-customer-provisioning)/.test(sw));
  assert.ok(sw.includes('./services/runtimeValidation/RuntimeValidationEngine.js'));

  return {
    tests: 35,
    healthyScore: good.report.overallRuntimeScore,
    blockedIssuesDetected: failed.report.blockingErrors.length,
    postingEligibleWhenHealthy: good.report.postingEligibility.eligible
  };
}

if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { run };
