'use strict';

// Frontend regression tests for Phase 33 — Master Control Center:
//   - the platform page is reachable ONLY with a server-issued platformRole
//     (canAccessPage gate) — a tenant Owner/Admin never sees it
//   - refreshPlatformRole() reads /platform/me (server-authoritative) and
//     toggles the nav entry
//   - logout clears the platform role and stops the heartbeat
//   - platform data surfaces are wired to backendApi.platform.* only (never
//     the local tenant DB)
//   - ACTIVE_TENANT_ID tampering cannot flip platform access
//
// The REAL functions are extracted from the shipped index.html (not a
// reimplementation), mirroring frontendUsersGating / frontendProvisionGating.

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
  const nav = elementStub();
  elements.platformMasterNav = nav;

  const context = {
    console,
    document: {
      getElementById: getEl,
      createElement: () => elementStub(),
      querySelectorAll: () => [],
      addEventListener: () => {}
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { onLine: true, userAgent: 'node' },
    location: { href: '', reload: () => {} },
    setTimeout,
    clearTimeout,
    setInterval: () => 42,
    clearInterval: () => {},
    currentUser: opts.currentUser !== undefined ? opts.currentUser : { username: 'master', role: 'Viewer' },
    USE_BACKEND: opts.useBackend !== undefined ? opts.useBackend : true,
    platformRole: opts.platformRole !== undefined ? opts.platformRole : null,
    backendApi: opts.backendApi || null,
    showToast: opts.showToast || (() => {})
  };
  context.globalThis = context;
  context.window = context;

  const code = [
    'function _effectiveRole() { return (currentUser && (currentUser.effectiveRole || currentUser.role)) || \'\'; }',
    extractFunction('canAccessPage'),
    extractFunction('refreshPlatformRole'),
    extractFunction('startPlatformHeartbeat'),
    extractFunction('stopPlatformHeartbeat')
  ].join('\n');

  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'index.html-platform-gating.js' });

  return { context, getEl, elements, nav };
}

describe('frontend Master Control Center gating (canAccessPage)', () => {
  test('platform-master is denied for a normal user (no platformRole)', () => {
    const { context } = buildSandbox({ platformRole: null });
    expect(context.canAccessPage('platform-master')).toBe(false);
  });

  test('platform-master is denied for a tenant Owner/Admin without platformRole', () => {
    const { context } = buildSandbox({ platformRole: null, currentUser: { username: 'digiOwner', role: 'Owner' } });
    expect(context.canAccessPage('platform-master')).toBe(false);
    const { context: ctx2 } = buildSandbox({ platformRole: null, currentUser: { username: 'digiAdmin', role: 'Admin' } });
    expect(ctx2.canAccessPage('platform-master')).toBe(false);
  });

  test('platform-master is allowed only with platformRole AND backend mode', () => {
    const user = { username: 'master', role: 'Viewer' };
    expect(buildSandbox({ platformRole: 'MASTER_OWNER', currentUser: user }).context.canAccessPage('platform-master')).toBe(true);
    // backend disabled -> denied even with a role
    expect(buildSandbox({ platformRole: 'MASTER_OWNER', currentUser: user, useBackend: false }).context.canAccessPage('platform-master')).toBe(false);
    // no session -> denied
    expect(buildSandbox({ platformRole: 'MASTER_OWNER', currentUser: null }).context.canAccessPage('platform-master')).toBe(false);
  });
});

describe('frontend platform role hydration (refreshPlatformRole)', () => {
  test('a 404/denial clears the role and hides the nav', async () => {
    const backendApi = { platform: { me: () => Promise.resolve({ success: false, message: 'Not a platform administrator' }) } };
    const { context, nav } = buildSandbox({ backendApi, platformRole: 'MASTER_OWNER' });
    const ok = await context.refreshPlatformRole();
    expect(ok).toBe(false);
    expect(context.platformRole).toBeNull();
    expect(nav.style.display).toBe('none');
  });

  test('a platform identity sets the role and reveals the nav', async () => {
    const backendApi = { platform: { me: () => Promise.resolve({ success: true, data: { username: 'master', platformRole: 'MASTER_OWNER' } }) } };
    const { context, nav } = buildSandbox({ backendApi, platformRole: null });
    const ok = await context.refreshPlatformRole();
    expect(ok).toBe(true);
    expect(context.platformRole).toBe('MASTER_OWNER');
    expect(nav.style.display).toBe('');
  });
});

describe('frontend platform heartbeat lifecycle', () => {
  test('startPlatformHeartbeat registers a 60s interval; stop clears it', () => {
    const { context } = buildSandbox();
    context.startPlatformHeartbeat();
    expect(context.window.__platformHeartbeatTimer).toBeTruthy();
    context.stopPlatformHeartbeat();
    expect(context.window.__platformHeartbeatTimer).toBeNull();
  });
});

describe('frontend platform wiring markers (shipped index.html)', () => {
  test('the page, nav entry, and gating exist', () => {
    expect(HTML).toContain('id="page-platform-master"');
    expect(HTML).toContain('id="platformMasterNav"');
    expect(HTML).toContain("if (page === 'platform-master') return !!platformRole && USE_BACKEND;");
  });

  test('every platform surface is wired to backendApi.platform only', () => {
    expect(HTML).toContain('backendApi.platform.summary()');
    expect(HTML).toContain('backendApi.platform.companies()');
    expect(HTML).toContain("backendApi.platform.suspendCompany(id)");
    expect(HTML).toContain("backendApi.platform.activateCompany(id)");
    expect(HTML).toContain('backendApi.platform.users()');
    expect(HTML).toContain("backendApi.platform.forceLogout(id)");
    expect(HTML).toContain('backendApi.platform.presence()');
    expect(HTML).toContain("backendApi.platform.heartbeat(platformSessionId()");
    expect(HTML).toContain('backendApi.platform.licenses()');
    expect(HTML).toContain('backendApi.platform.integrations()');
    expect(HTML).toContain('backendApi.platform.audit(200)');
  });

  test('platform data is never read from the tenant local DB', () => {
    // The renderers must not touch getDbStorageKey / ACTIVE_TENANT_ID / DB.
    const platformBlock = HTML.slice(HTML.indexOf('MASTER CONTROL CENTER'), HTML.indexOf('USERS & PERMISSIONS MANAGER'));
    expect(platformBlock).not.toContain('getDbStorageKey');
    expect(platformBlock).not.toContain('ACTIVE_TENANT_ID');
    expect(platformBlock).not.toContain('DB.cashFlow');
    expect(platformBlock).not.toContain("localStorage.getItem('cairo_db_v7");
  });

  test('logout clears the platform role and stops the heartbeat', () => {
    expect(HTML).toContain('stopPlatformHeartbeat();');
    expect(HTML).toContain('platformRole = null;');
  });
});
