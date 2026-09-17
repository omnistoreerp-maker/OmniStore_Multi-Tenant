const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const html = fs.readFileSync(path.join(projectRoot, 'DigiTronics_v5.html'), 'utf8');
const ui = fs.readFileSync(path.join(projectRoot, 'services', 'integration', 'erpPreviewUi.js'), 'utf8');
const sw = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');

function run() {
  assert.ok(html.includes('page-erp-preview-center'), 'ERP Preview Center page should exist');
  assert.ok(html.includes('data-page="erp-preview-center"'), 'ERP Preview Center navigation item should exist');
  assert.ok(html.includes('renderERPPreviewCenter()'), 'showPage should render ERP Preview Center');
  assert.ok(html.includes('./services/integration/erpPreviewUi.js'), 'UI script should be loaded');
  assert.ok(ui.includes('function renderERPPreviewCenter'), 'renderERPPreviewCenter should exist');
  assert.ok(ui.includes('function runERPPreview'), 'runERPPreview should exist');
  assert.ok(ui.includes('Preview Only — No Posting'), 'buttons must be clearly labeled preview only');
  assert.strictEqual(/localStorage\.setItem|saveDB|ghPush|applySupabase|rebuildSupabase|executeSql|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|\.post\s*\(|\.receive\s*\(|\.issue\s*\(/i.test(ui), false, 'UI must not write/save/post/update');
  assert.strictEqual(/supabase|createClient|fetch\s*\(/i.test(ui), false, 'UI must not use Supabase or network');
  assert.ok(ui.includes('ERPIntegrationEngine.createEngine'), 'integration engine should be called');
  assert.ok(ui.includes('readOnlyInventorySnapshot'), 'inventory integration should be read-only snapshot');
  assert.ok(html.includes('function showPage'), 'existing showPage core function should still exist');
  assert.ok(html.includes('function renderInvoices'), 'existing invoice render function should still exist');
  assert.ok(html.includes('function renderPurchases'), 'existing purchase render function should still exist');
  assert.ok(html.includes('function renderProductsTable'), 'existing product render function should still exist');
  assert.ok(/omnistore-erp-v(19-erp-preview-center|20-posting-readiness-center|21-runtime-validation|22-uat-readiness|23-demo-polish|24-uat-feedback|25-client-handoff|26-master-release|27-configuration-preview|28-data-layer-preview|29-auth-preview|30-tenancy-preview|31-deployment-simulation|32-real-supabase-installer|33-customer-provisioning)/.test(sw), 'service worker cache version should include Preview Center or newer');
  return { tests: 16 };
}

if (require.main === module) {
  console.log(JSON.stringify(run(), null, 2));
}

module.exports = { run };
