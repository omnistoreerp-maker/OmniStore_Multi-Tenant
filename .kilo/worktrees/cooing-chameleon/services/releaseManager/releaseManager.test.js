const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..');
const sandbox = vm.createContext({ console, Date, globalThis: {} });
sandbox.window = sandbox.globalThis;
[
  'CustomerCopyPlanner.js', 'CustomerBrandingTemplateBuilder.js', 'CustomerCopyChecklist.js',
  'ReleaseRollbackPlanner.js', 'ReleaseHealthChecker.js', 'ReleaseSnapshotEngine.js'
].forEach(file => new vm.Script(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file }).runInContext(sandbox));
const release = sandbox.globalThis.OmniReleaseManager;

function run() {
  const result = release.ReleaseSnapshotEngine.build();
  assert.strictEqual(result.readOnly, true);
  assert.strictEqual(result.persisted, false);
  assert.strictEqual(result.masterReleaseReadinessScore, 100);
  assert.strictEqual(result.customerCopyReadinessScore, 100);
  assert.strictEqual(result.status, 'master_snapshot_ready');
  assert.strictEqual(result.health.ready, true);
  assert.strictEqual(result.snapshot.projectKind, 'master');
  assert.strictEqual(result.snapshot.masterVersion, '20.0.0-master');
  assert.strictEqual(result.snapshot.completedPhases[0], 8);
  assert.strictEqual(result.snapshot.completedPhases[result.snapshot.completedPhases.length - 1], 20);
  assert.strictEqual(result.snapshot.testTotals.previous, 317);
  assert.strictEqual(result.snapshot.testTotals.phase20, 40);
  assert.strictEqual(result.snapshot.testTotals.passed, 357);
  assert.strictEqual(result.snapshot.testTotals.failed, 0);
  assert.strictEqual(result.snapshot.templateCount, 7);
  assert.strictEqual(result.snapshot.customerCopyPlan.executesCopy, false);
  assert.strictEqual(result.snapshot.customerCopyPlan.mode, 'planning_only');
  assert.strictEqual(result.snapshot.customerCopyPlan.targetPlaceholder, '{{NEW_CUSTOMER_COPY_DIRECTORY}}');
  assert.strictEqual(result.snapshot.customerCopyPlan.requiresExplicitTargetApproval, true);
  assert.ok(result.snapshot.customerCopyPlan.steps.length >= 8);
  assert.ok(result.snapshot.customerCopyPlan.masterProtections.length >= 6);
  assert.strictEqual(result.snapshot.customerCopyChecklist.length, 11);
  assert.strictEqual(result.snapshot.brandingTemplate.businessType, 'computer_shop');
  assert.strictEqual(result.snapshot.rollbackPlan.destructive, false);
  assert.strictEqual(result.snapshot.rollbackPlan.databaseRollbackRequired, false);
  Object.values(result.snapshot.safety).forEach((value, index) => {
    if (index === 0) assert.strictEqual(value, true);
    else assert.strictEqual(value, false);
  });

  const requiredServices = [
    'ReleaseSnapshotEngine.js','CustomerCopyPlanner.js','CustomerBrandingTemplateBuilder.js',
    'CustomerCopyChecklist.js','ReleaseHealthChecker.js','ReleaseRollbackPlanner.js',
    'releaseManager.test.js','README.md'
  ];
  requiredServices.forEach(file => assert.ok(fs.existsSync(path.join(__dirname, file)), `Missing ${file}`));

  const templateDir = path.join(projectRoot, 'templates', 'customerCopy');
  const templates = [
    'company.template.json','branding.template.json','customer.template.json','uat.template.json',
    'CLIENT_DEMO_GUIDE_TEMPLATE.md','CLIENT_SIGNOFF_TEMPLATE.md','CUSTOMER_COPY_CHECKLIST.md'
  ];
  templates.forEach(file => assert.ok(fs.existsSync(path.join(templateDir, file)), `Missing ${file}`));
  templates.filter(file => file.endsWith('.json')).forEach(file => assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(templateDir, file), 'utf8'))));
  const customerTemplate = JSON.parse(fs.readFileSync(path.join(templateDir, 'customer.template.json'), 'utf8'));
  assert.strictEqual(customerTemplate.target_directory, '{{NEW_CUSTOMER_COPY_DIRECTORY}}');

  const productionFiles = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && name !== 'releaseManager.test.js');
  const source = productionFiles.map(name => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n');
  assert.strictEqual(/localStorage\s*\.\s*(setItem|removeItem|clear)|createClient|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|\.post\s*\(|\.unPost\s*\(|\.reverse\s*\(|\.receive\s*\(|\.issue\s*\(|saveDB|ghPush|fetch\s*\(/i.test(source), false);
  assert.strictEqual(/\b(copyFile|cpSync|mkdirSync|writeFileSync|renameSync|rmSync)\s*\(/i.test(source), false);
  assert.strictEqual(/[A-Z]:\\Projects\\/i.test(source), false);

  const html = fs.readFileSync(path.join(projectRoot, 'DigiTronics_v5.html'), 'utf8');
  const pages = ['master-release-snapshot','customer-copy-checklist','new-customer-setup-guide','release-health'];
  pages.forEach(page => {
    assert.ok(html.includes(`data-page="${page}"`), `Missing navigation ${page}`);
    assert.ok(html.includes(`id="page-${page}"`), `Missing page ${page}`);
    assert.ok(html.includes(`renderReleaseManagerPage('${page}')`), `Missing render hook ${page}`);
  });
  ['لقطة إصدار Master','قائمة تجهيز نسخة عميل','دليل إعداد عميل جديد','صحة الإصدار'].forEach(label => assert.ok(html.includes(label)));
  ['نسخة تجريبية','Preview Only — No Posting','لا يتم حفظ قيود محاسبية','لا يتم ترحيل مخزون فعلي'].forEach(label => assert.ok(html.includes(label), `Safety label removed: ${label}`));

  const rollbackFiles = fs.readdirSync(projectRoot).filter(name => /ROLLBACK/i.test(name));
  assert.ok(rollbackFiles.length >= 10, 'Existing rollback files must remain present.');

  [
    'PHASE20_IMPLEMENTATION_REPORT_20260630.md','PHASE20_TEST_REPORT_20260630.md',
    'PHASE20_RELEASE_SNAPSHOT_20260630.md','PHASE20_CUSTOMER_COPY_GUIDE_20260630.md',
    'PHASE20_ROLLBACK_REPORT_20260630.md'
  ].forEach(file => assert.ok(fs.existsSync(path.join(projectRoot, file)), `Missing ${file}`));

  const sw = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
  assert.ok(/omnistore-erp-v(26-master-release|27-configuration-preview|28-data-layer-preview|29-auth-preview|30-tenancy-preview|31-deployment-simulation|32-real-supabase-installer|33-customer-provisioning)/.test(sw));
  assert.ok(sw.includes('./services/releaseManager/ReleaseSnapshotEngine.js'));
  assert.ok(sw.includes('./templates/customerCopy/company.template.json'));

  return { tests: 40, masterReleaseReadinessScore: result.masterReleaseReadinessScore, customerCopyReadinessScore: result.customerCopyReadinessScore, templates: templates.length };
}

if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { run };
