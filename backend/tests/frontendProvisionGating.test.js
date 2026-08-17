'use strict';

// Frontend regression tests for "تهيئة شركة جديدة" (company provisioning):
//   - the Settings card is gated by company.create (canEffective), Owner/Admin
//     bypass, others need the explicit permission
//   - the login screen shows the selected company identity (name + default
//     branch) via setCompanySelection()/renderLoginCompanyIdentity()
//   - the identity block is hidden when no company is selected
//   - tenant-internal ids are never shown; only the display name
//
// The REAL functions are extracted from the shipped index.html (not a
// reimplementation) and evaluated against a mock DOM + localStorage, mirroring
// the existing frontendTenantScoping suite.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.resolve(__dirname, '..', '..', 'index.html');

function extractFunction(source, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(', 'g');
  const match = re.exec(source);
  if (!match) throw new Error('function not found: ' + name);
  const start = match.index;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
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
  const html = fs.readFileSync(HTML_PATH, 'utf8');
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
    window: {}
  };
  context.globalThis = context;
  context.window = context;

  const code = [
    'function _effectiveRole() { return (currentUser && (currentUser.effectiveRole || currentUser.role)) || \'\'; }',
    'function _effectivePermissions() { return (currentUser && Array.isArray(currentUser.effectivePermissions)) ? currentUser.effectivePermissions : null; }',
    extractFunction(html, 'canEffective'),
    extractFunction(html, 'setCompanySelection'),
    extractFunction(html, 'renderLoginCompanyIdentity'),
    'function hideCompanyList() { var l = document.getElementById("companyList"); if (l) l.style.display = "none"; }',
    'function storeSelectedCompanyId() {}',
    'function _companyInput() { return document.getElementById("loginCompany"); }',
    'function _companyList() { return document.getElementById("companyList"); }'
  ].join('\n');

  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'index.html-provision-gating.js' });

  return { context, getEl, elements };
}

function makeUser(role, effectivePermissions) {
  return { role, effectivePermissions: effectivePermissions || null };
}

describe('frontend provisioning gating (company.create)', () => {
  test('Owner and Admin bypass company.create', () => {
    const { context } = buildSandbox();
    context.currentUser = makeUser('Owner');
    expect(context.canEffective('company.create')).toBe(true);
    context.currentUser = makeUser('Admin');
    expect(context.canEffective('company.create')).toBe(true);
  });

  test('Manager WITHOUT company.create is denied', () => {
    const { context } = buildSandbox();
    context.currentUser = makeUser('Manager', ['dashboard.view', 'sales.view']);
    expect(context.canEffective('company.create')).toBe(false);
  });

  test('Manager WITH company.create in effective permissions is allowed', () => {
    const { context } = buildSandbox();
    context.currentUser = makeUser('Manager', ['dashboard.view', 'company.create']);
    expect(context.canEffective('company.create')).toBe(true);
  });

  test('no session -> denied', () => {
    const { context } = buildSandbox();
    context.currentUser = null;
    expect(context.canEffective('company.create')).toBe(false);
  });
});

describe('frontend login company identity rendering', () => {
  test('selecting a company shows its name + default branch', () => {
    const { context, getEl } = buildSandbox();
    const company = {
      id: 'cairotech',
      name: 'CairoTech',
      code: 'CAIROTECH',
      branches: [{ id: 'MAIN', name: 'Main Branch', code: 'MAIN', isDefault: true }],
      defaultBranch: 'MAIN'
    };
    context.setCompanySelection(company);
    const box = getEl('loginCompanyIdentity');
    expect(box.style.display).toBe('block');
    expect(getEl('loginCompanyIdentityName').textContent).toBe('CairoTech');
    expect(getEl('loginCompanyIdentityBranch').textContent).toContain('Main Branch');
    // The hidden input carries only the id (internal contract), never shown as text.
    expect(getEl('loginCompanyId').value).toBe('cairotech');
  });

  test('a company without explicit branches falls back to defaultBranch label', () => {
    const { context, getEl } = buildSandbox();
    context.setCompanySelection({ id: 'nile', name: 'Nile Electronics', code: 'NILE', defaultBranch: 'MAIN' });
    expect(getEl('loginCompanyIdentity').style.display).toBe('block');
    expect(getEl('loginCompanyIdentityName').textContent).toBe('Nile Electronics');
    expect(getEl('loginCompanyIdentityBranch').textContent).toContain('MAIN');
  });

  test('clearing the selection hides the identity block', () => {
    const { context, getEl } = buildSandbox();
    context.setCompanySelection({ id: 'digi', name: 'DigiTronics' });
    expect(getEl('loginCompanyIdentity').style.display).toBe('block');
    context.setCompanySelection(null);
    expect(getEl('loginCompanyIdentity').style.display).toBe('none');
  });

  test('no company selected on load -> identity hidden', () => {
    const { context, getEl } = buildSandbox();
    context.renderLoginCompanyIdentity(null);
    expect(getEl('loginCompanyIdentity').style.display).toBe('none');
  });
});
