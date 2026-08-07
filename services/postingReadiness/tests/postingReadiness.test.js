const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const context = vm.createContext({ console, globalThis: {} });
context.window = context.globalThis;

function load(folder, files) {
  files.forEach(file => {
    new vm.Script(fs.readFileSync(path.join(projectRoot, folder, file), 'utf8'), { filename: file }).runInContext(context);
  });
}

load('services/accounting', ['AccountingValidator.js','JournalEngine.js','AccountBalanceEngine.js','LedgerEngine.js','TrialBalanceEngine.js','FiscalYearEngine.js','VoucherEngine.js','PostingEngine.js','OpeningBalanceEngine.js','AccountingEngine.js']);
load('services/postingReadiness', ['PostingReadinessValidator.js','AccountingReadinessChecker.js','InventoryReadinessChecker.js','SalesReadinessChecker.js','PurchaseReadinessChecker.js','POSReadinessChecker.js','DataCompletenessChecker.js','ReconciliationEngine.js','PostingRiskAnalyzer.js','ReconciliationReportBuilder.js','PostingReadinessEngine.js']);

const accounting = context.globalThis.OmniEnterpriseAccounting;
const readiness = context.globalThis.OmniPostingReadiness;

function run() {
  const accountingEngine = accounting.AccountingEngine.createEngine();
  const result = readiness.PostingReadinessEngine.run({
    accountingEngine,
    products: [
      { id: 'p1', name: 'No Cost', stock: 5 },
      { id: 'p2', name: 'Negative Stock', cost: 10, stock: -1, accountId: 'inventory_asset' }
    ],
    customers: [{ id: 'c1' }],
    suppliers: [{ id: 's1' }],
    salesInvoices: [
      { id: 'S1', customerId: 'missing', items: [{ productId: 'missing', qty: 1 }] },
      { id: 'S1', customerId: 'c1', items: [] }
    ],
    purchaseInvoices: [
      { id: 'P1', supplierId: 'missing', items: [{ productId: 'p1', qty: 1 }] }
    ],
    businessProfile: { type: 'computer_shop', accounting: {} },
    previewDocuments: []
  });

  assert.strictEqual(result.readOnly, true);
  assert.strictEqual(result.persisted, false);
  assert.strictEqual(result.posted, false);
  assert.ok(result.summary.critical.some(i => i.code === 'MISSING_PRODUCT_COST'));
  assert.ok(result.summary.critical.some(i => i.code === 'NEGATIVE_STOCK_RISK'));
  assert.ok(result.summary.critical.some(i => i.code === 'INVOICE_PRODUCT_LINK_MISSING'));
  assert.ok(result.summary.warnings.some(i => i.code === 'MISSING_CUSTOMER'));
  assert.ok(result.summary.warnings.some(i => i.code === 'MISSING_SUPPLIER'));
  assert.ok(result.summary.warnings.some(i => i.code === 'DUPLICATE_DOCUMENT_REFERENCE'));
  assert.ok(result.summary.warnings.some(i => i.code === 'INCOMPLETE_BUSINESS_PROFILE_ACCOUNTING'));
  assert.strictEqual(result.risk.riskLevel, 'high');
  assert.ok(result.report.requiredFixesBeforePosting.length > 0);

  const unbalanced = readiness.ReconciliationEngine.checkPreview({ accountingEffect: { totals: { difference: 10 } }, inventoryEffect: [] }, 'bad-doc');
  assert.strictEqual(unbalanced[0].code, 'UNBALANCED_PREVIEW_JOURNAL');

  const source = fs.readFileSync(path.join(projectRoot, 'services', 'postingReadiness', 'postingReadinessUi.js'), 'utf8');
  assert.strictEqual(/localStorage\.setItem|saveDB|ghPush|supabase|createClient|fetch\s*\(|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|\.post\s*\(|\.receive\s*\(|\.issue\s*\(/i.test(source), false);

  const html = fs.readFileSync(path.join(projectRoot, 'DigiTronics_v5.html'), 'utf8');
  assert.ok(html.includes('page-posting-readiness-center'));
  assert.ok(html.includes('data-page="posting-readiness-center"'));
  assert.strictEqual(/Post Now|Save Fix|Auto Repair|Fix Automatically/i.test(html.slice(html.indexOf('page-posting-readiness-center'), html.indexOf('page-posting-readiness-center') + 2500)), false);

  return { tests: 16, score: result.summary.score, riskLevel: result.risk.riskLevel };
}

if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { run };
