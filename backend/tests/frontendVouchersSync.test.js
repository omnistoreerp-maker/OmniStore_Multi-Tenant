'use strict';

// frontendVouchersSync.test.js — vouchers page backend-mode regression.
//
// Same defect class as employees/partners: renderVouchers() rendered rows
// from the API without hydrating the local mirror, and deleteVoucher()
// only called the backend when the record still carried _backendId — so
// vouchers with lost sync flags resurrected on every reload. The REAL
// deleteVoucher function is extracted from index.html and run in a sandbox.

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

function buildVoucherSandbox(opts = {}) {
  const db = { vouchers: opts.dbVouchers || [] };
  const context = {
    console,
    DB: db,
    USE_BACKEND: true,
    backendApi: opts.backendApi || { vouchers: {} },
    requirePermission: () => true,
    confirm: () => true,
    saveDB: () => {},
    renderVouchers: () => {},
    showToast: () => {},
    document: { getElementById: () => null }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(extractFunction('deleteVoucher'), context, { filename: 'index.html-vouchers-sync.js' });
  return { context, db };
}

describe('frontend vouchers backend-mode sync (real index.html function)', () => {
  test('deleteVoucher falls back to the legacy id when _backendId is lost (no resurrection)', async () => {
    const deleted = [];
    const backendApi = { vouchers: { delete: (id) => { deleted.push(String(id)); return Promise.resolve({ success: true }); } } };
    const { context, db } = buildVoucherSandbox({
      dbVouchers: [{ id: 'V-7', type: 'receipt', amount: 100, partyName: 'Sync Lost' }],
      backendApi
    });
    await context.deleteVoucher('V-7');
    expect(deleted).toEqual(['V-7']);
    expect(db.vouchers.length).toBe(0);
  });

  test('deleteVoucher prefers _backendId when present', async () => {
    const deleted = [];
    const backendApi = { vouchers: { delete: (id) => { deleted.push(String(id)); return Promise.resolve({ success: true }); } } };
    const { context } = buildVoucherSandbox({
      dbVouchers: [{ id: 'V-2', _backendId: 'uuid-42', type: 'payment', amount: 50, partyName: 'Synced' }],
      backendApi
    });
    await context.deleteVoucher('V-2');
    expect(deleted).toEqual(['uuid-42']);
  });

  test('deleteVoucher resolves a record addressed by its backend id', async () => {
    // After hydration the row onclick may carry the backend id itself; the
    // lookup must not miss it (previously v.id === id only).
    const deleted = [];
    const backendApi = { vouchers: { delete: (id) => { deleted.push(String(id)); return Promise.resolve({ success: true }); } } };
    const { context, db } = buildVoucherSandbox({
      dbVouchers: [{ id: 'V-3', _backendId: 'uuid-9', type: 'receipt', amount: 10, partyName: 'X' }],
      backendApi
    });
    await context.deleteVoucher('uuid-9');
    expect(deleted).toEqual(['uuid-9']);
    expect(db.vouchers.length).toBe(0);
  });

  test('renderVouchers hydrates the DB mirror from the API response', () => {
    // Deletion is id-based against DB.vouchers; without hydration it operates
    // on stale local records while the grid shows API rows.
    expect(HTML.includes('DB.vouchers = vouchers.slice()')).toBe(true);
  });
});
