const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..');
const sandbox = vm.createContext({ console, Date, globalThis: {} });
sandbox.window = sandbox.globalThis;
[
  'TenantConfiguration.js','TenantContext.js','TenantManager.js','TenantResolver.js','TenantValidator.js',
  'CustomerWorkspace.js','WorkspaceSwitcherPreview.js','TenantProvisionPreview.js','TenantSchemaPlanner.js',
  'TenantRLSPlanner.js','TenantSecurityValidator.js','MultiTenantHealthChecker.js'
].forEach(file => new vm.Script(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file }).runInContext(sandbox));
const tenancy = sandbox.globalThis.OmniTenancyPreview;

function run() {
  assert.ok(tenancy.TenantManager);
  assert.ok(tenancy.TenantResolver);
  assert.ok(tenancy.TenantContext);
  assert.strictEqual(tenancy.TenantConfiguration.defaults().mode, 'preview-only');
  assert.strictEqual(tenancy.TenantConfiguration.defaults().persistence, false);
  assert.strictEqual(tenancy.TenantConfiguration.defaults().backend, 'none');
  assert.strictEqual(tenancy.TenantManager.list().length, 3);

  const resolved = tenancy.TenantResolver.resolve({ tenantId: 'tenant-demo-cairo' });
  assert.strictEqual(resolved.resolved, true);
  assert.strictEqual(resolved.backendContacted, false);
  assert.strictEqual(resolved.persisted, false);
  const missing = tenancy.TenantResolver.resolve({ tenantId: 'tenant-missing' });
  assert.strictEqual(missing.resolved, false);

  const context = tenancy.TenantManager.previewContext('tenant-demo-cairo', 'manager');
  assert.strictEqual(context.tenantId, 'tenant-demo-cairo');
  assert.strictEqual(context.previewOnly, true);
  assert.strictEqual(context.persisted, false);
  assert.strictEqual(tenancy.TenantContext.getCurrent().tenantId, context.tenantId);

  const tenant = tenancy.TenantManager.find('tenant-demo-cairo');
  const validation = tenancy.TenantValidator.validate(tenant);
  assert.strictEqual(validation.valid, true);
  assert.strictEqual(validation.writesPerformed, false);
  assert.strictEqual(tenancy.TenantValidator.validate({ id: 'bad', name: '' }).valid, false);

  const workspace = tenancy.CustomerWorkspace.preview(tenant);
  assert.strictEqual(workspace.tenantId, tenant.id);
  assert.strictEqual(workspace.databaseMapping.discriminator, 'tenant_id');
  assert.strictEqual(workspace.authenticationMapping.claim, 'tenant_id');
  assert.strictEqual(workspace.storageMapping.policy, 'tenant-isolated');
  assert.strictEqual(workspace.persisted, false);

  const switching = tenancy.WorkspaceSwitcherPreview.preview('tenant-demo-cairo', 'tenant-demo-alex', 'admin');
  assert.strictEqual(switching.valid, true);
  assert.strictEqual(switching.switchedInReality, false);
  assert.strictEqual(switching.dataLoaded, false);
  assert.strictEqual(switching.persisted, false);

  const provisioning = tenancy.TenantProvisionPreview.preview({ id: 'tenant-new-customer', name: 'New Customer' });
  assert.strictEqual(provisioning.valid, true);
  assert.strictEqual(provisioning.tenantCreated, false);
  assert.strictEqual(provisioning.workspaceCreated, false);
  assert.strictEqual(provisioning.sqlExecuted, false);
  assert.strictEqual(provisioning.backendContacted, false);

  const schema = tenancy.TenantSchemaPlanner.plan();
  assert.strictEqual(schema.strategy, 'shared-supabase-project');
  assert.ok(schema.entities.length >= 10);
  assert.ok(schema.entities.every(entity => entity.tenantColumn === 'tenant_id' && entity.required));
  assert.strictEqual(schema.sqlExecuted, false);
  const rls = tenancy.TenantRLSPlanner.plan();
  assert.strictEqual(rls.enabledForEveryTenantTable, true);
  assert.strictEqual(rls.bypassAllowedFromFrontend, false);
  assert.strictEqual(rls.executed, false);
  const security = tenancy.TenantSecurityValidator.validate(schema, rls);
  assert.strictEqual(security.valid, true);
  assert.strictEqual(security.connectionAttempted, false);
  const health = tenancy.MultiTenantHealthChecker.check();
  assert.strictEqual(health.ready, true);
  assert.strictEqual(health.score, 100);

  const files = [
    'TenantManager.js','TenantResolver.js','TenantContext.js','TenantConfiguration.js','TenantValidator.js',
    'CustomerWorkspace.js','WorkspaceSwitcherPreview.js','TenantProvisionPreview.js','MultiTenantHealthChecker.js',
    'TenantSchemaPlanner.js','TenantRLSPlanner.js','TenantSecurityValidator.js','tenancy.test.js','README.md'
  ];
  files.forEach(file => assert.ok(fs.existsSync(path.join(__dirname, file)), `Missing ${file}`));

  const production = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && name !== 'tenancy.test.js');
  const source = production.map(name => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n');
  assert.strictEqual(/localStorage\s*\.|sessionStorage\s*\.|document\s*\.\s*cookie|createClient\s*\(|fetch\s*\(|XMLHttpRequest|WebSocket|\.from\s*\(|\.rpc\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.post\s*\(|saveDB|ghPush/i.test(source), false);

  const html = fs.readFileSync(path.join(projectRoot, 'DigiTronics_v5.html'), 'utf8');
  const pages = ['tenant-center','current-workspace','workspace-preview','customer-provisioning-preview','multi-tenant-health','supabase-setup-preview','schema-installer-preview','rls-preview','edge-function-setup-plan'];
  pages.forEach(page => {
    assert.ok(html.includes(`data-page="${page}"`));
    assert.ok(html.includes(`id="page-${page}"`));
    assert.ok(html.includes(`renderTenantPreviewPage('${page}')`));
  });
  const uiSource = fs.readFileSync(path.join(__dirname, 'tenancyUi.js'), 'utf8');
  assert.ok(uiSource.includes('Preview Only — SQL is not executed from the browser.'));
  assert.ok(uiSource.includes('Never put Supabase service_role key inside frontend code.'));
  return { tests: 36, multiTenantReadinessScore: health.score, mockTenants: tenancy.TenantManager.list().length, liveTenantsCreated: 0 };
}

if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { run };
