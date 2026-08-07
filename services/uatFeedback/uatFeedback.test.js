const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..');
const sandbox = vm.createContext({ console, Date, globalThis: {} });
sandbox.window = sandbox.globalThis;
[
  'FeedbackCategoryRegistry.js', 'IssueSeverityClassifier.js', 'UATFeedbackValidator.js',
  'CustomerNoteBuilder.js', 'UATIssueTracker.js', 'UATFeedbackReportBuilder.js',
  'UATFeedbackEngine.js'
].forEach(file => new vm.Script(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file }).runInContext(sandbox));

const feedback = sandbox.globalThis.OmniUATFeedback;

function run() {
  assert.strictEqual(feedback.FeedbackCategoryRegistry.CATEGORIES.length, 8);
  assert.strictEqual(feedback.IssueSeverityClassifier.SEVERITIES.length, 4);
  assert.strictEqual(feedback.UATFeedbackValidator.STATUSES.length, 5);
  assert.strictEqual(feedback.IssueSeverityClassifier.classify({ details: 'system crash and data loss' }), 'Critical');
  assert.strictEqual(feedback.IssueSeverityClassifier.classify({ details: 'label is confusing' }), 'Medium');
  assert.strictEqual(feedback.IssueSeverityClassifier.classify({ details: 'minor suggestion' }), 'Low');

  const engine = feedback.UATFeedbackEngine.createEngine();
  assert.strictEqual(engine.storage, 'memory-only');
  assert.strictEqual(engine.readOnlySafe, true);
  assert.strictEqual(engine.persisted, false);
  const bug = engine.addFeedback({
    title: 'Search label unclear',
    details: 'The customer could not find product search.',
    category: 'bug',
    severity: 'High',
    status: 'New'
  }, { id: 'UAT-TEST-1', createdAt: '2026-06-29T10:00:00.000Z' });
  const request = engine.addFeedback({
    title: 'Monthly report',
    details: 'Customer requests monthly comparison.',
    category: 'report_request',
    severity: 'Low',
    status: 'Discussed'
  }, { id: 'UAT-TEST-2', createdAt: '2026-06-29T10:01:00.000Z' });
  assert.strictEqual(bug.temporary, true);
  assert.strictEqual(bug.persisted, false);
  assert.strictEqual(request.category, 'report_request');
  assert.strictEqual(engine.count(), 2);
  assert.strictEqual(engine.list().length, 2);
  assert.strictEqual(engine.list({ category: 'bug' }).length, 1);
  assert.strictEqual(engine.list({ categories: ['report_request', 'feature_request'] }).length, 1);
  const updated = engine.updateStatus('UAT-TEST-1', 'Approved');
  assert.strictEqual(updated.status, 'Approved');
  assert.strictEqual(updated.persisted, false);
  assert.strictEqual(engine.list({ status: 'Approved' }).length, 1);

  const report = engine.report();
  assert.strictEqual(report.readOnlyPreview, true);
  assert.strictEqual(report.total, 2);
  assert.strictEqual(report.byCategory.bug, 1);
  assert.strictEqual(report.byCategory.report_request, 1);
  assert.strictEqual(report.bySeverity.High, 1);
  assert.strictEqual(report.byStatus.Approved, 1);
  assert.ok(report.summaryText.includes('Search label unclear'));

  assert.throws(() => engine.addFeedback({ title: '', details: '', category: 'missing' }), /required|invalid/i);
  assert.throws(() => engine.updateStatus('UAT-TEST-1', 'Saved'), /Invalid status/);

  const productionFiles = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && name !== 'uatFeedback.test.js');
  const source = productionFiles.map(name => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n');
  assert.strictEqual(/localStorage\s*\.\s*(setItem|removeItem|clear)|createClient|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|\.post\s*\(|\.unPost\s*\(|\.reverse\s*\(|\.receive\s*\(|\.issue\s*\(|saveDB|ghPush|fetch\s*\(/i.test(source), false);

  const html = fs.readFileSync(path.join(projectRoot, 'DigiTronics_v5.html'), 'utf8');
  const pages = ['customer-feedback', 'uat-issues', 'demo-notes', 'client-requests'];
  pages.forEach(page => {
    assert.ok(html.includes(`data-page="${page}"`), `Missing navigation ${page}`);
    assert.ok(html.includes(`id="page-${page}"`), `Missing page ${page}`);
    assert.ok(html.includes(`renderUATFeedbackPage('${page}')`), `Missing render hook ${page}`);
  });
  ['ملاحظات العميل','مشكلات تجربة القبول','ملاحظات العرض','طلبات العميل'].forEach(label => assert.ok(html.includes(label)));
  ['نسخ ملخص الملاحظات','تصدير معاينة JSON','معاينة الطباعة','إضافة ملاحظة مؤقتة'].forEach(label => assert.ok(source.includes(label)));
  ['Bug','UI Improvement','Accounting Concern','Inventory Concern','Sales/POS Concern','Report Request','Feature Request','Training Question'].forEach(label => assert.ok(source.includes(label)));
  ['Low','Medium','High','Critical','New','Discussed','Approved','Rejected','Deferred'].forEach(label => assert.ok(source.includes(label)));
  assert.strictEqual(/حفظ الملاحظة|Save Feedback|Post Feedback/i.test(source), false);

  const sw = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
  assert.ok(/omnistore-erp-v(24-uat-feedback|25-client-handoff|26-master-release|27-configuration-preview|28-data-layer-preview|29-auth-preview|30-tenancy-preview|31-deployment-simulation|32-real-supabase-installer|33-customer-provisioning)/.test(sw));
  assert.ok(sw.includes('./services/uatFeedback/UATFeedbackEngine.js'));
  assert.ok(sw.includes('./services/uatFeedback/uatFeedbackUi.js'));

  [
    'PHASE18_IMPLEMENTATION_REPORT_20260629.md',
    'PHASE18_TEST_REPORT_20260629.md',
    'PHASE18_FEEDBACK_REPORT_20260629.md',
    'PHASE18_ROLLBACK_REPORT_20260629.md',
    'CUSTOMER_FEEDBACK_TEMPLATE_20260629.md'
  ].forEach(file => assert.ok(fs.existsSync(path.join(projectRoot, file)), `Missing ${file}`));

  return { tests: 40, temporaryFeedbackItems: engine.count(), categories: feedback.FeedbackCategoryRegistry.CATEGORIES.length };
}

if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { run };
