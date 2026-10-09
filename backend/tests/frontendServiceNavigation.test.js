'use strict';

// Phase P1.3/P1.4 — service surfaces visibility: Student, Teacher, Center and
// Master Control entry points in the platform/ERP navigation.
//   (a) moduleRegistry registers the three tenant routes under the 'education'
//       group with active-by-default module state;
//   (b) navigationBuilder renders them into dropdown-education and gates every
//       item through canAccessPage;
//   (c) canAccessPage admits each route only for the right principal: any
//       signed-in user for the print shop, education.teachers.view /
//       education.centers.view for the Education views (canEffective, Owner/
//       Admin bypass included), and platformRole && USE_BACKEND for Master
//       Control;
//   (d) showPage hands the three routes to their REAL pages (student.html and
//       education/index.html#teachers / #centers) instead of looking for a
//       #page-<id> container that does not exist in the ERP document;
//   (e) the platform catalog stays untouched: student-services remains the
//       active print-shop section and no teacher/center/master sections were
//       introduced before those surfaces have ERP-internal pages.
//
// Like the sibling frontend tests, the REAL functions come from the shipped
// index.html (vm-extracted) and the module platform files run as shipped.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML_PATH = path.join(ROOT, 'index.html');
const HTML = fs.readFileSync(HTML_PATH, 'utf8');
const REGISTRY_CODE = fs.readFileSync(path.join(ROOT, 'services', 'modulePlatform', 'moduleRegistry.js'), 'utf8');
const BUILDER_CODE = fs.readFileSync(path.join(ROOT, 'services', 'modulePlatform', 'navigationBuilder.js'), 'utf8');
const CATALOG_CODE = fs.readFileSync(path.join(ROOT, 'backend', 'services', 'platformCatalog.service.js'), 'utf8');
const EDUCATION_JS = fs.readFileSync(path.join(ROOT, 'platform', 'education', 'education.js'), 'utf8');
const EDUCATION_HTML = fs.readFileSync(path.join(ROOT, 'education', 'index.html'), 'utf8');

function extractFunction(name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(', 'g');
  const match = re.exec(HTML);
  if (!match) throw new Error('function not found: ' + name);
  const start = match.index;
  const open = HTML.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') {
      depth--;
      if (depth === 0) return HTML.slice(start, i + 1);
    }
  }
  throw new Error('unterminated function: ' + name);
}

function elementStub() {
  return { style: {}, dataset: {}, value: '', textContent: '', innerHTML: '', appendChild: () => {},
    addEventListener: () => {}, querySelectorAll: () => [], setAttribute: () => {}, removeAttribute: () => {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {} }, getAttribute: () => null };
}

// canAccessPage sandbox mirroring the shipped index.html helpers, extended
// with the real canEffective so the education.* rules execute for real.
function gateSandbox(opts = {}) {
  const role = opts.role !== undefined ? opts.role : 'Viewer';
  const currentUser = opts.currentUser !== undefined ? opts.currentUser
    : { username: 'u', role, effectivePermissions: opts.perms || [], effectiveRole: role };
  const context = {
    console,
    currentUser,
    platformRole: opts.platformRole !== undefined ? opts.platformRole : null,
    USE_BACKEND: opts.useBackend !== undefined ? opts.useBackend : true,
    document: { getElementById: () => elementStub(), querySelectorAll: () => [], addEventListener: () => {} },
    OmniModuleLoader: { isRouteEnabled: () => true },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { onLine: true, userAgent: 'node' },
    location: { href: '', reload: () => {} }
  };
  context.globalThis = context;
  context.window = context;
  const code = [
    'function _effectiveRole() { return (currentUser && (currentUser.effectiveRole || currentUser.role)) || \'\'; }',
    'function _effectivePermissions() { return currentUser && currentUser.effectivePermissions ? currentUser.effectivePermissions.slice() : null; }',
    'const LEGACY_ROLE_PERMS = {};',
    'const REGISTRY_PERM_BY_ACTION = { viewDashboard:\'dashboard.view\', createInvoices:\'sales.create\', viewInvoices:\'sales.view\', editInvoices:\'sales.edit\', viewProducts:\'products.view\', viewInventory:\'inventory.view\', viewPurchases:\'purchases.view\', viewCustomers:\'customers.view\', viewSuppliers:\'suppliers.view\', manageCRM:\'crm.view\', viewReports:\'reports.view\', viewFinancial:\'treasury.view\', manageSettings:\'settings.view\', viewSerials:\'products.view\', viewMaintenance:\'maintenance.view\', viewWarranty:\'maintenance.view\', viewDevices:\'inventory.view\' };',
    'function can(action) { if (!currentUser) return false; const role = _effectiveRole(); if (role === \'Owner\' || role === \'Admin\') return true; const map = REGISTRY_PERM_BY_ACTION[action]; if (!map) return false; return !!currentUser.effectivePermissions && currentUser.effectivePermissions.includes(map); }',
    extractFunction('canEffective'),
    extractFunction('canAccessPage')
  ].join('\n');
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'index.html-service-gating.js' });
  return context;
}

function loadRegistry() {
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(REGISTRY_CODE, context, { filename: 'moduleRegistry.js' });
  return context.OmniModuleRegistry;
}

function buildNav(canAccessPage) {
  const store = new Map();
  const context = {
    console,
    CustomEvent: function (name, options) { this.type = name; this.detail = options ? options.detail : undefined; },
    dispatchEvent() {},
    getCurrentBusinessType: () => 'computer_shop',
    platformRole: null,
    USE_BACKEND: true,
    canAccessPage,
    localStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
  };
  context.globalThis = context;
  vm.createContext(context);
  const run = relative => vm.runInContext(fs.readFileSync(path.join(ROOT, 'services/modulePlatform', relative), 'utf8'), context);
  run('moduleRegistry.js');
  run('moduleLoader.js');
  const dropdowns = {};
  ['main', 'sales', 'purchases', 'inventory', 'reports', 'customers', 'treasury', 'installments', 'admin',
   'maintenance', 'analytics', 'employees', 'marketplace', 'entertainment', 'education', 'internal',
   'master_home', 'master_companies', 'master_users', 'master_licenses', 'master_integrations',
   'master_database', 'master_backups', 'master_audit', 'master_platform'].forEach(id => {
    dropdowns['dropdown-' + id] = { innerHTML: '', style: {}, dataset: {}, querySelectorAll: () => [] };
  });
  context.document = {
    getElementById: id => dropdowns[id] || null,
    querySelector: () => ({ style: {} }),
    querySelectorAll: () => []
  };
  run('navigationBuilder.js');
  context.OmniModuleLoader.boot();
  context.OmniNavigationBuilder.build();
  return { context, dropdowns };
}

describe('service surfaces registration (shipped moduleRegistry.js)', () => {
  test('registers student-services as an independent module', () => {
    const registry = loadRegistry();
    const mod = registry.student_services;
    expect(mod).toBeDefined();
    expect(mod.route).toBe('student-services');
    expect(mod.enabled).toBe(true);
    expect(mod.businessTypes).toBe('*');
    expect(mod.scope).toBe('tenant');
    expect(mod.navigation.map(item => item.route)).toEqual(['student-services']);
    mod.navigation.forEach(item => expect(item.group).toBe('education'));
  });

  test('module state resolves active and compatible after boot', () => {
    const context = { console, getCurrentBusinessType: () => 'computer_shop' };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(REGISTRY_CODE, context, { filename: 'moduleRegistry.js' });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'services', 'modulePlatform', 'moduleLoader.js'), 'utf8'), context);
    context.OmniModuleLoader.boot();
    const state = context.OmniModuleLoader.getModuleState('student_services');
    expect(state).toBeTruthy();
    expect(state.active).toBe(true);
    expect(state.compatible).toBe(true);
    expect(context.OmniModuleLoader.isRouteEnabled('student-services')).toBe(true);
    expect(context.OmniModuleLoader.isRouteEnabled('education-teachers')).toBe(true);
    expect(context.OmniModuleLoader.isRouteEnabled('education-centers')).toBe(true);
  });
});

describe('education nav group (shipped navigationBuilder.js)', () => {
  test('builder exposes a tenant education group', () => {
    expect(BUILDER_CODE).toMatch(/education:\s*\{[^}]*scope:\s*'tenant'/);
  });

  test('renders the three entry points into dropdown-education', () => {
    const { dropdowns } = buildNav(() => true);
    const html = dropdowns['dropdown-education'].innerHTML;
    expect(html).toContain('data-page="student-services"');
    expect(html).toContain('data-page="education-teachers"');
    expect(html).toContain('data-page="education-centers"');
    expect(html).toContain('showPage(\'student-services\')');
  });

  test('items whose canAccessPage check fails are dropped from the group', () => {
    const { dropdowns } = buildNav(route => route !== 'education-teachers');
    const html = dropdowns['dropdown-education'].innerHTML;
    expect(html).toContain('data-page="student-services"');
    expect(html).toContain('data-page="education-centers"');
    expect(html).not.toContain('data-page="education-teachers"');
  });
});

describe('canAccessPage gating for the four service entry points', () => {
  test('student-services: any signed-in user, nobody else', () => {
    expect(gateSandbox({ role: 'Viewer' }).canAccessPage('student-services')).toBe(true);
    expect(gateSandbox({ role: 'Owner' }).canAccessPage('student-services')).toBe(true);
    expect(gateSandbox({ currentUser: null }).canAccessPage('student-services')).toBe(false);
  });

  test('education-teachers: Owner/Admin or an education.teachers.view holder', () => {
    expect(gateSandbox({ role: 'Owner' }).canAccessPage('education-teachers')).toBe(true);
    expect(gateSandbox({ role: 'Admin' }).canAccessPage('education-teachers')).toBe(true);
    expect(gateSandbox({ role: 'Viewer', perms: ['education.teachers.view'] }).canAccessPage('education-teachers')).toBe(true);
    expect(gateSandbox({ role: 'Viewer', perms: ['education.centers.view'] }).canAccessPage('education-teachers')).toBe(false);
    expect(gateSandbox({ role: 'Viewer', perms: [] }).canAccessPage('education-teachers')).toBe(false);
    expect(gateSandbox({ currentUser: null }).canAccessPage('education-teachers')).toBe(false);
  });

  test('education-centers: Owner/Admin or an education.centers.view holder', () => {
    expect(gateSandbox({ role: 'Owner' }).canAccessPage('education-centers')).toBe(true);
    expect(gateSandbox({ role: 'Viewer', perms: ['education.centers.view'] }).canAccessPage('education-centers')).toBe(true);
    expect(gateSandbox({ role: 'Viewer', perms: ['education.teachers.view'] }).canAccessPage('education-centers')).toBe(false);
    expect(gateSandbox({ role: 'Viewer', perms: [] }).canAccessPage('education-centers')).toBe(false);
  });

  test('platform-master stays platform-gated (existing fourth entry point)', () => {
    expect(gateSandbox({ role: 'Owner', platformRole: null }).canAccessPage('platform-master')).toBe(false);
    const withRole = gateSandbox({ role: 'Viewer', platformRole: 'MASTER_OWNER' });
    expect(withRole.canAccessPage('platform-master')).toBe(true);
    const noBackend = gateSandbox({ role: 'Viewer', platformRole: 'MASTER_OWNER', useBackend: false });
    expect(noBackend.canAccessPage('platform-master')).toBe(false);
  });
});

describe('showPage hands off to the real service pages (shipped index.html)', () => {
  test('redirect map targets student.html and the education hash views', () => {
    expect(HTML).toMatch(/'student-services':\s*'student\.html'/);
    expect(HTML).toMatch(/'education-teachers':\s*'education\/index\.html#teachers'/);
    expect(HTML).toMatch(/'education-centers':\s*'education\/index\.html#centers'/);
  });

  test('redirect targets resolve to real files with real views', () => {
    expect(fs.existsSync(path.join(ROOT, 'student.html'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'education', 'index.html'))).toBe(true);
    expect(EDUCATION_HTML).toContain('href="#teachers"');
    expect(EDUCATION_HTML).toContain('href="#centers"');
    expect(EDUCATION_HTML).toContain('src="../platform/education/education.js"');
  });

  test('the education document hash-routes into those views', () => {
    expect(EDUCATION_JS).toContain('window.addEventListener(\'hashchange\'');
    expect(EDUCATION_JS).toContain('window.location.hash');
  });

  test('sidebar button and dropdown container exist for the education group', () => {
    expect(HTML).toContain('toggleNavDropdown(\'education\'');
    expect(HTML).toContain('id="dropdown-education"');
    expect(HTML).toContain('data-page="education-teachers"');
    expect(HTML).toContain('data-page="education-centers"');
    expect(HTML).toContain('data-page="student-services"');
  });
});

describe('platform catalog untouched (P1.3 constraint)', () => {
  test('student-services stays the active print-shop section', () => {
    expect(CATALOG_CODE).toMatch(/id:\s*'student-services'[\s\S]{0,300}?status:\s*'active'/);
    expect(CATALOG_CODE).toMatch(/url:\s*'\/student\.html'/);
  });

  test('no teacher/center/master sections were introduced before their real routes', () => {
    expect(CATALOG_CODE).not.toMatch(/id:\s*'(education-teachers|education-centers|platform-master|teacher|teachers|center|centers|master)'/);
  });
});
