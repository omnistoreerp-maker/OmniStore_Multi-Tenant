const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..');
const sandbox = vm.createContext({ console, Date, globalThis: {} });
sandbox.window = sandbox.globalThis;
[
  'RoleManager.js','PermissionEngine.js','UserManager.js','SessionManager.js','PasswordPolicy.js',
  'AccessValidator.js','RouteGuard.js','LoginPreview.js','LogoutPreview.js','SecurityAudit.js',
  'AuthenticationValidator.js','AuthenticationEngine.js'
].forEach(file => new vm.Script(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file }).runInContext(sandbox));
const auth = sandbox.globalThis.OmniAuthPreview;

function run() {
  assert.ok(auth.AuthenticationEngine);
  assert.ok(auth.PermissionEngine);
  assert.ok(auth.RoleManager);
  const engine = auth.AuthenticationEngine.createEngine();
  assert.strictEqual(engine.mode, 'mock-preview-only');
  assert.strictEqual(engine.backend, 'none');
  assert.strictEqual(engine.persisted, false);
  assert.strictEqual(engine.users().length, 6);
  assert.strictEqual(engine.roles().length, 6);
  assert.strictEqual(auth.PermissionEngine.PERMISSIONS.length, 13);
  assert.strictEqual(auth.PermissionEngine.can('owner', 'anything.preview'), true);
  assert.strictEqual(auth.PermissionEngine.can('cashier', 'sales.create'), true);
  assert.strictEqual(auth.PermissionEngine.can('cashier', 'purchases.create'), false);
  assert.strictEqual(engine.permissionMatrix().length, 6);

  engine.users().forEach(user => {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(user, 'password'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(user, 'passwordHash'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(user, 'accessToken'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(user, 'refreshToken'), false);
  });

  const login = engine.previewLogin({ userId: 'mock-manager', sessionOptions: { now: '2026-07-01T10:00:00.000Z', durationMinutes: 30 } });
  assert.strictEqual(login.valid, true);
  assert.strictEqual(login.wouldAuthenticate, true);
  assert.strictEqual(login.authenticatedInReality, false);
  assert.strictEqual(login.backendContacted, false);
  assert.strictEqual(login.credentialsStored, false);
  assert.strictEqual(login.mockSession.mock, true);
  assert.strictEqual(login.mockSession.realSession, false);
  assert.strictEqual(login.mockSession.active, false);
  assert.strictEqual(login.mockSession.persisted, false);
  assert.strictEqual(login.mockSession.stored, false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(login.mockSession, 'token'), false);

  const rejectedPassword = engine.previewLogin({ userId: 'mock-manager', password: 'never-store-this' });
  assert.strictEqual(rejectedPassword.valid, false);
  assert.ok(rejectedPassword.errors.some(error => error.code === 'PASSWORD_INPUT_NOT_ACCEPTED'));
  assert.strictEqual(rejectedPassword.mockSession, null);

  const before = auth.SessionManager.expirationPreview(login.mockSession, '2026-07-01T10:20:00.000Z');
  const after = auth.SessionManager.expirationPreview(login.mockSession, '2026-07-01T10:31:00.000Z');
  assert.strictEqual(before.expired, false);
  assert.strictEqual(after.expired, true);
  assert.strictEqual(after.sessionChanged, false);

  const logout = engine.previewLogout(login.mockSession);
  assert.strictEqual(logout.wouldEndSession, true);
  assert.strictEqual(logout.realSessionEnded, false);
  assert.strictEqual(logout.storageCleared, false);
  assert.strictEqual(logout.backendContacted, false);

  const allowed = engine.previewRouteAccess('reports', 'mock-manager', login.mockSession, '2026-07-01T10:10:00.000Z');
  const denied = engine.previewRouteAccess('purchases', 'mock-cashier', null);
  assert.strictEqual(allowed.allowed, true);
  assert.strictEqual(allowed.navigationPerformed, false);
  assert.strictEqual(denied.allowed, false);

  const policy = engine.previewPasswordPolicy('Strong#9A');
  assert.strictEqual(policy.valid, true);
  assert.strictEqual(policy.score, 100);
  assert.strictEqual(policy.retained, false);
  assert.strictEqual(policy.echoed, false);

  const audit = engine.previewAudit([{ type: 'login_preview', outcome: 'allowed' }, { type: 'route_preview', outcome: 'denied' }]);
  assert.strictEqual(audit.total, 2);
  assert.strictEqual(audit.failed, 1);
  assert.strictEqual(audit.persisted, false);
  assert.strictEqual(audit.previewOnly, true);

  const architecture = engine.validate();
  assert.strictEqual(architecture.valid, true);
  assert.strictEqual(architecture.readinessScore, 100);
  assert.strictEqual(architecture.checks.backendDisabled, true);
  assert.strictEqual(architecture.checks.persistenceDisabled, true);

  const requiredFiles = [
    'AuthenticationEngine.js','SessionManager.js','UserManager.js','RoleManager.js','PermissionEngine.js',
    'RouteGuard.js','LoginPreview.js','LogoutPreview.js','PasswordPolicy.js','AccessValidator.js',
    'SecurityAudit.js','AuthenticationValidator.js','auth.test.js','README.md'
  ];
  requiredFiles.forEach(file => assert.ok(fs.existsSync(path.join(__dirname, file)), `Missing ${file}`));

  const templateDir = path.join(projectRoot, 'templates', 'auth');
  ['roles.template.json','permissions.template.json','users.template.json','session.template.json'].forEach(file => {
    const fullPath = path.join(templateDir, file);
    assert.ok(fs.existsSync(fullPath), `Missing ${file}`);
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    assert.strictEqual(/password|secret|accessToken|refreshToken/i.test(JSON.stringify(parsed)), false);
  });

  const productionFiles = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && name !== 'auth.test.js');
  const source = productionFiles.map(name => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n');
  assert.strictEqual(/localStorage\s*\.|sessionStorage\s*\.|document\s*\.\s*cookie|createClient|firebase\s*\.|Auth0|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|\.post\s*\(|\.receive\s*\(|\.issue\s*\(|saveDB|ghPush|fetch\s*\(|XMLHttpRequest|WebSocket/i.test(source), false);
  assert.strictEqual(/[A-Z]:\\Projects\\/i.test(source), false);

  const html = fs.readFileSync(path.join(projectRoot, 'DigiTronics_v5.html'), 'utf8');
  const pages = ['authentication-center','auth-preview-users','auth-preview-roles','auth-preview-permissions','auth-login-preview','auth-session-preview','auth-security-audit','auth-permission-matrix'];
  pages.forEach(page => {
    assert.ok(html.includes(`data-page="${page}"`), `Missing navigation ${page}`);
    assert.ok(html.includes(`id="page-${page}"`), `Missing page ${page}`);
    assert.ok(html.includes(`renderAuthPreviewPage('${page}')`), `Missing render hook ${page}`);
  });
  ['Authentication Center','Users Preview','Roles Preview','Permissions Preview','Login Preview','Session Preview','Security Audit Preview','Permission Matrix'].forEach(label => assert.ok(html.includes(label)));
  assert.strictEqual(/id="authPreviewPassword"/i.test(html), false);

  ['PHASE23_IMPLEMENTATION_REPORT_20260630.md','PHASE23_SECURITY_REPORT_20260630.md','PHASE23_TEST_REPORT_20260630.md','PHASE23_ROLLBACK_REPORT_20260630.md'].forEach(file => assert.ok(fs.existsSync(path.join(projectRoot, file)), `Missing ${file}`));
  const sw = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
  assert.ok(/omnistore-erp-v\d+-[a-z0-9-]+/.test(sw));
  assert.ok(sw.includes('./services/auth/AuthenticationEngine.js'));
  assert.ok(sw.includes('./templates/auth/roles.template.json'));

  return { tests: 50, authenticationReadinessScore: architecture.readinessScore, mockUsers: engine.users().length, roles: engine.roles().length, realSessions: 0 };
}

if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { run };
