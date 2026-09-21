'use strict';

// frontendBackendHydration.test.js — Phase 23B render hydration contract.
//
// The Phase 23B render functions display rows straight from the backend API.
// Hydrating the local mirror naively with a blind replace (DB.x = rows.slice())
// silently DROPS local records the backend does not have yet — records whose
// create failed or is still pending (offline, backend restart, validation).
// Those rows would vanish from the UI while still living in saveDB().
//
// mergeBackendRows (real function extracted from index.html) pins the merge
// contract: backend rows win, pending local records stay visible, nulls and
// non-objects are ignored, and records the backend now owns are not duplicated.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.resolve(__dirname, '..', '..', 'index.html');
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

const merge = (() => {
  const context = { console, Set };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(extractFunction('mergeBackendRows'), context, { filename: 'index.html-mergeBackendRows.js' });
  return context.mergeBackendRows;
})();

describe('mergeBackendRows (real index.html function) — hydration keeps pending local records', () => {
  test('backend rows win and pending local records stay appended (no data loss)', () => {
    const local = [
      { id: 'a', _syncedToBackend: true },
      { id: 'b', name: 'pending-local' },
      { id: 'c', _backendId: 'x', _syncedToBackend: false }
    ];
    const backend = [{ id: 'a', name: 'fromAPI' }, { id: 'x', name: 'matched by backendId' }];
    const out = merge(local, backend);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ id: 'a', name: 'fromAPI' });
    expect(out[1]).toEqual({ id: 'x', name: 'matched by backendId' });
    expect(out[2]).toEqual({ id: 'b', name: 'pending-local' });
  });

  test('offline / failed backend keeps every local record visible', () => {
    const local = [{ id: 'p1', name: 'made offline' }];
    expect(merge(local, [])).toEqual(local);
    expect(merge(local, null)).toEqual(local);
  });

  test('a local record the backend now owns (same id) is not duplicated', () => {
    const local = [{ id: 'a', name: 'local stale copy' }];
    const out = merge(local, [{ id: 'a', name: 'fromAPI' }]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('fromAPI');
  });

  test('synced local records are dropped once the backend represents them', () => {
    const local = [
      { id: 'a', _syncedToBackend: true },
      { id: 'z', _syncedToBackend: true, name: 'only local storage' }
    ];
    const out = merge(local, [{ id: 'a' }]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
  });

  test('null entries and non-objects are ignored on both sides', () => {
    expect(merge(null, [null, { id: 'a' }])).toEqual([{ id: 'a' }]);
    expect(merge([null, 'x', { id: 'p' }], [])).toEqual([{ id: 'p' }]);
    expect(merge([], [])).toEqual([]);
  });

  test('the phase 23B render functions use the safe merge (no blind .slice() replaces)', () => {
    // Regressions to `DB.x = rows.slice()` would re-introduce silent data loss.
    expect(HTML.includes('DB.products = mergeBackendRows(DB.products, products)')).toBe(true);
    expect(HTML.includes('DB.suppliers = mergeBackendRows(DB.suppliers, suppliers)')).toBe(true);
    expect(HTML.includes('DB.customers = mergeBackendRows(DB.customers, customers)')).toBe(true);
    expect(HTML.includes('DB.employees = mergeBackendRows(DB.employees, employees)')).toBe(true);
    expect(HTML.includes('DB.partners = mergeBackendRows(DB.partners, partners)')).toBe(true);
    expect(HTML.includes('DB.vouchers = mergeBackendRows(DB.vouchers, vouchers)')).toBe(true);
    expect(HTML.includes('DB.products = products.slice()')).toBe(false);
    expect(HTML.includes('DB.employees = employees.slice()')).toBe(false);
    expect(HTML.includes('DB.partners = partners.slice()')).toBe(false);
    expect(HTML.includes('DB.vouchers = vouchers.slice()')).toBe(false);
    expect(HTML.includes('DB.customers = customers.slice()')).toBe(false);
    expect(HTML.includes('DB.suppliers = suppliers.slice()')).toBe(false);
  });
});
