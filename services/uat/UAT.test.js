const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..');
const sandbox = vm.createContext({ console, Date, globalThis: {} });
sandbox.window = sandbox.globalThis;

[
  'FeatureCoverageChecker.js', 'NavigationValidator.js', 'WorkflowValidator.js',
  'PerformanceChecklist.js', 'PermissionScenarioTester.js', 'DemoDataValidator.js',
  'SmokeTestRunner.js', 'RegressionSummaryBuilder.js', 'CustomerAcceptanceChecklist.js',
  'UATReportBuilder.js', 'UATEngine.js'
].forEach(file => {
  new vm.Script(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file }).runInContext(sandbox);
});

const uat = sandbox.globalThis.OmniUAT;
const featureIds = uat.FeatureCoverageChecker.REQUIRED_FEATURES;

function healthyContext() {
  const pages = ['dashboard','settings','reports','products','pos','invoices','purchases','stockmovement','manufacturing'];
  return {
    features: Object.fromEntries(featureIds.map(id => [id, true])),
    workflows: { pos: true, sales: true, purchases: true, inventory: true, accounting: true, reports: true, manufacturing: true },
    navigation: { routes: pages.slice(), pages: pages.slice(), menus: pages.slice() },
    performance: { startupBudgetMs: 5000, responsiveUi: true, offlineShell: true, assetBudgetKb: 3000 },
    permissionMatrix: {
      Owner: ['dashboard','settings','reports'], Admin: ['dashboard','products','reports'],
      Manager: ['dashboard','reports'], Cashier: ['pos'], Auditor: ['reports']
    },
    demoData: { products: [{}], customers: [{}], suppliers: [{}], isolated: true },
    ui: { appShell: true, search: true, filters: true, printPreview: true, exportPreview: true, keyboardShortcuts: true },
    pwa: { manifest: true, serviceWorker: true, iconCount: 8, cacheVersion: 'v22', offlineReady: true },
    regressionSuites: [{ phase: '8-15', tests: 161, passed: 161 }]
  };
}

function run() {
  const good = uat.UATEngine.run(healthyContext());
  assert.strictEqual(good.readOnly, true);
  assert.strictEqual(good.persisted, false);
  assert.strictEqual(good.posted, false);
  assert.strictEqual(good.databaseTouched, false);
  assert.strictEqual(good.localStorageWritten, false);
  assert.strictEqual(good.report.customerReadinessScore, 100);
  assert.strictEqual(good.report.deploymentReadinessScore, 100);
  assert.strictEqual(good.report.productionReadinessScore, 100);
  assert.strictEqual(good.report.status, 'ready_for_uat');
  assert.strictEqual(good.report.regression.total, 161);
  assert.strictEqual(good.report.regression.failed, 0);
  assert.ok(good.report.customerAcceptanceChecklist.length >= 10);
  assert.ok(good.report.knownLimitations.length >= 4);
  assert.ok(good.report.deploymentChecklist.length >= 6);

  const bad = healthyContext();
  bad.features.pos = false;
  bad.workflows.sales = false;
  bad.navigation = { routes: ['missing', 'missing'], pages: [], menus: [] };
  bad.performance = {};
  bad.permissionMatrix.Cashier = [];
  bad.demoData = {};
  bad.ui = {};
  bad.pwa = {};
  bad.regressionSuites = [{ phase: 'x', tests: 3, passed: 1 }];
  const failed = uat.UATEngine.run(bad);
  const codes = failed.report.blockingErrors.map(item => item.code);
  assert.ok(codes.includes('NAVIGATION_TARGET_MISSING'));
  assert.ok(codes.includes('WORKFLOW_UNAVAILABLE'));
  assert.ok(codes.includes('PERMISSION_SCENARIO_FAILED'));
  assert.ok(codes.includes('SMOKE_CHECK_FAILED'));
  assert.strictEqual(failed.report.regression.failed, 2);
  assert.strictEqual(failed.report.status, 'review_required');
  assert.ok(failed.report.productionReadinessScore < 85);
  assert.ok(failed.report.warnings.length > 0);

  const productionFiles = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && name !== 'UAT.test.js');
  const source = productionFiles.map(name => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n');
  assert.strictEqual(/localStorage\s*\.\s*(setItem|removeItem|clear)|createClient|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|\.post\s*\(|\.unPost\s*\(|\.reverse\s*\(|\.receive\s*\(|\.issue\s*\(|saveDB|ghPush|fetch\s*\(/i.test(source), false);

  const html = fs.readFileSync(path.join(projectRoot, 'DigiTronics_v5.html'), 'utf8');
  ['production-readiness','customer-acceptance','system-health-uat','deployment-checklist'].forEach(page => {
    assert.ok(html.includes(`data-page="${page}"`), `Missing navigation ${page}`);
    assert.ok(html.includes(`id="page-${page}"`), `Missing page ${page}`);
  });
  ['جاهزية العرض والتشغيل','تجربة وقبول العميل','حالة النظام','قائمة مراجعة التشغيل'].forEach(label => assert.ok(html.includes(label)));
  assert.ok(html.includes('UATEngine.js'));
  assert.ok(html.includes("renderUATPage('production-readiness')"));
  const uatSection = html.slice(html.indexOf('<!-- PHASE 16 UAT'), html.indexOf('<!-- ACCOUNTING CONFIGURATION'));
  assert.strictEqual(/onclick="[^"]*(save|post|repair|sql|database)/i.test(uatSection), false);
  assert.strictEqual(/localStorage\s*\.\s*(setItem|removeItem|clear)/i.test(uatSection), false);

  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
  assert.strictEqual(manifest.name, 'OmniStore ERP');
  assert.ok(manifest.icons.length >= 2);
  const sw = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
  assert.ok(/omnistore-erp-v(22-uat-readiness|23-demo-polish|24-uat-feedback|25-client-handoff|26-master-release|27-configuration-preview|28-data-layer-preview|29-auth-preview|30-tenancy-preview|31-deployment-simulation|32-real-supabase-installer|33-customer-provisioning)/.test(sw));
  assert.ok(sw.includes('./services/uat/UATEngine.js'));
  assert.ok(sw.includes('./services/uat/uatUi.js'));

  return {
    tests: 40,
    customerReadinessScore: good.report.customerReadinessScore,
    deploymentReadinessScore: good.report.deploymentReadinessScore,
    productionReadinessScore: good.report.productionReadinessScore,
    priorRegressionTests: good.report.regression.passed
  };
}

if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { run };
