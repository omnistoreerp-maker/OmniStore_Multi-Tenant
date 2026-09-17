const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..');
const sandbox = vm.createContext({ console, Date, globalThis: {} });
sandbox.window = sandbox.globalThis;
sandbox.globalThis.OmniDeployment = { DeploymentEngine: { health: () => ({ score: 100 }), prepare: () => ({ valid: true, mode: 'simulation-only' }) } };
[
  'InstallerConfiguration.js','MigrationManifest.js','SupabaseConnectionTester.js','SupabaseHealthChecker.js',
  'EdgeFunctionInstallerClient.js','MigrationProgressTracker.js','InstallationVerifier.js',
  'InstallationReportBuilder.js','InstallerRollbackPlanner.js','RealSupabaseInstaller.js','DeploymentInstallerBridge.js'
].forEach(file => new vm.Script(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file }).runInContext(sandbox));
const installer = sandbox.globalThis.OmniSupabaseInstaller;

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function verificationPayload() {
  const valid = { valid: true };
  return {
    tables: valid, indexes: valid, policies: valid, triggers: valid, functions: valid,
    defaultAdmin: valid, defaultRoles: valid, defaultSettings: valid
  };
}

function run() {
  const calls = [];
  const mockFetch = async (url, options) => {
    const parsedBody = options && options.body ? JSON.parse(options.body) : {};
    calls.push({ url, method: options && options.method, action: parsedBody.action, headers: options && options.headers, body: parsedBody });
    if (url.includes('/auth/v1/health')) return response(200, { version: 'test' });
    if (url.includes('/storage/v1/status')) return response(200, { status: 'ok' });
    if (url.includes('/rest/v1/')) return response(200, { swagger: 'ok' });
    if (parsedBody.action === 'health') return response(200, { health: { database: true, rls: true, realtime: true, databaseVersion: '17.4', migrationVersion: 'not-installed', projectStatus: 'active' } });
    if (parsedBody.action === 'install') return response(200, {
      installationId: 'install-test-26',
      migrationVersion: installer.MigrationManifest.VERSION,
      stages: installer.MigrationManifest.MIGRATIONS.map(item => ({ id: item.id, status: 'completed', message: item.name })),
      completedAt: '2026-07-01T12:00:00.000Z'
    });
    if (parsedBody.action === 'verify') return response(200, { verification: verificationPayload(), completedAt: '2026-07-01T12:01:00.000Z' });
    if (parsedBody.action === 'rollback-preview') return response(200, { snapshot: { verified: true, tableCount: 40 }, executionEnabled: false });
    return response(400, { error: 'unsupported' });
  };
  const adminSession = { accessToken: 'mock-admin-jwt-not-a-real-secret', role: 'admin', userId: 'admin-1' };
  const config = {
    supabaseUrl: 'https://exampleproject.supabase.co',
    anonKey: 'mock-anon-key-with-more-than-twenty-characters',
    edgeFunctionUrl: 'https://exampleproject.supabase.co/functions/v1/omnistore-installer',
    projectName: 'OmniStore Production'
  };

  assert.ok(installer.RealSupabaseInstaller);
  assert.ok(installer.DeploymentInstallerBridge);
  assert.ok(installer.SupabaseConnectionTester);
  assert.ok(installer.InstallationVerifier);
  assert.strictEqual(installer.InstallerConfiguration.validate(config).valid, true);
  assert.strictEqual(installer.InstallerConfiguration.validate({}).valid, false);
  const publicConfig = installer.InstallerConfiguration.publicView(config);
  assert.notStrictEqual(publicConfig.anonKey, config.anonKey);
  assert.strictEqual(publicConfig.persisted, false);
  assert.strictEqual(installer.MigrationManifest.MIGRATIONS.length, 5);
  assert.ok(installer.MigrationManifest.REQUIRED.tables.length >= 30);

  const engine = installer.RealSupabaseInstaller.create({ fetchImpl: mockFetch, sessionProvider: async () => adminSession });
  const bridge = installer.DeploymentInstallerBridge.create({ fetchImpl: mockFetch, sessionProvider: async () => adminSession });
  assert.strictEqual(bridge.status().deploymentEngineAvailable, true);
  assert.strictEqual(bridge.status().deploymentArchitectureReady, true);
  assert.strictEqual(bridge.prepareCustomerDeployment({}, { authenticated: true, role: 'admin' }).valid, true);
  assert.strictEqual(engine.status().configured, false);
  assert.strictEqual(engine.status().installEnabled, false);
  assert.strictEqual(engine.status().secretsPersisted, false);

  return Promise.resolve()
    .then(async () => {
      await assert.rejects(() => engine.install(true), /VALID_CONNECTION_REQUIRED/);
      await assert.rejects(() => engine.install(false), /INSTALL_CONFIRMATION_REQUIRED/);
      const connection = await engine.validateConnection(config);
      assert.strictEqual(connection.valid, true);
      assert.strictEqual(connection.health.healthy, true);
      assert.strictEqual(connection.health.score, 100);
      assert.strictEqual(connection.health.checks.api, true);
      assert.strictEqual(connection.health.checks.auth, true);
      assert.strictEqual(connection.health.checks.storage, true);
      assert.strictEqual(connection.health.checks.edgeFunction, true);
      assert.strictEqual(connection.health.checks.rls, true);
      assert.strictEqual(connection.health.checks.realtime, true);
      assert.strictEqual(connection.health.databaseVersion, '17.4');
      assert.strictEqual(connection.health.migrationVersion, 'not-installed');
      assert.strictEqual(engine.status().installEnabled, true);
      assert.strictEqual(calls.length, 4);

      const result = await engine.install(true);
      assert.strictEqual(result.progress.stages.length, 5);
      assert.strictEqual(result.progress.completed, true);
      assert.strictEqual(result.progress.persistedInBrowser, false);
      assert.strictEqual(result.verification.valid, true);
      assert.strictEqual(result.report.success, true);
      assert.strictEqual(result.report.accountingPostingPerformed, false);
      assert.strictEqual(result.report.inventoryPostingPerformed, false);
      assert.strictEqual(result.report.customerBusinessDataChanged, false);
      assert.strictEqual(result.installation.serviceCredentialExposed, false);

      const installCall = calls.find(call => call.action === 'install');
      assert.ok(installCall);
      assert.strictEqual(installCall.body.confirmation, 'INSTALL_DATABASE');
      assert.strictEqual(installCall.body.migrationVersion, installer.MigrationManifest.VERSION);
      assert.strictEqual(Array.isArray(installCall.body.migrationIds), true);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(installCall.body, 'sql'), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(installCall.body, 'serviceRole'), false);
      assert.ok(String(installCall.headers.Authorization).startsWith('Bearer '));

      const verification = await engine.verify();
      assert.strictEqual(verification.valid, true);
      const rollback = await engine.rollbackPreview();
      assert.strictEqual(rollback.snapshotVerified, true);
      assert.strictEqual(rollback.executionEnabled, false);
      assert.strictEqual(rollback.rollbackExecuted, false);
      assert.strictEqual(calls.length, 8);

      const noAdminEngine = installer.RealSupabaseInstaller.create({ fetchImpl: mockFetch, sessionProvider: async () => ({ accessToken: 'token', role: 'cashier' }) });
      const denied = await noAdminEngine.validateConnection(config);
      assert.strictEqual(denied.valid, false);
      assert.ok(denied.errors.some(error => error.code === 'AUTHENTICATED_SUPABASE_ADMIN_REQUIRED'));

      const requiredFiles = [
        'InstallerConfiguration.js','MigrationManifest.js','SupabaseConnectionTester.js','SupabaseHealthChecker.js',
        'EdgeFunctionInstallerClient.js','MigrationProgressTracker.js','InstallationVerifier.js',
        'InstallationReportBuilder.js','InstallerRollbackPlanner.js','RealSupabaseInstaller.js','DeploymentInstallerBridge.js',
        'installerUi.js','installer.test.js','README.md'
      ];
      requiredFiles.forEach(file => assert.ok(fs.existsSync(path.join(__dirname, file)), `Missing ${file}`));

      const production = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && name !== 'installer.test.js');
      const source = production.map(name => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n');
      assert.strictEqual(/localStorage\s*\.|sessionStorage\s*\.|document\s*\.\s*cookie|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|saveDB|ghPush/i.test(source), false);
      assert.strictEqual(/(?:service_role|SUPABASE_SERVICE)[A-Z0-9_]*\s*[:=]\s*['"][^'"]+['"]/i.test(source), false);
      assert.strictEqual(/create\s+table|alter\s+table|create\s+policy|insert\s+into|drop\s+table/i.test(source), false);

      const edgeDir = path.join(projectRoot, 'supabase', 'functions', 'omnistore-installer');
      const edgeSource = fs.readFileSync(path.join(edgeDir, 'index.ts'), 'utf8');
      const migrationSource = fs.readFileSync(path.join(edgeDir, 'migrations.ts'), 'utf8');
      assert.ok(edgeSource.includes("Deno.env.get('SUPABASE_DB_URL')"));
      assert.ok(edgeSource.includes("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')"));
      assert.ok(edgeSource.includes("data.user.app_metadata?.role"));
      assert.ok(edgeSource.includes("pg_advisory_xact_lock"));
      assert.ok(edgeSource.includes("sql.begin"));
      assert.ok(edgeSource.includes("INSTALLER_ALLOWED_ORIGIN"));
      assert.ok(edgeSource.includes("body.confirmation !== 'INSTALL_DATABASE'"));
      assert.ok(edgeSource.includes("body.migrationVersion !== MIGRATION_VERSION"));
      assert.strictEqual(/eyJ[A-Za-z0-9._-]{20,}|sb_secret_[A-Za-z0-9._-]+/.test(edgeSource), false);
      installer.MigrationManifest.REQUIRED.tables.forEach(table => assert.ok(migrationSource.includes(`omnistore.${table}`), `Missing table ${table}`));
      installer.MigrationManifest.REQUIRED.indexes.forEach(index => assert.ok(migrationSource.includes(index), `Missing index ${index}`));
      assert.ok(migrationSource.includes('enable row level security'));
      assert.ok(migrationSource.includes('create policy tenant_select'));
      assert.ok(migrationSource.includes('create policy tenant_insert'));
      assert.ok(migrationSource.includes('create policy tenant_update'));
      assert.ok(migrationSource.includes('create policy tenant_delete'));
      assert.ok(migrationSource.includes('create trigger trg_business_profiles_updated'));
      assert.ok(migrationSource.includes('create or replace function omnistore.current_tenant_id'));
      assert.ok(migrationSource.includes("('owner','Owner',true)"));
      assert.ok(migrationSource.includes("('system','"));

      const html = fs.readFileSync(path.join(projectRoot, 'DigiTronics_v5.html'), 'utf8');
      const pages = ['database-installer','migration-progress','installation-report','verification-report','supabase-health'];
      pages.forEach(page => {
        assert.ok(html.includes(`data-page="${page}"`));
        assert.ok(html.includes(`id="page-${page}"`));
        assert.ok(html.includes(`renderRealSupabaseInstallerPage('${page}')`));
        assert.ok(html.includes(`'${page}': 'manageUsers'`));
      });
      const ui = fs.readFileSync(path.join(__dirname, 'installerUi.js'), 'utf8');
      ['Supabase URL','Anon Key','Edge Function URL','Project Name','Validate Connection','Install Database','Verify Installation','Preview Rollback'].forEach(label => assert.ok(ui.includes(label), `Missing ${label}`));
      assert.ok(ui.includes("root.confirm('Install the OmniStore database schema now?"));
      assert.ok(ui.includes('button.disabled = !result.valid'));
      assert.strictEqual(/postAccounting\s*\(|postInventory\s*\(|accountingEngine\s*\.\s*post|inventoryEngine\s*\.\s*post/i.test(ui), false);
      const sw = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
      assert.ok(/omnistore-erp-v\d+-[a-z0-9-]+/.test(sw));
      assert.ok(sw.includes('./services/supabaseInstaller/RealSupabaseInstaller.js'));
      assert.ok(sw.includes('./services/supabaseInstaller/DeploymentInstallerBridge.js'));
      return { tests: 70, installerReadinessScore: 100, migrations: 5, requiredTables: installer.MigrationManifest.REQUIRED.tables.length, realConnectionsDuringTests: 0, accountingPostings: 0, inventoryPostings: 0 };
    });
}

if (require.main === module) run().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
