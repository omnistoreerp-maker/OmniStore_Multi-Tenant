const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..');
const sandbox = vm.createContext({ console, globalThis: {} });
sandbox.window = sandbox.globalThis;
[
  'SupabaseSchemaBuilder.js','SupabaseRLSBuilder.js','SupabaseTenantTablePlanner.js',
  'SupabaseEdgeFunctionPlanner.js','SupabaseSetupValidator.js','SupabaseSetupPlanner.js',
  'SupabaseSetupReportBuilder.js'
].forEach(file => new vm.Script(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file }).runInContext(sandbox));
const setup = sandbox.globalThis.OmniSupabaseSetupPreview;

function run() {
  assert.ok(setup.SupabaseSetupPlanner);
  assert.ok(setup.SupabaseSchemaBuilder);
  assert.ok(setup.SupabaseRLSBuilder);
  const plan = setup.SupabaseSetupPlanner.createPlan();
  assert.strictEqual(plan.mode, 'preview-only');
  assert.strictEqual(plan.providerConnected, false);
  assert.strictEqual(plan.apiCalled, false);
  assert.strictEqual(plan.sqlExecuted, false);
  assert.strictEqual(plan.databaseWritten, false);
  assert.ok(plan.schema.tables.length >= 10);
  assert.ok(plan.schema.tables.filter(table => table.tenantScoped).every(table => table.tenantColumn === 'tenant_id'));
  assert.strictEqual(plan.schema.executable, false);
  assert.strictEqual(plan.schema.executed, false);
  assert.strictEqual(plan.rls.executable, false);
  assert.strictEqual(plan.rls.executed, false);
  assert.strictEqual(plan.rls.policies.length, plan.schema.tables.filter(table => table.tenantScoped).length);
  assert.ok(plan.rls.policies.every(policy => policy.tenantColumn === 'tenant_id'));
  assert.strictEqual(plan.edgeFunction.secretLocation, 'server-environment-only');
  assert.strictEqual(plan.edgeFunction.callableNow, false);
  assert.strictEqual(plan.edgeFunction.apiCalled, false);
  assert.strictEqual(plan.edgeFunction.sqlExecuted, false);
  assert.strictEqual(plan.validation.valid, true);
  assert.strictEqual(plan.validation.score, 100);

  const report = setup.SupabaseSetupReportBuilder.build(plan);
  assert.strictEqual(report.readinessScore, 100);
  assert.strictEqual(report.connectionMade, false);
  assert.strictEqual(report.apiCalled, false);
  assert.strictEqual(report.sqlExecuted, false);
  assert.ok(report.warnings.some(item => item.includes('SQL is not executed')));
  assert.ok(report.warnings.some(item => item.includes('service_role')));

  const requiredFiles = [
    'SupabaseSetupPlanner.js','SupabaseSchemaBuilder.js','SupabaseRLSBuilder.js','SupabaseTenantTablePlanner.js',
    'SupabaseEdgeFunctionPlanner.js','SupabaseSetupValidator.js','SupabaseSetupReportBuilder.js','supabaseSetup.test.js','README.md'
  ];
  requiredFiles.forEach(file => assert.ok(fs.existsSync(path.join(__dirname, file)), `Missing ${file}`));

  const sqlDir = path.join(projectRoot, 'database', 'supabasePreview');
  const sqlFiles = [
    '001_core_tenants.sql','002_auth_profiles.sql','003_customer_workspaces.sql','004_products_multi_tenant.sql',
    '005_sales_multi_tenant.sql','006_purchases_multi_tenant.sql','007_inventory_multi_tenant.sql',
    '008_accounting_multi_tenant.sql','009_reports_multi_tenant.sql','010_rls_policies_multi_tenant.sql',
    '011_indexes_multi_tenant.sql','012_seed_demo_tenant.sql','rollback_multi_tenant_preview.sql'
  ];
  sqlFiles.forEach(file => assert.ok(fs.existsSync(path.join(sqlDir, file)), `Missing ${file}`));
  const schemaDrafts = sqlFiles.slice(0, 9).map(file => fs.readFileSync(path.join(sqlDir, file), 'utf8'));
  schemaDrafts.forEach((source, index) => {
    assert.ok(/DRAFT ONLY/i.test(source), `Draft warning missing at ${index}`);
    if (index > 0) assert.ok(/tenant_id/i.test(source), `tenant_id missing at ${index}`);
  });
  const rlsDraft = fs.readFileSync(path.join(sqlDir, '010_rls_policies_multi_tenant.sql'), 'utf8');
  assert.ok(/enable row level security/i.test(rlsDraft));
  assert.ok(/tenant_id/i.test(rlsDraft));
  const rollback = fs.readFileSync(path.join(sqlDir, 'rollback_multi_tenant_preview.sql'), 'utf8');
  assert.ok(/drop table if exists public\.tenants/i.test(rollback));

  const production = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && name !== 'supabaseSetup.test.js');
  const source = production.map(name => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n');
  assert.strictEqual(/createClient\s*\(|fetch\s*\(|XMLHttpRequest|WebSocket|localStorage\s*\.|sessionStorage\s*\.|\.from\s*\(|\.rpc\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.post\s*\(/i.test(source), false);
  assert.strictEqual(/https?:\/\/[a-z0-9.-]*supabase/i.test(source), false);
  assert.strictEqual(/(?:service_role|SUPABASE_SERVICE)[A-Z0-9_]*\s*[:=]\s*['"][^'"]+['"]/i.test(source), false);

  const html = fs.readFileSync(path.join(projectRoot, 'DigiTronics_v5.html'), 'utf8');
  [
    'Setup Supabase Tables — Preview Only','Generate SQL Preview','Validate Tenant Schema',
    'Preview Customer Workspace','Preview RLS Policies','Preview Edge Function Installer'
  ].forEach(label => assert.ok(html.includes(label) || fs.readFileSync(path.join(projectRoot, 'services', 'tenancy', 'tenancyUi.js'), 'utf8').includes(label), `Missing ${label}`));
  return { tests: 34, supabaseSetupReadinessScore: report.readinessScore, sqlDrafts: sqlFiles.length, sqlExecuted: 0, connections: 0 };
}

if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { run };
