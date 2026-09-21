'use strict';

// frontendFailClosedMutations.test.js — fire-and-forget closure gate.
//
// Before this gate, every non-sales entity mutated the local mirror with a
// silent `try { await backendApi.<ent>.<verb>(...); } catch (_) {}` — a
// failed backend call still produced local success + saveDB(), so the next
// backend refresh resurrected deleted rows and lost updates. The handlers
// are now fail-closed: a failed/rejected backend mutation toasts an error,
// logs via logAppError, and returns BEFORE any local mutation, so there is
// no false success and no resurrection path.
//
// The REAL functions are extracted from DigiTronics_v5.html and run in a vm
// sandbox. Sales are intentionally excluded: they are protected by
// backendOpQueue + syncPendingSales, which this file also pins.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.resolve(__dirname, '..', '..', 'DigiTronics_v5.html');
const HTML = fs.readFileSync(HTML_PATH, 'utf8');

function extractFunction(name) {
  const re = new RegExp('(async\\s+)?function\\s+' + name + '\\s*\\(', 'g');
  const match = re.exec(HTML);
  if (!match) throw new Error('function not found: ' + name);
  const open = HTML.indexOf('{', match.index);
  let depth = 0;
  for (let i = open; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') {
      depth--;
      if (depth === 0) return HTML.slice(match.index, i + 1);
    }
  }
  throw new Error('unterminated function: ' + name);
}

// verb behavior: 'ok' -> {success:true,...} | 'fail' -> {success:false} |
// 'reject' -> throws (network failure)
function makeBackendApi(opts = {}) {
  const calls = [];
  const behavior = opts.behavior || {};
  const ents = ['inventory', 'suppliers', 'vouchers', 'users', 'customers', 'partners', 'employees', 'purchases', 'treasury', 'inventoryTransactions', 'sales'];
  const api = { _calls: calls };
  for (const ent of ents) {
    api[ent] = {};
    for (const verb of ['create', 'update', 'delete']) {
      api[ent][verb] = async (...args) => {
        const key = ent + '.' + verb;
        calls.push({ key, args });
        const mode = behavior[key] || 'ok';
        if (mode === 'reject') throw new Error('network down: ' + key);
        if (mode === 'fail') return { success: false, error: 'rejected by server' };
        return { success: true, data: { id: 'uuid-' + calls.length } };
      };
    }
  }
  return api;
}

function buildSandbox(opts = {}) {
  const calls = { toasts: [], appErrors: [] };
  const db = {
    products: (opts.products || []).map(r => ({ ...r })),
    serials: (opts.serials || []).map(r => ({ ...r })),
    suppliers: (opts.suppliers || []).map(r => ({ ...r })),
    vouchers: (opts.vouchers || []).map(r => ({ ...r })),
    users: (opts.users || []).map(r => ({ ...r }))
  };
  const context = {
    console,
    DB: db,
    USE_BACKEND: opts.useBackend !== false,
    backendApi: makeBackendApi(opts),
    currentUser: { username: 'owner-1', role: 'Owner' },
    confirm: () => (opts.confirmResult !== undefined ? opts.confirmResult : true),
    requirePermission: () => true,
    isOwnerUser: () => true,
    saveDB: () => { calls.saveDB = (calls.saveDB || 0) + 1; },
    logProductChange: () => {},
    logActivity: () => {},
    logAppError: (action, error) => { calls.appErrors.push({ action, message: error && error.message }); },
    renderProductsTable: () => {},
    renderSuppliers: () => {},
    renderVouchers: () => {},
    renderUsers: () => {},
    showToast: (msg, kind) => { calls.toasts.push({ msg: String(msg), kind: kind || '' }); }
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  return { context, db, calls };
}

function loadFns(context, names) {
  for (const n of names) vm.runInContext(extractFunction(n) + `\n;globalThis.${n} = ${n};`, context, { filename: 'DigiTronics_v5.html-' + n + '.js' });
}

const ERR_TOAST = 'تعذر تنفيذ العملية على الخادم';

describe('fail-closed backend mutations (real DigiTronics_v5.html functions)', () => {
  test('deleteProduct: backend success removes the local row and its serials', async () => {
    const { context, db } = buildSandbox({
      products: [{ id: 'p1', _backendId: 'uuid-p1', name: 'Prod' }],
      serials: [{ serial: 'S1', productId: 'p1' }, { serial: 'S2', productId: 'other' }]
    });
    loadFns(context, ['deleteProduct']);
    await context.deleteProduct('p1');
    expect(db.products).toHaveLength(0);
    expect(db.serials.map(s => s.serial)).toEqual(['S2']);
  });

  test('deleteProduct: backend FAILURE keeps the local record (no false success, no resurrection)', async () => {
    const { context, db, calls } = buildSandbox({
      products: [{ id: 'p1', _backendId: 'uuid-p1', name: 'Prod' }],
      serials: [{ serial: 'S1', productId: 'p1' }],
      behavior: { 'inventory.delete': 'fail' }
    });
    loadFns(context, ['deleteProduct']);
    await context.deleteProduct('p1');
    expect(db.products).toHaveLength(1); // recoverable local record
    expect(db.serials).toHaveLength(1);
    expect(calls.saveDB).toBeUndefined(); // nothing persisted as success
    expect(calls.toasts.some(t => t.kind === 'error' && t.msg.includes(ERR_TOAST))).toBe(true);
    expect(calls.appErrors.some(e => e.action === 'inventory.delete')).toBe(true);
  });

  test('deleteProduct: backend REJECTION (network) also keeps the local record', async () => {
    const { context, db, calls } = buildSandbox({
      products: [{ id: 'p1', _backendId: 'uuid-p1', name: 'Prod' }],
      behavior: { 'inventory.delete': 'reject' }
    });
    loadFns(context, ['deleteProduct']);
    await expect(context.deleteProduct('p1')).rejects.toThrow('network down');
    expect(db.products).toHaveLength(1);
    expect(calls.saveDB).toBeUndefined();
  });

  test('deleteSupplier: backend delete runs BEFORE the local splice (failure keeps the row)', async () => {
    const { context, db, calls } = buildSandbox({
      suppliers: [{ id: 's1', _backendId: 'uuid-s1', name: 'Sup' }],
      behavior: { 'suppliers.delete': 'fail' }
    });
    loadFns(context, ['deleteSupplier']);
    await context.deleteSupplier(0);
    expect(db.suppliers).toHaveLength(1);
    expect(calls.toasts.some(t => t.kind === 'error' && t.msg.includes(ERR_TOAST))).toBe(true);
    expect(calls.appErrors.some(e => e.action === 'suppliers.delete')).toBe(true);
  });

  test('deleteSupplier: backend success removes the local row', async () => {
    const { context, db } = buildSandbox({
      suppliers: [{ id: 's1', _backendId: 'uuid-s1', name: 'Sup' }, { id: 's2', name: 'Other' }]
    });
    loadFns(context, ['deleteSupplier']);
    await context.deleteSupplier(0);
    expect(db.suppliers.map(s => s.id)).toEqual(['s2']);
  });

  test('deleteVoucher: backend FAILURE keeps the voucher; success removes it', async () => {
    const failing = buildSandbox({
      vouchers: [{ id: 'v1', _backendId: 'uuid-v1' }],
      behavior: { 'vouchers.delete': 'fail' }
    });
    loadFns(failing.context, ['deleteVoucher']);
    await failing.context.deleteVoucher('v1');
    expect(failing.db.vouchers).toHaveLength(1);
    expect(failing.calls.toasts.some(t => t.kind === 'error' && t.msg.includes(ERR_TOAST))).toBe(true);

    const ok = buildSandbox({
      vouchers: [{ id: 'v1', _backendId: 'uuid-v1' }, { id: 'v2', name: 'keepme' }]
    });
    loadFns(ok.context, ['deleteVoucher']);
    await ok.context.deleteVoucher('v1');
    expect(ok.db.vouchers.map(v => v.id)).toEqual(['v2']);
  });

  test('deleteUser: backend FAILURE keeps the user; success removes it', async () => {
    const failing = buildSandbox({
      users: [{ username: 'bob', _backendId: 'uuid-u1' }],
      behavior: { 'users.delete': 'fail' }
    });
    loadFns(failing.context, ['deleteUser']);
    await failing.context.deleteUser('bob');
    expect(failing.db.users).toHaveLength(1);
    expect(failing.calls.toasts.some(t => t.kind === 'error' && t.msg.includes(ERR_TOAST))).toBe(true);
    expect(failing.calls.appErrors.some(e => e.action === 'users.delete')).toBe(true);

    const ok = buildSandbox({
      users: [{ username: 'bob', _backendId: 'uuid-u1' }, { username: 'alice' }]
    });
    loadFns(ok.context, ['deleteUser']);
    await ok.context.deleteUser('bob');
    expect(ok.db.users.map(u => u.username)).toEqual(['alice']);
  });

  test('USE_BACKEND=false keeps legacy local-first behavior (no backend calls)', async () => {
    const { context, db, calls } = buildSandbox({
      products: [{ id: 'p1', name: 'Prod' }],
      useBackend: false
    });
    loadFns(context, ['deleteProduct']);
    await context.deleteProduct('p1');
    expect(db.products).toHaveLength(0);
    expect(calls.toasts.some(t => t.kind === 'error')).toBe(false);
  });

  test('destructive ordering: backend mutation precedes every local mutation in the hardened delete handlers', () => {
    for (const [fn, backendNeedle, localNeedle] of [
      ['deleteSupplier', 'backendApi.suppliers.delete', 'DB.suppliers.splice'],
      ['deleteVoucher', 'backendApi.vouchers.delete', 'DB.vouchers = (DB.vouchers || []).filter'],
      ['deleteProduct', 'backendApi.inventory.delete', 'DB.products = DB.products.filter'],
      ['deleteUser', 'backendApi.users.delete', 'DB.users = DB.users.filter']
    ]) {
      const body = extractFunction(fn);
      const b = body.indexOf(backendNeedle);
      const l = body.indexOf(localNeedle);
      expect(b).toBeGreaterThan(-1);
      expect(l).toBeGreaterThan(-1);
      expect(b).toBeLessThan(l);
    }
  });

  test('no silent swallow remains outside sales; sales still go through backendOpQueue', () => {
    const silent = [...HTML.matchAll(/try \{ await backendApi\.(\w+)\.(update|delete|create)\([^)]*\); \} catch \(_\) \{\}/g)].map(m => m[1] + '.' + m[2]);
    for (const site of silent) expect(site.startsWith('sales.')).toBe(true);
    expect(HTML).toContain("backendOpQueue.enqueue({ type: 'delete'");
    expect(HTML).toContain("backendOpQueue.enqueue({ type: 'update'");
  });
});
