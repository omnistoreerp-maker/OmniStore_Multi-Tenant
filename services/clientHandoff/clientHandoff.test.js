const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..');
const sandbox = vm.createContext({ console, Date, globalThis: {} });
sandbox.window = sandbox.globalThis;
[
  'DemoScenarioBuilder.js', 'ClientTrainingChecklist.js', 'UATSessionPlanner.js',
  'DemoLimitationsBuilder.js', 'CustomerQuestionsBuilder.js', 'ClientSignoffBuilder.js',
  'ClientHandoffValidator.js', 'ClientHandoffEngine.js'
].forEach(file => new vm.Script(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file }).runInContext(sandbox));

const handoff = sandbox.globalThis.OmniClientHandoff;

function run() {
  const result = handoff.ClientHandoffEngine.build({ customer: 'Demo Customer', customerName: 'Demo Customer' });
  assert.strictEqual(result.readOnly, true);
  assert.strictEqual(result.persisted, false);
  assert.strictEqual(result.posted, false);
  assert.strictEqual(result.databaseTouched, false);
  assert.strictEqual(result.localStorageWritten, false);
  assert.strictEqual(result.handoffReadinessScore, 100);
  assert.strictEqual(result.status, 'ready_for_client_handoff');
  assert.strictEqual(result.validation.valid, true);
  assert.strictEqual(result.package.versionType, 'UAT/Beta');
  assert.strictEqual(result.package.scenarios.length, 10);
  assert.strictEqual(result.package.trainingChecklist.length, 10);
  assert.strictEqual(result.package.sessionPlan.totalMinutes, 90);
  assert.strictEqual(result.package.sessionPlan.feedbackAfterDemo, true);
  assert.strictEqual(result.package.sessionPlan.persisted, false);
  assert.ok(result.package.limitations.length >= 8);
  assert.ok(result.package.customerQuestions.length >= 10);
  assert.strictEqual(result.package.signoff.persisted, false);
  assert.ok(result.package.signoff.items.length >= 8);

  const scenarioIds = result.package.scenarios.map(item => item.id);
  handoff.ClientHandoffValidator.REQUIRED_SCENARIOS.forEach(id => assert.ok(scenarioIds.includes(id), `Missing ${id}`));
  [
    'add_product','purchase_invoice','sales_invoice','pos_sale','inventory_review',
    'reports_review','erp_preview','posting_readiness','runtime_validation','customer_feedback'
  ].forEach(id => assert.ok(scenarioIds.includes(id)));

  const invalidPackage = { ...result.package, scenarios: result.package.scenarios.slice(1), limitations: [] };
  const invalid = handoff.ClientHandoffValidator.validate(invalidPackage);
  assert.strictEqual(invalid.valid, false);
  assert.ok(invalid.errors.some(item => item.code === 'SCENARIO_MISSING'));
  assert.ok(invalid.errors.some(item => item.code === 'SAFETY_MESSAGE_MISSING'));

  const productionFiles = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && name !== 'clientHandoff.test.js');
  const source = productionFiles.map(name => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n');
  assert.strictEqual(/localStorage\s*\.\s*(setItem|removeItem|clear)|createClient|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|\.post\s*\(|\.unPost\s*\(|\.reverse\s*\(|\.receive\s*\(|\.issue\s*\(|saveDB|ghPush|fetch\s*\(/i.test(source), false);

  const html = fs.readFileSync(path.join(projectRoot, 'DigiTronics_v5.html'), 'utf8');
  const pages = ['client-demo-package','training-checklist','demo-scenarios','client-signoff','known-limitations'];
  pages.forEach(page => {
    assert.ok(html.includes(`data-page="${page}"`), `Missing navigation ${page}`);
    assert.ok(html.includes(`id="page-${page}"`), `Missing page ${page}`);
    assert.ok(html.includes(`renderClientHandoffPage('${page}')`), `Missing render hook ${page}`);
  });
  ['حزمة عرض العميل','قائمة تدريب العميل','سيناريوهات العرض','اعتماد العميل','حدود النسخة الحالية'].forEach(label => assert.ok(html.includes(label)));
  assert.ok(source.includes('تصدير حزمة JSON للمعاينة'));
  assert.ok(source.includes('معاينة الطباعة'));
  assert.strictEqual(/Save Handoff|Post Handoff|حفظ الحزمة|ترحيل الحزمة/i.test(source), false);

  const combinedClientText = [
    ...result.package.limitations,
    ...result.package.trainingChecklist.map(item => item.title),
    ...result.package.customerQuestions
  ].join(' ');
  ['UAT/Beta','محاكاة فقط','قيود محاسبية فعلية','حركات مخزون فعلية','القوائم المالية الرسمية','ملاحظات العميل'].forEach(text => assert.ok(combinedClientText.includes(text), `Missing client text ${text}`));

  const docs = [
    'CLIENT_DEMO_GUIDE_20260629.md',
    'CLIENT_TRAINING_CHECKLIST_20260629.md',
    'CLIENT_UAT_SCENARIOS_20260629.md',
    'CLIENT_KNOWN_LIMITATIONS_20260629.md',
    'CLIENT_SIGNOFF_TEMPLATE_20260629.md',
    'PHASE19_IMPLEMENTATION_REPORT_20260629.md',
    'PHASE19_TEST_REPORT_20260629.md',
    'PHASE19_ROLLBACK_REPORT_20260629.md'
  ];
  docs.forEach(file => {
    const fullPath = path.join(projectRoot, file);
    assert.ok(fs.existsSync(fullPath), `Missing ${file}`);
    assert.ok(fs.readFileSync(fullPath, 'utf8').trim().length > 100, `Empty ${file}`);
  });

  const sw = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
  assert.ok(/omnistore-erp-v(25-client-handoff|26-master-release|27-configuration-preview|28-data-layer-preview|29-auth-preview|30-tenancy-preview|31-deployment-simulation|32-real-supabase-installer|33-customer-provisioning)/.test(sw));
  assert.ok(sw.includes('./services/clientHandoff/ClientHandoffEngine.js'));
  assert.ok(sw.includes('./services/clientHandoff/clientHandoffUi.js'));

  return { tests: 42, handoffReadinessScore: result.handoffReadinessScore, scenarios: result.package.scenarios.length, sessionMinutes: result.package.sessionPlan.totalMinutes };
}

if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { run };
