const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..');
const sandbox = vm.createContext({ console, Date, globalThis: {} });
sandbox.window = sandbox.globalThis;
[
  'CustomerDemoChecklist.js', 'CustomerFeedbackTemplate.js', 'DemoSafetyValidator.js',
  'DemoReadinessReportBuilder.js', 'DemoPolishEngine.js'
].forEach(file => new vm.Script(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file }).runInContext(sandbox));
const demo = sandbox.globalThis.OmniDemoPolish;

const labels = [
  'نسخة تجريبية', 'Preview Only — No Posting',
  'لا يتم حفظ قيود محاسبية', 'لا يتم ترحيل مخزون فعلي'
];

function run() {
  const good = demo.DemoPolishEngine.review({
    customerFacingText: labels.join(' | '),
    demoActions: ['عرض الدليل', 'تصدير تقرير تجريبي'],
    pageChecks: Array.from({ length: 14 }, (_, index) => ({ id: `page-${index}`, present: true, clearLabel: true })),
    localStorageWrite: false,
    databaseWrite: false
  });
  assert.strictEqual(good.readOnly, true);
  assert.strictEqual(good.persisted, false);
  assert.strictEqual(good.posted, false);
  assert.strictEqual(good.inventoryUpdated, false);
  assert.strictEqual(good.databaseTouched, false);
  assert.strictEqual(good.localStorageWritten, false);
  assert.strictEqual(good.report.demoReadinessScore, 100);
  assert.strictEqual(good.report.status, 'ready_for_customer_demo');
  assert.strictEqual(good.report.reviewedPages, 14);
  assert.ok(good.report.checklist.length >= 9);
  assert.ok(good.report.whatToTest.length >= 6);
  assert.ok(good.report.knownLimitations.length >= 4);
  assert.strictEqual(good.report.feedbackTemplate.persisted, false);

  const unsafe = demo.DemoPolishEngine.review({
    customerFacingText: 'نسخة ناقصة',
    demoActions: ['Save', 'Post Now'],
    pageChecks: [{ id: 'dashboard', present: false }],
    localStorageWrite: true,
    databaseWrite: true
  });
  assert.strictEqual(unsafe.report.status, 'review_required');
  assert.ok(unsafe.report.safety.issues.some(issue => issue.code === 'UNSAFE_DEMO_ACTION'));
  assert.ok(unsafe.report.safety.issues.some(issue => issue.code === 'DEMO_STORAGE_WRITE'));
  assert.ok(unsafe.report.safety.issues.some(issue => issue.code === 'DEMO_DATABASE_WRITE'));
  assert.strictEqual(unsafe.report.safety.missingLabels.length, 4);

  const productionFiles = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && name !== 'demoPolish.test.js');
  const source = productionFiles.map(name => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n');
  assert.strictEqual(/localStorage\s*\.\s*(setItem|removeItem|clear)|createClient|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|\.post\s*\(|\.unPost\s*\(|\.reverse\s*\(|\.receive\s*\(|\.issue\s*\(|saveDB|ghPush|fetch\s*\(/i.test(source), false);
  assert.strictEqual(/<button\b/i.test(source), false);

  const html = fs.readFileSync(path.join(projectRoot, 'DigiTronics_v5.html'), 'utf8');
  labels.forEach(label => assert.ok(html.includes(label), `Missing demo label: ${label}`));
  assert.ok(html.includes('id="customerDemoGuide"'));
  assert.ok(html.includes('renderCustomerDemoGuide()'));
  ['خطوات عملية لتجربة النظام', 'مركز معاينة العمليات', 'فحص جاهزية الترحيل', 'حالة النظام'].forEach(text => assert.ok(html.includes(text)));
  [
    'dashboard','pos','invoices','purchases','products','stockmovement','reports',
    'erp-preview-center','posting-readiness-center','production-readiness',
    'customer-acceptance','system-health-uat','deployment-checklist'
  ].forEach(page => assert.ok(html.includes(`id="page-${page}"`), `Missing page ${page}`));
  assert.ok(html.includes('id="runtimeValidationSection"'));

  const guideStart = html.indexOf('id="customerDemoGuide"');
  const guideArea = html.slice(guideStart, guideStart + 300);
  assert.strictEqual(/<button/i.test(guideArea), false);

  const sw = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
  assert.ok(/omnistore-erp-v(23-demo-polish|24-uat-feedback|25-client-handoff|26-master-release|27-configuration-preview|28-data-layer-preview|29-auth-preview|30-tenancy-preview|31-deployment-simulation|32-real-supabase-installer|33-customer-provisioning)/.test(sw));
  assert.ok(sw.includes('./services/demoPolish/DemoPolishEngine.js'));

  [
    'PHASE17_IMPLEMENTATION_REPORT_20260629.md',
    'PHASE17_TEST_REPORT_20260629.md',
    'PHASE17_DEMO_REPORT_20260629.md',
    'PHASE17_ROLLBACK_REPORT_20260629.md',
    'CUSTOMER_DEMO_GUIDE_20260629.md'
  ].forEach(file => assert.ok(fs.existsSync(path.join(projectRoot, file)), `Missing report ${file}`));

  return { tests: 34, demoReadinessScore: good.report.demoReadinessScore, reviewedCustomerPages: good.report.reviewedPages };
}

if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { run };
