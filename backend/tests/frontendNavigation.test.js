'use strict';

// Phase 34.1 — navigation architecture regression tests.
//   (a) master-scope nav renders ONLY when platformRole && USE_BACKEND,
//   (b) tenant items stay out of the MASTER-scope view and vice versa,
//   (c) no nav item reveals a page that canAccessPage rejects,
//   (d) scope helpers never depend on ACTIVE_TENANT_ID / tenant local storage.
//
// Like the other frontend tests, the REAL functions and markers come from the
// shipped index.html (vm-extracted), and the module/navigation platform files
// are loaded as shipped.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML_PATH = path.join(ROOT, 'index.html');
const HTML = fs.readFileSync(HTML_PATH, 'utf8');

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

describe('frontend navigation markers (shipped index.html)', () => {
  test('master/company scope structures exist', () => {
    expect(HTML).toContain('id="omniScopeSwitch"');
    expect(HTML).toContain('data-nav-scope="master"');
    expect(HTML).toContain('data-nav-scope="tenant"');
    expect(HTML).toContain('setOmniNavScope(\'master\')');
    expect(HTML).toContain('function isPlatformMaster()');
    expect(HTML).toContain('function applyNavScope()');
  });

  test('placeholder modules and settings search exist (nav placeholders only)', () => {
    expect(HTML).toContain('id="page-playstation"');
    expect(HTML).toContain('id="page-car-rental"');
    expect(HTML).toContain('id="settingsSearch"');
    expect(HTML).toContain('ابحث في الإعدادات');
  });

  test('platform scope helpers never read tenant storage', () => {
    const helpersBlock = HTML.slice(HTML.indexOf('PHASE 34.1 — MASTER/COMPANY NAV SCOPE'),
      HTML.indexOf('function filterOmniSettings'));
    expect(helpersBlock).not.toContain('ACTIVE_TENANT_ID');
    expect(helpersBlock).not.toContain('getDbStorageKey');
    expect(helpersBlock).not.toContain('localStorage');
    expect(helpersBlock).not.toContain('sessionStorage');
  });
});

describe('frontend isPlatformMaster (extracted from index.html)', () => {
  function contextWith(platformRole, useBackend) {
    const context = {
      platformRole,
      USE_BACKEND: useBackend,
      document: { getElementById: () => elementStub(), querySelectorAll: () => [], addEventListener: () => {} },
      console
    };
    context.globalThis = context;
    context.window = context;
    vm.createContext(context);
    vm.runInContext(extractFunction('isPlatformMaster'), context);
    return context;
  }

  test('false without platformRole, even in backend mode', () => {
    expect(contextWith(null, true).isPlatformMaster()).toBe(false);
    expect(contextWith(null, false).isPlatformMaster()).toBe(false);
  });

  test('false when backend is disabled even with a role', () => {
    expect(contextWith('MASTER_OWNER', false).isPlatformMaster()).toBe(false);
  });

  test('true only with platformRole AND backend mode', () => {
    expect(contextWith('MASTER_OWNER', true).isPlatformMaster()).toBe(true);
    expect(contextWith('PLATFORM_ADMIN', true).isPlatformMaster()).toBe(true);
  });
});

describe('navigation builder master-scope gating (shipped module platform files)', () => {
  function buildNav(platformRole, useBackend) {
    const store = new Map();
    const context = {
      console,
      CustomEvent: function (name, options) { this.type = name; this.detail = options ? options.detail : undefined; },
      dispatchEvent() {},
      getCurrentBusinessType: () => 'computer_shop',
      platformRole,
      USE_BACKEND: useBackend,
      canAccessPage: () => true,
      localStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
    };
    context.globalThis = context;
    vm.createContext(context);
    const run = relative => vm.runInContext(fs.readFileSync(path.join(ROOT, 'services/modulePlatform', relative), 'utf8'), context);
    run('moduleRegistry.js');
    run('moduleLoader.js');
    const dropdowns = {};
    ['main','sales','purchases','inventory','reports','customers','treasury','installments','admin',
     'maintenance','analytics','employees','marketplace','entertainment','internal',
     'master_home','master_companies','master_users','master_licenses','master_integrations',
     'master_database','master_backups','master_audit','master_platform'].forEach(id => {
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

  test('(a) master groups render only for platform role + backend', () => {
    const tenant = buildNav(null, true);
    expect(tenant.dropdowns['dropdown-master_home'].innerHTML).not.toContain('data-page="platform-master"');
    expect(tenant.dropdowns['dropdown-master_home'].innerHTML).not.toContain('مركز تحكم OmniStore');

    const master = buildNav('MASTER_OWNER', true);
    expect(master.dropdowns['dropdown-master_home'].innerHTML).toContain('data-page="platform-master"');
    expect(master.dropdowns['dropdown-master_platform'].innerHTML).toContain('data-page="saas-admin-center"');

    const noBackend = buildNav('MASTER_OWNER', false);
    expect(noBackend.dropdowns['dropdown-master_home'].innerHTML).not.toContain('data-page="platform-master"');
  });

  test('(b) tenant business groups still render for a tenant user', () => {
    const tenant = buildNav(null, true);
    expect(tenant.dropdowns['dropdown-sales'].innerHTML).toContain('data-page="pos"');
    expect(tenant.dropdowns['dropdown-inventory'].innerHTML).toContain('data-page="products"');
    expect(tenant.dropdowns['dropdown-treasury'].innerHTML).toContain('data-page="treasury"');
  });

  test('(c) internal developer pages never leak into master groups', () => {
    const master = buildNav('MASTER_OWNER', true);
    expect(master.dropdowns['dropdown-master_home'].innerHTML).not.toContain('data-page="go-live-center"');
    expect(master.dropdowns['dropdown-master_platform'].innerHTML).not.toContain('data-page="qa-center"');
  });
});

describe('frontend canAccessPage placeholder gates (extracted from index.html)', () => {
  function sandbox(role, perms) {
    const context = {
      console,
      currentUser: { username: 'u', role, effectivePermissions: perms || [], effectiveRole: role },
      platformRole: null,
      USE_BACKEND: true,
      DOC: undefined,
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
      extendExtract('canAccessPage')
    ].join('\n');
    vm.createContext(context);
    vm.runInContext(code, context, { filename: 'index.html-nav-gating.js' });
    return context;
  }
  function extendExtract(name) { return extractFunction(name); }

  test('Owner/Admin can open placeholder pages; a Viewer cannot', () => {
    expect(sandbox('Owner').canAccessPage('playstation')).toBe(true);
    expect(sandbox('Admin').canAccessPage('car-rental')).toBe(true);
    expect(sandbox('Viewer').canAccessPage('playstation')).toBe(false);
    expect(sandbox('Viewer').canAccessPage('car-rental')).toBe(false);
  });

  test('a Viewer with the underlying permission is allowed', () => {
    const ctx = sandbox('Viewer', ['settings.view']);
    expect(ctx.canAccessPage('playstation')).toBe(true);
  });

  test('platform-master stays platform-gated (no regression)', () => {
    expect(sandbox('Owner').canAccessPage('platform-master')).toBe(false);
    const masterCtx = sandbox('Viewer');
    masterCtx.platformRole = 'MASTER_OWNER';
    expect(masterCtx.canAccessPage('platform-master')).toBe(true);
  });
});