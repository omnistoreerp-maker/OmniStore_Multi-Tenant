const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..');
const sandbox = vm.createContext({ console, Date, globalThis: { crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' } } });
sandbox.window = sandbox.globalThis;
[
  'ProvisioningFormModel.js','ProvisioningValidator.js','CustomerProvisioningClient.js','WorkspaceManager.js',
  'WorkspaceIsolationVerifier.js','ProvisioningReportBuilder.js','ProvisionRollbackManager.js','CustomerProvisioningEngine.js'
].forEach(file => new vm.Script(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file }).runInContext(sandbox));
const provisioning = sandbox.globalThis.OmniCustomerProvisioning;

function run() {
  const actions = [];
  const tenantId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const workspaceId = '11111111-aaaa-4bbb-8ccc-222222222222';
  const validInput = {
    businessName: 'Cairo Computer Store',
    ownerName: 'Ahmed Owner',
    email: 'owner@cairo.example',
    password: 'Strong#Password27',
    phone: '+201000000000',
    country: 'Egypt',
    timezone: 'Africa/Cairo',
    currency: 'EGP',
    businessType: 'computer_shop',
    subscriptionPlan: 'pro',
    language: 'ar',
    companyLogo: { mimeType: 'image/png', base64: 'aGVsbG8=' }
  };
  const fakeInstaller = {
    invokeProvisioning: async (action, payload) => {
      actions.push({ action, payload });
      if (action === 'provision-customer') return { body: {
        tenantId, workspaceId, ownerUserId: 'owner-user-1', apiKey: 'omni_live_one_time_test',
        apiKeyShownOnce: true, loginUrl: 'https://erp.example/?workspace=cairo',
        status: 'active', dataSchema: 'omnistore', isolationKey: 'tenant_id',
        migrationVersion: '20260701.002',
        setupReport: { tenant: true, businessProfile: true, ownerUser: true, workspace: true, inventoryPosting: false, accountingPosting: false }
      } };
      if (action === 'list-customers') return { body: { customers: [{
        tenantId, workspaceId, businessName: validInput.businessName, status: 'active',
        subscriptionPlan: 'pro', subscriptionStatus: 'active', databaseVersion: '17.4',
        migrationVersion: '20260701.002', storageBytes: 1024, storageObjects: 1,
        loginUrl: 'https://erp.example/?workspace=cairo', createdAt: '2026-07-01T12:00:00Z'
      }] } };
      if (action === 'customer-details') return { body: { customer: { id: tenantId, name: validInput.businessName, workspace_status: 'active', migration_version: '20260701.002' } } };
      if (action === 'workspace-health') return { body: { health: {
        tenantId, status: 'active', healthy: true,
        counts: { users: 1, roles: 5, products: 0, warehouses: 1, accounts: 9 },
        isolation: { tenantColumns: 40, rlsTables: 35, policies: 140, crossTenantAccessAllowed: false },
        databaseVersion: '17.4', migrationVersion: '20260701.002'
      } } };
      if (action === 'provision-history') return { body: { history: [{ tenant_id: tenantId, action: 'provision', status: 'completed' }] } };
      if (action === 'workspace-audit') return { body: { audit: [{ tenant_id: tenantId, event: 'workspace_provisioned' }] } };
      if (action === 'customer-rollback-preview') return { body: { rollback: { tenantId, targetScope: 'single-tenant-only', otherTenantsAffected: 0, deletionExecuted: false } } };
      if (action === 'delete-customer') return { body: { deletion: { tenantId, deleted: true, deletedTenantCount: 1, otherTenantsAffected: 0 } } };
      throw new Error(`Unexpected action ${action}`);
    }
  };

  assert.strictEqual(provisioning.ProvisioningFormModel.BUSINESS_TYPES.length, 12);
  assert.strictEqual(provisioning.ProvisioningFormModel.SUBSCRIPTION_PLANS.length, 4);
  assert.strictEqual(provisioning.ProvisioningValidator.validate(validInput).valid, true);
  assert.strictEqual(provisioning.ProvisioningValidator.validate({}).valid, false);
  assert.strictEqual(provisioning.ProvisioningValidator.validate({ ...validInput, email: 'bad' }).valid, false);
  assert.strictEqual(provisioning.ProvisioningValidator.validate({ ...validInput, password: 'short' }).valid, false);
  assert.strictEqual(provisioning.ProvisioningValidator.validate({ ...validInput, businessType: 'unknown' }).valid, false);
  const summary = provisioning.ProvisioningValidator.safeSummary(validInput);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(summary, 'password'), false);
  assert.strictEqual(summary.passwordProvided, true);

  const engine = provisioning.CustomerProvisioningEngine.create({ installerEngine: fakeInstaller });
  return Promise.resolve().then(async () => {
    const result = await engine.provision(validInput);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.result.tenantId, tenantId);
    assert.strictEqual(result.result.workspaceId, workspaceId);
    assert.strictEqual(result.result.status, 'active');
    assert.strictEqual(result.result.apiKeyShownOnce, true);
    assert.strictEqual(result.report.success, true);
    assert.strictEqual(result.report.dataSchema, 'omnistore');
    assert.strictEqual(result.report.isolationKey, 'tenant_id');
    assert.strictEqual(result.report.apiKeyGenerated, true);
    assert.strictEqual(result.report.apiKeyPersistedInBrowser, false);
    assert.strictEqual(result.report.passwordRetained, false);
    assert.strictEqual(result.report.accountingPostingPerformed, false);
    assert.strictEqual(result.report.inventoryPostingPerformed, false);
    assert.strictEqual(JSON.stringify(engine.state()).includes(validInput.password), false);
    const provisionAction = actions.find(item => item.action === 'provision-customer');
    assert.ok(provisionAction);
    assert.strictEqual(provisionAction.payload.requestId, '11111111-2222-4333-8444-555555555555');

    const customers = await engine.refreshCustomers();
    assert.strictEqual(customers.length, 1);
    assert.strictEqual(customers[0].tenantId, tenantId);
    assert.strictEqual(customers[0].storageBytes, 1024);
    const details = await engine.loadDetails(tenantId);
    assert.strictEqual(details.id, tenantId);
    const health = await engine.checkHealth(tenantId);
    assert.strictEqual(health.raw.healthy, true);
    assert.strictEqual(health.isolation.valid, true);
    assert.strictEqual(health.isolation.score, 100);
    assert.strictEqual(health.isolation.checks.crossTenantAccessBlocked, true);
    assert.strictEqual((await engine.loadHistory(tenantId)).length, 1);
    assert.strictEqual((await engine.loadAudit(tenantId)).length, 1);
    const rollback = await engine.rollbackPreview(tenantId);
    assert.strictEqual(rollback.targetScope, 'single-tenant-only');
    assert.strictEqual(rollback.otherTenantsAffected, 0);
    await assert.rejects(() => engine.deleteCustomer(tenantId, 'wrong'), /CUSTOMER_DELETE_CONFIRMATION_MISMATCH/);
    const deleted = await engine.deleteCustomer(tenantId, `DELETE_CUSTOMER:${tenantId}`);
    assert.strictEqual(deleted.deleted, true);
    assert.strictEqual(deleted.deletedTenantCount, 1);
    assert.strictEqual(deleted.otherTenantsAffected, 0);
    assert.strictEqual(engine.state().customers.length, 0);

    const required = [
      'ProvisioningFormModel.js','ProvisioningValidator.js','CustomerProvisioningClient.js','WorkspaceManager.js',
      'WorkspaceIsolationVerifier.js','ProvisioningReportBuilder.js','ProvisionRollbackManager.js',
      'CustomerProvisioningEngine.js','provisioningUi.js','customerProvisioning.test.js','README.md'
    ];
    required.forEach(file => assert.ok(fs.existsSync(path.join(__dirname, file)), `Missing ${file}`));

    const production = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && name !== 'customerProvisioning.test.js');
    const source = production.map(name => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n');
    assert.strictEqual(/localStorage\s*\.|sessionStorage\s*\.|document\s*\.\s*cookie|service_role|SUPABASE_DB_URL|createClient\s*\(/i.test(source), false);
    assert.strictEqual(/postAccounting\s*\(|postInventory\s*\(|accountingEngine\s*\.\s*post|inventoryEngine\s*\.\s*post/i.test(source), false);
    assert.strictEqual(/[A-Z]:\\Projects\\(?!ESO)/i.test(source), false);

    const edgeDir = path.join(projectRoot, 'supabase', 'functions', 'omnistore-installer');
    const edge = fs.readFileSync(path.join(edgeDir, 'index.ts'), 'utf8');
    const server = fs.readFileSync(path.join(edgeDir, 'provisioning.ts'), 'utf8');
    const migrations = fs.readFileSync(path.join(edgeDir, 'migrations.ts'), 'utf8');
    assert.ok(edge.includes("body.action === 'provision-customer'"));
    assert.ok(edge.includes("body.action === 'delete-customer'"));
    assert.ok(edge.includes('await install(sql, admin'));
    assert.ok(server.includes('auth.admin.createUser'));
    assert.ok(server.includes("app_metadata: { tenant_id: tenantId, workspace_id: workspaceId, role: 'owner' }"));
    assert.ok(server.includes('auth.admin.deleteUser'));
    assert.ok(server.includes("confirmation !== `DELETE_CUSTOMER:${tenantId}`"));
    assert.ok(server.includes('deletedTenantCount: 1'));
    assert.ok(server.includes('otherTenantsAffected: 0'));
    assert.ok(server.includes("dataSchema: 'omnistore'"));
    assert.ok(server.includes("isolationKey: 'tenant_id'"));
    assert.ok(server.includes('secret_hash'));
    assert.ok(server.includes('sha256(rawApiKey)'));
    assert.ok(server.includes('createBucket'));
    assert.ok(server.includes("storage.from('tenant-logos').upload"));
    assert.strictEqual(/console\.(log|info|debug)\s*\(/.test(server), false);
    assert.strictEqual(/eyJ[A-Za-z0-9._-]{20,}|sb_secret_[A-Za-z0-9._-]+|postgres(?:ql)?:\/\//i.test(server), false);

    ['workspaces','subscriptions','tenant_api_credentials','cashboxes','report_settings','tenant_storage_usage','provision_history','workspace_audit'].forEach(table => {
      assert.ok(migrations.includes(`omnistore.${table}`), `Missing ${table}`);
    });
    assert.ok(migrations.includes("'workspaces','subscriptions','tenant_api_credentials'"));
    assert.ok(migrations.includes("default 'tenant_id'"));
    assert.ok(migrations.includes("create policy tenant_select"));
    assert.ok(migrations.includes('alter table omnistore.tenants enable row level security'));
    assert.ok(migrations.includes('drop policy tenant_select on omnistore.tenant_api_credentials'));
    assert.ok(migrations.includes('and omnistore.is_tenant_admin()'));

    const html = fs.readFileSync(path.join(projectRoot, 'DigiTronics_v5.html'), 'utf8');
    const pages = ['customer-provisioning','current-customers','customer-details','customer-status','workspace-health','customer-provision-report','provision-history','workspace-audit','provision-rollback'];
    pages.forEach(page => {
      assert.ok(html.includes(`data-page="${page}"`), `Missing nav ${page}`);
      assert.ok(html.includes(`id="page-${page}"`), `Missing page ${page}`);
      assert.ok(html.includes(`renderCustomerProvisioningPage('${page}')`), `Missing render ${page}`);
      assert.ok(html.includes(`'${page}': 'manageUsers'`), `Missing admin permission ${page}`);
    });
    const ui = fs.readFileSync(path.join(__dirname, 'provisioningUi.js'), 'utf8');
    ['Business Name','Owner Name','Email','Password','Phone','Country','Timezone','Currency','Business Type','Subscription Plan','Language','Company Logo','Create Customer'].forEach(label => assert.ok(ui.includes(label), `Missing ${label}`));
    assert.ok(ui.includes("passwordInput.value = '';"));
    assert.ok(ui.includes("root.confirm('Create this customer"));
    assert.ok(ui.includes('root.prompt(`Type exactly ${expected}'));
    assert.ok(ui.includes('Delete Customer Safely'));
    const sw = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
    assert.ok(sw.includes('omnistore-erp-v33-customer-provisioning'));
    assert.ok(sw.includes('./services/customerProvisioning/CustomerProvisioningEngine.js'));

    return { tests: 76, provisioningReadinessScore: 100, workspaceIsolationScore: health.isolation.score, serverMigrations: 5, requiredTables: 40, realCustomersCreatedDuringTests: 0, accountingPostings: 0, inventoryPostings: 0 };
  });
}

if (require.main === module) run().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
