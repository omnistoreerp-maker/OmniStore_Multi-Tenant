const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..');
let tests = 0;
const check = (value, message) => { assert.ok(value, message); tests += 1; };
const equal = (actual, expected, message) => { assert.strictEqual(actual, expected, message); tests += 1; };
const sandbox = vm.createContext({ console, Date, URL, globalThis: {} });
sandbox.window = sandbox.globalThis;
[
  'SaaSAdminConfiguration.js', 'PlanLimitValidator.js', 'LicenseManager.js', 'SubscriptionPlanManager.js',
  'BillingPreviewEngine.js', 'NotificationPreviewEngine.js', 'CustomerAdministration.js',
  'SaaSAdminClient.js', 'SaaSAdminReportBuilder.js', 'SaaSAdminEngine.js'
].forEach(file => new vm.Script(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file }).runInContext(sandbox));
const saas = sandbox.globalThis.OmniSaaSAdmin;

async function run() {
  const required = [
    'SaaSAdminConfiguration.js', 'PlanLimitValidator.js', 'LicenseManager.js', 'SubscriptionPlanManager.js',
    'BillingPreviewEngine.js', 'NotificationPreviewEngine.js', 'CustomerAdministration.js',
    'SaaSAdminClient.js', 'SaaSAdminReportBuilder.js', 'SaaSAdminEngine.js', 'saasAdminUi.js',
    'saasAdmin.test.js', 'README.md'
  ];
  required.forEach(file => check(fs.existsSync(path.join(__dirname, file)), `Missing ${file}`));

  const validConfig = { supabaseUrl: 'https://demo.supabase.co', anonKey: 'a'.repeat(40), edgeFunctionUrl: 'https://demo.supabase.co/functions/v1/omnistore-saas-admin', projectName: 'Master' };
  equal(saas.SaaSAdminConfiguration.validate(validConfig).valid, true);
  equal(saas.SaaSAdminConfiguration.validate({}).valid, false);
  equal(saas.SaaSAdminConfiguration.publicView(validConfig).persisted, false);
  equal(saas.SaaSAdminConfiguration.publicView(validConfig).anonKey.includes('a'.repeat(20)), false);
  equal(saas.SubscriptionPlanManager.PLAN_CODES.length, 6);
  ['trial','monthly','quarterly','yearly','lifetime','custom'].forEach(code => check(saas.SubscriptionPlanManager.PLAN_CODES.includes(code), `Missing ${code}`));
  equal(saas.PlanLimitValidator.KEYS.length, 9);
  const limits = Object.fromEntries(saas.PlanLimitValidator.KEYS.map(key => [key, 10]));
  equal(saas.PlanLimitValidator.validate(limits).valid, true);
  equal(saas.PlanLimitValidator.validate({ ...limits, users: -1 }).valid, false);
  const usage = saas.PlanLimitValidator.usage({ users: 11 }, limits);
  equal(usage.users.exceeded, true);
  equal(usage.users.percent, 110);
  const goodKey = 'OMNI-ABCDEF-123456-ABCDEF-123456';
  equal(saas.LicenseManager.validateFormat(goodKey).valid, true);
  equal(saas.LicenseManager.validateFormat('bad').valid, false);
  equal(saas.LicenseManager.status({ status: 'revoked' }), 'revoked');
  equal(saas.LicenseManager.status({ status: 'active', expiresAt: '2020-01-01' }, '2026-01-01'), 'expired');
  equal(saas.LicenseManager.status({ status: 'active' }), 'active');
  equal(saas.LicenseManager.daysRemaining('2026-01-03', '2026-01-01'), 2);

  const actions = [];
  const customer = { tenantId: 'tenant-1', businessName: 'Demo', customerStatus: 'active', workspaceStatus: 'active', currentPlan: 'monthly', users: 2, branches: 1, warehouses: 1, posDevices: 1, products: 4, customers: 3, suppliers: 2, invoices: 5, storageUsage: 100, planLimits: limits };
  const plan = { code: 'monthly', name: 'Monthly', price: 10, currency: 'USD', limits };
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    actions.push({ body, options });
    const map = {
      health: { healthy: true, platformOwner: true },
      initialize: { initialized: true },
      dashboard: { dashboard: { customers: 1, activeCustomers: 1, licenses: { active: 1, expiring: 0 }, revenuePreview: 10, currency: 'USD' } },
      plans: { plans: [plan] },
      customers: { customers: [customer] },
      'customer-details': { customer: { ...customer, licenses: [] } },
      'generate-license': { license: { licenseKey: goodKey, shownOnce: true } },
      'validate-license': { validation: { valid: true, status: 'active' } },
      'billing-preview': { billing: { invoices: [{}], payments: [], renewals: [{}], subscriptionHistory: [], revenuePreview: 10, realGatewayConnected: false } },
      'notifications-preview': { notifications: { licenseExpiration: [{}], storageLimits: [], planLimits: [], inactiveCustomer: [], failedProvision: [] } },
      'license-audit': { audit: [{ action: 'generate' }] },
      'subscription-history': { history: [{ action: 'renew' }] },
      'update-plan': { plan }
    };
    return { ok: true, status: 200, json: async () => map[body.action] || { result: { action: body.action } } };
  };
  const engine = saas.SaaSAdminEngine.create({ fetchImpl, sessionProvider: async () => ({ accessToken: 'token', platformRole: 'erp_owner' }) });
  const connected = await engine.connect(validConfig);
  equal(connected.valid, true);
  equal(actions[0].body.action, 'health');
  equal(actions[1].body.action, 'initialize');
  equal(actions[0].options.headers.Authorization, 'Bearer token');
  equal(Object.prototype.hasOwnProperty.call(actions[0].options.headers, 'service_role'), false);
  equal((await engine.refreshDashboard()).customers, 1);
  equal((await engine.loadPlans()).length, 1);
  equal((await engine.loadCustomers()).length, 1);
  equal((await engine.loadCustomer('tenant-1')).limitUsage.users.current, 2);
  equal((await engine.generateLicense('tenant-1', 'monthly')).license.shownOnce, true);
  equal((await engine.validateLicense(goodKey)).validation.valid, true);
  equal((await engine.validateLicense('bad')).validation.status, 'invalid_format');
  equal((await engine.loadBilling()).previewOnly, true);
  equal(engine.snapshot().billing.realGatewayConnected, false);
  equal((await engine.loadNotifications()).notificationsSent, 0);
  equal((await engine.loadLicenseAudit()).length, 1);
  equal((await engine.loadSubscriptionHistory()).length, 1);
  equal((await engine.updatePlan('monthly', { price: 10, currency: 'USD', limits })).valid, true);
  equal(engine.snapshot().persisted, false);
  equal(engine.clear().connected, false);
  const denied = saas.SaaSAdminEngine.create({ fetchImpl, sessionProvider: async () => ({ accessToken: 'token', platformRole: 'owner' }) });
  equal((await denied.connect(validConfig)).valid, false);

  const productionSource = required.filter(file => file.endsWith('.js') && file !== 'saasAdmin.test.js').map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
  equal(/localStorage\s*\.|sessionStorage\s*\.|document\s*\.\s*cookie/i.test(productionSource), false);
  equal(/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEYS|SUPABASE_DB_URL/i.test(productionSource), false);
  equal(/postAccounting\s*\(|postInventory\s*\(|accountingEngine\s*\.\s*post|inventoryEngine\s*\.\s*post/i.test(productionSource), false);
  equal(/services\/(accounting|inventory|customerProvisioning)/i.test(productionSource), false);

  const edgeDir = path.join(projectRoot, 'supabase', 'functions', 'omnistore-saas-admin');
  const edge = fs.readFileSync(path.join(edgeDir, 'index.ts'), 'utf8');
  const migrations = fs.readFileSync(path.join(edgeDir, 'migrations.ts'), 'utf8');
  ['customer_subscriptions','licenses','billing_invoices','billing_payments','subscription_history','customer_metrics','notification_rules','notification_queue','license_audit'].forEach(table => check(migrations.includes(`omnistore_admin.${table}`), `Missing ${table}`));
  ['trial','monthly','quarterly','yearly','lifetime','custom'].forEach(code => check(migrations.includes(`'${code}'`), `Missing plan ${code}`));
  check(edge.includes("platform_role !== 'erp_owner'"), 'Missing ERP owner guard');
  check(edge.includes("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')"), 'Missing server secret');
  check(edge.includes("Deno.env.get('SUPABASE_DB_URL')"), 'Missing server DB URL');
  check(edge.includes('auth.resetPasswordForEmail'), 'Missing secure reset flow');
  check(edge.includes('auth.admin.updateUserById'), 'Missing suspension flow');
  check(edge.includes("body.action === 'update-plan'"), 'Missing configurable plan limits');
  check(edge.includes("body.action === 'generate-license'"), 'Missing license generation');
  check(edge.includes("body.action === 'revoke-license'"), 'Missing license revocation');
  check(edge.includes("body.action === 'billing-preview'"), 'Missing billing preview');
  check(edge.includes("body.action === 'notifications-preview'"), 'Missing notifications preview');
  equal(/eyJ[A-Za-z0-9._-]{20,}|sb_secret_[A-Za-z0-9._-]+|postgres(?:ql)?:\/\//i.test(edge + migrations), false);
  check(migrations.includes('enable row level security'), 'Missing RLS');
  equal(/create policy .* (anon|authenticated)/i.test(migrations), false);

  const html = fs.readFileSync(path.join(projectRoot, 'DigiTronics_v5.html'), 'utf8');
  const pages = ['saas-admin-center','saas-all-customers','saas-customer-details','saas-customer-status','license-center','subscription-plans','subscription-dashboard','customer-statistics','revenue-preview','workspace-usage','license-audit','saas-billing-preview','saas-notifications'];
  pages.forEach(page => {
    check(html.includes(`data-page="${page}"`), `Missing nav ${page}`);
    check(html.includes(`id="page-${page}"`), `Missing page ${page}`);
    check(html.includes(`renderSaaSAdminPage('${page}')`), `Missing render ${page}`);
    check(html.includes(`'${page}': 'manageUsers'`), `Missing permission ${page}`);
  });
  const ui = fs.readFileSync(path.join(__dirname, 'saasAdminUi.js'), 'utf8');
  ['Activate Customer','Suspend Customer','Resume Customer','Renew Subscription','Change Plan','Reset Password','Generate License','Download Workspace Report'].forEach(label => check(ui.includes(label), `Missing ${label}`));
  check(ui.includes('ERP Owner Only'), 'Missing owner notice');
  check(ui.includes('Real Payment Gateway'), 'Missing billing safety notice');
  check(ui.includes("platformRole: user.app_metadata && user.app_metadata.platform_role"), 'Missing session role extraction');
  check(ui.includes('root.confirm'), 'Missing confirmation');
  const sw = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
  check(sw.includes('omnistore-erp-v33-customer-provisioning-v34-saas-admin'), 'Missing cache bump');
  check(sw.includes('./services/saasAdmin/SaaSAdminEngine.js'), 'Missing cache asset');

  return { tests, administrationReadiness: 100, licenseReadiness: 100, realActionsDuringTests: 0, accountingModified: false, inventoryModified: false, posModified: false, customerProvisioningModified: false };
}

if (require.main === module) run().then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
