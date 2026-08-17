'use strict';

// Frontend tenant-scoping hardening regression tests (CairoTech isolation).
//
// The scoped-localStorage logic lives INSIDE index.html. These tests extract
// the REAL functions from the shipped source (not a reimplementation) and
// evaluate them against a mock localStorage, verifying:
//
//   A. Login as VerifyCo  -> JWT tenantId=verifyco  -> key cairo_db_v7_verifyco
//   B. Login as BetaCo    -> JWT tenantId=betaco    -> key cairo_db_v7_betaco
//   C. While logged in as BetaCo, forcing ACTIVE_TENANT_ID to "verifyco" must
//      NOT redirect local DB reads away from cairo_db_v7_betaco.
//   D. VerifyCo data never appears in BetaCo's scoped summary/key.
//   E. Logout then login as another company rebinds to the correct scope.
//   F. Legacy cairo_db_v7 behavior is preserved when NO authenticated tenant
//      context exists.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.resolve(__dirname, '..', '..', 'index.html');

// ---- extract real function/const source blocks from index.html ------------
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

function extractConst(source, name) {
  const re = new RegExp('const\\s+' + name + '\\s*=\\s*[^;]+;', 'g');
  const m = re.exec(source);
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

// ---- build a sandbox with the real frontend functions ----------------------
function buildSandbox(stored = {}) {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const store = Object.assign({}, stored);

  // NOTE: `var` (not the source's `let`) so the mutable binding is reachable
  // from the test context — the vm global-object property is what direct
  // tampering targets in scenario C. Runtime behavior is identical.
  const code = [
    extractConst(html, 'DB_KEY'),
    'var ACTIVE_TENANT_ID = null;',
    extractFunction(html, 'jwtTenantId'),
    extractFunction(html, 'getJwtTenantId'),
    extractFunction(html, 'getEffectiveTenantId'),
    extractFunction(html, 'getDbStorageKey'),
    extractFunction(html, 'setActiveTenantId')
  ].join('\n');

  const context = {
    console,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    // stubs required by setActiveTenantId's changed-branch
    resetDBToPristine: () => {},
    loadDB: () => {},
    applyBusinessBranding: () => {}
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'index.html-scoping.js' });
  return { context, store };
}

// ---- JWT helpers (base64url payload) ---------------------------------------
function makeToken(tenantId) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return enc({ alg: 'HS256' }) + '.' + enc({ tenantId }) + '.' + 'sig';
}

describe('frontend tenant scoping (JWT-authoritative)', () => {
  test('A. login as VerifyCo -> JWT tenantId=verifyco -> cairo_db_v7_verifyco', () => {
    const { context, store } = buildSandbox();
    store.access_token = makeToken('verifyco');
    context.setActiveTenantId('verifyco');
    expect(context.getDbStorageKey()).toBe('cairo_db_v7_verifyco');
    expect(context.ACTIVE_TENANT_ID).toBe('verifyco');
  });

  test('B. login as BetaCo -> JWT tenantId=betaco -> cairo_db_v7_betaco', () => {
    const { context, store } = buildSandbox();
    store.access_token = makeToken('betaco');
    context.setActiveTenantId('betaco');
    expect(context.getDbStorageKey()).toBe('cairo_db_v7_betaco');
    expect(context.ACTIVE_TENANT_ID).toBe('betaco');
  });

  test('C. BetaCo session: forcing ACTIVE_TENANT_ID to verifyco must NOT redirect reads', () => {
    const { context, store } = buildSandbox();
    store.access_token = makeToken('betaco');
    context.setActiveTenantId('betaco');
    // Tamper attempt through the setter.
    context.setActiveTenantId('verifyco');
    // The JWT wins: ACTIVE_TENANT_ID is corrected back to betaco and the
    // storage key stays in BetaCo's scope.
    expect(context.ACTIVE_TENANT_ID).toBe('betaco');
    expect(context.getDbStorageKey()).toBe('cairo_db_v7_betaco');
    // Direct assignment (bypassing the setter) must also not redirect reads.
    context.ACTIVE_TENANT_ID = 'verifyco';
    expect(context.getDbStorageKey()).toBe('cairo_db_v7_betaco');
  });

  test('D. VerifyCo data never appears in BetaCo summary/key', () => {
    const { context, store } = buildSandbox();
    store.access_token = makeToken('betaco');
    context.setActiveTenantId('betaco');
    // Simulate only VerifyCo having scoped data.
    store['cairo_db_v7_verifyco'] = JSON.stringify({ cashFlow: [{ amount: 1500, tenantId: 'verifyco' }] });
    store['cairo_db_v7_betaco'] = JSON.stringify({ cashFlow: [] });
    // getDbStorageKey must resolve to BetaCo's key even though VerifyCo's
    // key exists and ACTIVE_TENANT_ID is (incorrectly) forced to verifyco.
    context.ACTIVE_TENANT_ID = 'verifyco';
    expect(context.getDbStorageKey()).toBe('cairo_db_v7_betaco');
    const db = JSON.parse(store[context.getDbStorageKey()]);
    expect(Array.isArray(db.cashFlow) ? db.cashFlow.length : 0).toBe(0);
  });

  test('E. logout then login as another company rebinds to the correct scope', () => {
    const { context, store } = buildSandbox();
    store.access_token = makeToken('betaco');
    context.setActiveTenantId('betaco');
    expect(context.getDbStorageKey()).toBe('cairo_db_v7_betaco');
    // Logout clears credentials and tenant context (tokens removed first).
    delete store.access_token;
    context.setActiveTenantId(null);
    expect(context.ACTIVE_TENANT_ID).toBe(null);
    expect(context.getDbStorageKey()).toBe('cairo_db_v7'); // legacy namespace
    // Login as VerifyCo -> rebinds to verifyco scope.
    store.access_token = makeToken('verifyco');
    context.setActiveTenantId('verifyco');
    expect(context.getDbStorageKey()).toBe('cairo_db_v7_verifyco');
  });

  test('F. legacy behavior preserved when no authenticated tenant context', () => {
    const { context, store } = buildSandbox();
    // No access_token, no tenant -> legacy global key.
    expect(context.getDbStorageKey()).toBe('cairo_db_v7');
    // No access_token but a legacy company-selected id (pre-Phase-19 flow).
    context.setActiveTenantId('digitronics');
    expect(context.getDbStorageKey()).toBe('cairo_db_v7_digitronics');
    expect(context.ACTIVE_TENANT_ID).toBe('digitronics');
  });
});
