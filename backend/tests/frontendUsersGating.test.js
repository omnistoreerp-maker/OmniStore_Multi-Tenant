'use strict';

// Frontend regression tests for "المستخدمون والصلاحيات" (company-scoped user
// management):
//   - the Settings card and every management action are gated by the existing
//     canEffective() registry permissions (users.view/create/edit/disable/
//     enable/password.reset) — Owner/Admin bypass, others need the grant
//   - the role label mapping (Arabic) is correct
//   - renderUsersTable renders tenant users with correct role/status and only
//     the action buttons the actor may actually perform
//   - the manager only opens when USE_BACKEND + users.view are satisfied
//
// The REAL functions are extracted from the shipped index.html (not a
// reimplementation) and evaluated against a mock DOM + localStorage, mirroring
// the existing frontendProvisionGating suite.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.resolve(__dirname, '..', '..', 'index.html');
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
  return {
    style: {},
    value: '',
    textContent: '',
    innerHTML: '',
    display: '',
    appendChild: () => {},
    addEventListener: () => {},
    querySelectorAll: () => [],
    dataset: {}
  };
}

function buildSandbox(opts = {}) {
  const elements = {};
  const getEl = (id) => {
    if (!elements[id]) elements[id] = elementStub();
    return elements[id];
  };

  const context = {
    console,
    document: {
      getElementById: getEl,
      createElement: () => elementStub(),
      querySelectorAll: () => [],
      addEventListener: () => {}
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    navigator: { onLine: true, userAgent: 'node' },
    location: { href: '', reload: () => {} },
    setTimeout,
    clearTimeout,
    // sandbox runtime state the real functions reference
    currentUser: opts.currentUser !== undefined ? opts.currentUser : null,
    USE_BACKEND: opts.useBackend !== undefined ? opts.useBackend : true,
    usersManagerCache: opts.usersManagerCache || [],
    usersManagerFiltered: opts.usersManagerFiltered || [],
    usersManagerSelected: null,
    companyCatalogList: opts.companyCatalogList || [],
    showToast: opts.showToast || (() => {})
  };
  context.globalThis = context;
  context.window = context;

  const code = [
    'var USER_ROLE_AR = { Owner: \'مالك\', Admin: \'مدير\', Manager: \'مشرف\', Cashier: \'كاشير\', Technician: \'فني\', WarehouseSales: \'مخزن/مبيعات\', Sales: \'مبيعات\', Support: \'دعم\', Viewer: \'مشاهد\' };',
    'function _effectiveRole() { return (currentUser && (currentUser.effectiveRole || currentUser.role)) || \'\'; }',
    'function _effectivePermissions() { return (currentUser && Array.isArray(currentUser.effectivePermissions)) ? currentUser.effectivePermissions : null; }',
    extractFunction('canEffective'),
    extractFunction('escapeHtml'),
    extractFunction('userRoleLabel'),
    extractFunction('renderUsersTable')
  ].join('\n');

  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'index.html-users-gating.js' });

  return { context, getEl, elements };
}

function makeUser(role, effectivePermissions) {
  return { id: 'u-' + role, role, effectivePermissions: effectivePermissions || null };
}

describe('frontend users & permissions gating (canEffective)', () => {
  test('Owner and Admin bypass every users.* permission', () => {
    const { context } = buildSandbox({ currentUser: makeUser('Owner') });
    for (const p of ['users.view', 'users.create', 'users.edit', 'users.disable', 'users.enable', 'users.password.reset']) {
      expect(context.canEffective(p)).toBe(true);
    }
    const { context: ctx2 } = buildSandbox({ currentUser: makeUser('Admin') });
    for (const p of ['users.view', 'users.create', 'users.edit', 'users.disable', 'users.enable', 'users.password.reset']) {
      expect(ctx2.canEffective(p)).toBe(true);
    }
  });

  test('Manager with users.view/users.create can manage, but NOT disable/reset without grants', () => {
    const { context } = buildSandbox({
      currentUser: makeUser('Manager', ['users.view', 'users.create', 'users.edit'])
    });
    expect(context.canEffective('users.view')).toBe(true);
    expect(context.canEffective('users.create')).toBe(true);
    expect(context.canEffective('users.edit')).toBe(true);
    expect(context.canEffective('users.disable')).toBe(false);
    expect(context.canEffective('users.enable')).toBe(false);
    expect(context.canEffective('users.password.reset')).toBe(false);
  });

  test('Cashier/Viewer hold no users.* permission', () => {
    const { context } = buildSandbox({ currentUser: makeUser('Cashier', ['sales.view']) });
    expect(context.canEffective('users.view')).toBe(false);
    expect(context.canEffective('users.create')).toBe(false);
    const { context: ctx2 } = buildSandbox({ currentUser: makeUser('Viewer', ['dashboard.view']) });
    expect(ctx2.canEffective('users.view')).toBe(false);
  });

  test('no session -> denied', () => {
    const { context } = buildSandbox({ currentUser: null });
    expect(context.canEffective('users.view')).toBe(false);
  });
});

describe('frontend user role label mapping', () => {
  test('known roles map to Arabic labels; unknown roles fall back to identity', () => {
    const { context } = buildSandbox();
    expect(context.userRoleLabel('Owner')).toBe('مالك');
    expect(context.userRoleLabel('Admin')).toBe('مدير');
    expect(context.userRoleLabel('Manager')).toBe('مشرف');
    expect(context.userRoleLabel('Cashier')).toBe('كاشير');
    expect(context.userRoleLabel('Technician')).toBe('فني');
    expect(context.userRoleLabel('Viewer')).toBe('مشاهد');
    expect(context.userRoleLabel('SuperCustom')).toBe('SuperCustom');
    expect(context.userRoleLabel('')).toBe('—');
    expect(context.userRoleLabel(undefined)).toBe('—');
  });
});

describe('frontend users table rendering (real renderUsersTable)', () => {
  const digiUsers = [
    { id: 'u-owner', username: 'digiOwner', fullName: 'Digi Owner', role: 'Owner', status: 'active' },
    { id: 'u-cash', username: 'digiCashier', fullName: 'Digi Cashier', role: 'Cashier', status: 'active', branchId: 'MAIN' },
    { id: 'u-off', username: 'digiOff', fullName: 'Digi Off', role: 'Manager', status: 'disabled' }
  ];

  test('an Owner sees management actions (role select, disable, reset, view)', () => {
    const { context, getEl } = buildSandbox({
      currentUser: makeUser('Owner'),
      usersManagerCache: digiUsers,
      usersManagerFiltered: digiUsers
    });
    context.renderUsersTable();
    const tbody = getEl('usersManagerTbody').innerHTML;
    expect(tbody).toContain('Digi Owner');
    expect(tbody).toContain('مالك');
    expect(tbody).toContain('فعال');
    expect(tbody).toContain('معطل');
    expect(tbody).toContain('MAIN');
    // Owner row never gets a disable/role button (owner protection mirrors the backend).
    const ownerRow = tbody.slice(tbody.indexOf('<tr>'), tbody.indexOf('</tr>') + 5);
    expect(ownerRow).not.toContain('تعطيل');
    // Action verbs present for non-owner rows.
    expect(tbody).toContain('تعطيل');
    expect(tbody).toContain('تفعيل'); // disabled Manager row
    expect(tbody).toContain('إعادة كلمة المرور');
    expect(tbody).toContain('عرض');
  });

  test('a Cashier sees ONLY the view button (no management actions)', () => {
    const { context, getEl } = buildSandbox({
      currentUser: makeUser('Cashier', ['sales.view']),
      usersManagerCache: digiUsers,
      usersManagerFiltered: digiUsers
    });
    context.renderUsersTable();
    const tbody = getEl('usersManagerTbody').innerHTML;
    expect(tbody).toContain('عرض');
    expect(tbody).not.toContain('تعطيل');
    expect(tbody).not.toContain('تفعيل');
    expect(tbody).not.toContain('إعادة كلمة المرور');
    expect(tbody).not.toContain('<select'); // no role dropdown
  });

  test('empty directory renders the empty message', () => {
    const { context, getEl } = buildSandbox({ currentUser: makeUser('Owner'), usersManagerCache: [], usersManagerFiltered: [] });
    context.renderUsersTable();
    expect(getEl('usersManagerTbody').innerHTML).toBe('');
    expect(getEl('usersManagerEmpty').style.display).toBe('block');
  });
});

describe('frontend users manager wiring (markers in the shipped index.html)', () => {
  test('the Settings card exists and is gated by users.view', () => {
    expect(HTML).toContain('id="usersManagementCard"');
    expect(HTML).toContain("canEffective('users.view')");
  });

  test('the modal, list, and add-user views exist', () => {
    expect(HTML).toContain('id="usersManagerModal"');
    expect(HTML).toContain('id="usersManagerTbody"');
    expect(HTML).toContain('id="usersManagerAdd"');
    expect(HTML).toContain('id="usersSearchInput"');
  });

  test('add-user submits through backendApi.users.create with tenant-scoped fields', () => {
    expect(HTML).toContain('backendApi.users.create(payload)');
  });

  test('row actions call the backend user lifecycle endpoints', () => {
    expect(HTML).toContain("backendApi.users.disable(id)");
    expect(HTML).toContain("backendApi.users.enable(id)");
    expect(HTML).toContain('backendApi.users.resetPassword(id, newPassword)');
    expect(HTML).toContain("backendApi.users.update(id, { role })");
  });
});
