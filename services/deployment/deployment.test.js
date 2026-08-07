const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..');
const sandbox = vm.createContext({ console, globalThis: {} });
sandbox.window = sandbox.globalThis;
[
  'DeploymentValidator.js','CustomerProvisionEngine.js','SchemaDeploymentEngine.js','RLSPolicyInstaller.js',
  'TenantBootstrapper.js','DefaultDataSeeder.js','EdgeFunctionClient.js','SupabaseInstaller.js',
  'DeploymentRollbackPlanner.js','DeploymentReportBuilder.js','DeploymentEngine.js'
].forEach(file => new vm.Script(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file }).runInContext(sandbox));
const deployment = sandbox.globalThis.OmniDeployment;

function run() {
  const input = {
    customerName: 'Ahmed Owner',
    businessName: 'Cairo Store',
    email: 'owner@cairo.example',
    password: 'Strong#250',
    country: 'Egypt',
    currency: 'egp',
    timezone: 'Africa/Cairo'
  };
  const admin = { authenticated: true, role: 'admin' };
  assert.ok(deployment.DeploymentEngine);
  assert.ok(deployment.CustomerProvisionEngine);
  assert.ok(deployment.SupabaseInstaller);
  assert.ok(deployment.EdgeFunctionClient);

  const customer = deployment.CustomerProvisionEngine.plan(input);
  assert.strictEqual(customer.valid, true);
  assert.strictEqual(customer.customer.customerName, 'Ahmed Owner');
  assert.strictEqual(customer.customer.currency, 'EGP');
  assert.strictEqual(customer.customer.passwordProvided, true);
  assert.strictEqual(customer.passwordRetained, false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(customer.customer, 'password'), false);
  assert.strictEqual(customer.userCreated, false);
  assert.strictEqual(customer.tenantCreated, false);

  assert.strictEqual(deployment.DeploymentValidator.validateAdmin(admin).valid, true);
  assert.strictEqual(deployment.DeploymentValidator.validateAdmin({ authenticated: false, role: 'admin' }).valid, false);
  assert.strictEqual(deployment.DeploymentValidator.validateAdmin({ authenticated: true, role: 'cashier' }).valid, false);
  assert.strictEqual(deployment.DeploymentValidator.validateCustomer({}).valid, false);
  assert.strictEqual(deployment.DeploymentValidator.validateCustomer({ ...input, email: 'bad' }).valid, false);
  assert.strictEqual(deployment.DeploymentValidator.validateCustomer({ ...input, password: 'short' }).valid, false);

  const prepared = deployment.DeploymentEngine.prepare(input, admin);
  assert.strictEqual(prepared.valid, true);
  assert.strictEqual(prepared.mode, 'simulation-only');
  assert.strictEqual(prepared.realDeploymentEnabled, false);
  assert.strictEqual(prepared.packagePreview.generated, true);
  assert.strictEqual(prepared.packagePreview.executableInBrowser, false);
  assert.strictEqual(prepared.packagePreview.packagePersisted, false);
  assert.strictEqual(prepared.packagePreview.executionTarget, 'authenticated-admin-edge-function');

  const schema = prepared.packagePreview.schema;
  assert.strictEqual(schema.executionBoundary, 'edge-function-only');
  assert.strictEqual(schema.browserSqlAvailable, false);
  assert.strictEqual(schema.executableNow, false);
  assert.strictEqual(schema.sqlExecuted, false);
  assert.strictEqual(schema.drafts.length, 12);
  const rls = prepared.packagePreview.rls;
  assert.strictEqual(rls.installer, 'edge-function');
  assert.strictEqual(rls.isolationColumn, 'tenant_id');
  assert.strictEqual(rls.installed, false);
  assert.strictEqual(rls.sqlExecuted, false);

  const components = prepared.packagePreview.bootstrap.components.map(item => item.name);
  [
    'Tenant','Business Profile','Default Roles','Owner User','Default Permissions','Chart Of Accounts',
    'Taxes','Currencies','Branches','POS Settings','Inventory Settings','Accounting Settings',
    'Printing Settings','System Settings','Default Categories','Default Warehouse','Default Cashbox','Default Theme'
  ].forEach(name => assert.ok(components.includes(name), `Missing ${name}`));
  assert.strictEqual(prepared.packagePreview.bootstrap.bootstrapped, false);
  assert.strictEqual(prepared.packagePreview.bootstrap.writesPerformed, false);
  assert.strictEqual(prepared.packagePreview.seed.seeded, false);
  assert.strictEqual(prepared.packagePreview.seed.recordsCreated, 0);

  const request = prepared.request;
  assert.strictEqual(request.valid, true);
  assert.strictEqual(request.destination, 'EDGE_FUNCTION_URL');
  assert.strictEqual(request.authenticatedAdminRequired, true);
  assert.strictEqual(request.privilegedCredentialLocation, 'edge-function-server-secret');
  assert.strictEqual(request.browserReceivesPrivilegedCredential, false);
  assert.strictEqual(request.sent, false);
  assert.strictEqual(deployment.EdgeFunctionClient.readiness({}).configured, false);
  assert.strictEqual(deployment.EdgeFunctionClient.readiness({}).realInvocationEnabled, false);
  assert.deepStrictEqual(Array.from(deployment.EdgeFunctionClient.CONFIGURATION_KEYS), ['SUPABASE_URL','SUPABASE_ANON_KEY','EDGE_FUNCTION_URL']);

  const result = deployment.DeploymentEngine.simulate(input, admin);
  assert.strictEqual(result.simulation.acceptedForSimulation, true);
  assert.strictEqual(result.simulation.edgeFunctionCalled, false);
  assert.strictEqual(result.simulation.apiCalled, false);
  assert.strictEqual(result.simulation.sqlExecuted, false);
  assert.strictEqual(result.simulation.databaseModified, false);
  assert.strictEqual(result.simulation.customerCreated, false);
  assert.strictEqual(result.simulation.simulationOnly, true);
  assert.strictEqual(result.report.readinessScore, 100);
  assert.strictEqual(result.report.connectionMade, false);
  assert.strictEqual(result.rollback.rollbackExecuted, false);
  assert.strictEqual(result.rollback.databaseModified, false);
  assert.strictEqual(deployment.DeploymentEngine.health().score, 100);

  const required = [
    'DeploymentEngine.js','CustomerProvisionEngine.js','SupabaseInstaller.js','EdgeFunctionClient.js',
    'SchemaDeploymentEngine.js','RLSPolicyInstaller.js','TenantBootstrapper.js','DefaultDataSeeder.js',
    'DeploymentValidator.js','DeploymentReportBuilder.js','DeploymentRollbackPlanner.js',
    'deployment.test.js','README.md'
  ];
  required.forEach(file => assert.ok(fs.existsSync(path.join(__dirname, file)), `Missing ${file}`));

  const production = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && name !== 'deployment.test.js');
  const source = production.map(name => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n');
  assert.strictEqual(/localStorage\s*\.|sessionStorage\s*\.|document\s*\.\s*cookie|createClient\s*\(|fetch\s*\(|XMLHttpRequest|WebSocket|\.from\s*\(|\.rpc\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.post\s*\(|saveDB|ghPush/i.test(source), false);
  assert.strictEqual(/https?:\/\/[a-z0-9.-]*supabase/i.test(source), false);
  assert.strictEqual(/(?:service_role|SUPABASE_SERVICE)[A-Z0-9_]*\s*[:=]\s*['"][^'"]+['"]/i.test(source), false);
  assert.strictEqual(/execute\s*\(\s*(?:sql|query)|query\s*\(\s*['"`]\s*(?:create|insert|update|delete|alter|drop)/i.test(source), false);

  const html = fs.readFileSync(path.join(projectRoot, 'DigiTronics_v5.html'), 'utf8');
  const pages = ['deployment-center','customer-deployment-wizard','deployment-status','deployment-logs','deployment-rollback','deployment-health'];
  pages.forEach(page => {
    assert.ok(html.includes(`data-page="${page}"`), `Missing nav ${page}`);
    assert.ok(html.includes(`id="page-${page}"`), `Missing page ${page}`);
    assert.ok(html.includes(`renderDeploymentPage('${page}')`), `Missing render ${page}`);
    assert.ok(html.includes(`'${page}': 'manageUsers'`), `Missing admin permission ${page}`);
  });
  const uiSource = fs.readFileSync(path.join(__dirname, 'deploymentUi.js'), 'utf8');
  ['Validate Deployment','Generate Deployment Package','Preview SQL','Deploy Customer','Rollback Deployment'].forEach(label => assert.ok(uiSource.includes(label), `Missing ${label}`));
  ['Customer Name','Business Name','Email','Password','Country','Currency','Timezone'].forEach(label => assert.ok(uiSource.includes(label), `Missing ${label}`));
  assert.ok(uiSource.includes("if (passwordInput) passwordInput.value = '';"));
  assert.ok(uiSource.includes('simulationOnly: true'));
  assert.ok(uiSource.includes('customerCreated: false'));

  const sw = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
  assert.ok(/omnistore-erp-v\d+-[a-z0-9-]+/.test(sw));
  assert.ok(sw.includes('./services/deployment/DeploymentEngine.js'));
  return { tests: 52, deploymentReadinessScore: result.report.readinessScore, bootstrapComponents: components.length, realDeployments: 0, customersCreated: 0 };
}

if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { run };
