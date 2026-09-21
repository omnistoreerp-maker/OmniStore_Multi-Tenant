'use strict';

// frontendTreasuryReversal.test.js — treasury reversal backend-mode gate.
//
// Two shipped defects made the reverse action data-destructive in backend
// mode:
//   1. DEAD/WRONG ADDRESSING: renderTreasuryReverseAction inlined
//      Number(c.id) || 0 into the onclick — a backend UUID collapses to 0 —
//      and reverseTreasuryEntry looked the row up with Number comparisons
//      against a mirror that never contained API rows.
//   2. DATA-DESTRUCTIVE ORDERING: the original entry was deleted from the
//      backend BEFORE the final confirm(summary). A user who entered the PIN
//      and then cancelled destroyed the backend record with no opposite
//      entry — and even a confirmed reversal diverged the backend ledger
//      (delete + opposite = negative net) from the local one (original kept
//      + opposite = net zero).
//
// The REAL functions are extracted from index.html and run in a vm sandbox.
// The pinned contract: exactly one backend mutation (creating the opposite
// entry), strictly after the final confirmation; backend failure keeps the
// local mirror untouched; cancel at any stage mutates nothing.

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

function elementStub() {
  return {
    style: {}, value: '', textContent: '', innerHTML: '', display: '',
    appendChild: () => {}, addEventListener: () => {}, querySelectorAll: () => [], dataset: {}
  };
}

// Scripted prompt answers: prompt(label) returns the value of the first
// rule whose expectedText appears in the label (then is consumed).
function makePromptScript(rules) {
  const queue = rules.slice();
  return (label) => {
    const idx = queue.findIndex(r => label.includes(r.expectedText));
    if (idx === -1) return null;
    const [hit] = queue.splice(idx, 1);
    return hit.value;
  };
}

function buildSandbox(opts = {}) {
  const calls = { backendCreate: [], backendDelete: [], toasts: [], appErrors: [] };
  const db = {
    cashFlow: (opts.cashFlow || []).map(r => ({ ...r })),
    settings: {
      ownerOverridePin: '1948654',
      reversePinThreshold: opts.reversePinThreshold != null ? opts.reversePinThreshold : 3000,
      reversePinFailCount: 0,
      reversePinLockUntil: ''
    },
    reversePinAttempts: []
  };
  const context = {
    console,
    DB: db,
    USE_BACKEND: true,
    backendApi: {
      treasury: {
        create: (data) => {
          calls.backendCreate.push(data);
          if (opts.backendCreateFails) return Promise.resolve({ success: false, error: opts.backendCreateError || 'rejected' });
          return Promise.resolve({ success: true, data: { id: 'uuid-new-' + calls.backendCreate.length } });
        },
        delete: (id) => { calls.backendDelete.push(String(id)); return Promise.resolve({ success: true }); }
      }
    },
    currentUser: opts.currentUser || { username: 'owner-1', role: 'Owner' },
    ensureSensitiveOpsAllowed: () => true,
    normalizeTreasuryEntry: (row = {}) => {
      const type = row.type === 'out' ? 'out' : 'in';
      const amount = parseFloat(row.amount) || 0;
      const method = row.method || 'cash';
      const balance = row.balance != null ? parseFloat(row.balance) : NaN;
      return { ...row, type, amount, method, balance };
    },
    toSafeFloat: (v, fallback = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; },
    toSafeInt: (v, fallback = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : fallback; },
    getPaymentLabel: (m) => (m === 'cash' ? 'cash-label' : String(m)),
    formatMoney: (n) => 'EGP ' + (n || 0),
    localDateTimeString: () => '2026-09-21T10:00:00',
    prompt: makePromptScript(opts.prompts || []),
    confirm: () => (opts.confirmResult !== undefined ? opts.confirmResult : true),
    saveDB: () => {},
    logActivity: () => {},
    logAppError: (action, error) => { calls.appErrors.push({ action, message: error && error.message }); },
    renderTreasury: () => {},
    showToast: (msg, kind) => { calls.toasts.push({ msg: String(msg), kind: kind || '' }); },
    document: { getElementById: () => elementStub() }
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(extractFunction('reverseTreasuryEntry'), context, { filename: 'index.html-reverseTreasuryEntry.js' });
  return { context, db, calls };
}

const ADMIN = { username: 'admin-1', role: 'Admin' }; // PIN required for non-Owner

describe('frontend treasury reversal backend-mode gate (real index.html functions)', () => {
  test('backend UUID row is addressed by its raw id (no Number() collapse) and is reversible', async () => {
    const uuid = '2c9fd6f0-93ab-4c1e-9d2b-7f6e5a4b3c2d';
    const { context, db, calls } = buildSandbox({
      cashFlow: [{ id: uuid, _backendId: uuid, type: 'in', amount: 500, method: 'cash', desc: 'API row' }],
      reversePinThreshold: 3000,
      currentUser: ADMIN,
      prompts: [
        { expectedText: 'سبب الاسترجاع', value: 'خطأ في الإدخال' },
        { expectedText: 'PIN المالك', value: '1948654' }
      ]
    });
    await context.reverseTreasuryEntry(uuid);
    expect(calls.backendCreate).toHaveLength(1);
    expect(calls.backendCreate[0].type).toBe('out');
    expect(calls.backendCreate[0].reversalOf).toBe(uuid);
    expect(calls.backendDelete).toHaveLength(0);
    expect(db.cashFlow).toHaveLength(2);
  });

  test('backend row missing from the local mirror resolves through its backend id', async () => {
    const { context, db, calls } = buildSandbox({
      cashFlow: [{ id: 'local-1', _backendId: 'uuid-row-9', type: 'out', amount: 120, method: 'cash', desc: 'X' }],
      reversePinThreshold: 999999,
      prompts: [{ expectedText: 'سبب الاسترجاع', value: 'استرجاع صف API' }]
    });
    // The onclick only carries the backend id (row rendered from the API).
    await context.reverseTreasuryEntry('uuid-row-9');
    expect(calls.backendCreate).toHaveLength(1);
    expect(calls.backendCreate[0].reversalOf).toBe('local-1');
    expect(calls.backendDelete).toHaveLength(0);
    expect(db.cashFlow).toHaveLength(2);
  });

  test('NO backend mutation before the final confirm: cancel after PIN leaves the backend untouched', async () => {
    const { context, db, calls } = buildSandbox({
      cashFlow: [{ id: 'row-2', _backendId: 'uuid-row-2', type: 'in', amount: 9000, method: 'cash', desc: 'big' }],
      confirmResult: false, // user cancels the FINAL summary confirm
      reversePinThreshold: 3000,
      currentUser: ADMIN, // forces the PIN path before the summary
      prompts: [
        { expectedText: 'سبب الاسترجاع', value: 'سبب صالح' },
        { expectedText: 'PIN المالك', value: '1948654' }
      ]
    });
    await context.reverseTreasuryEntry('row-2');
    expect(calls.backendCreate).toHaveLength(0);
    expect(calls.backendDelete).toHaveLength(0);
    expect(db.cashFlow).toHaveLength(1);
    expect(db.cashFlow[0].reversedBy).toBeUndefined();
  });

  test('confirmed reversal performs exactly ONE backend mutation: create opposite, never delete', async () => {
    const { context, db, calls } = buildSandbox({
      cashFlow: [{ id: 'row-3', _backendId: 'uuid-row-3', type: 'in', amount: 200, method: 'cash', desc: 'ok' }],
      confirmResult: true,
      reversePinThreshold: 999999,
      prompts: [{ expectedText: 'سبب الاسترجاع', value: 'تحتاج عكس' }]
    });
    await context.reverseTreasuryEntry('row-3');
    expect(calls.backendCreate).toHaveLength(1);
    expect(calls.backendCreate[0].type).toBe('out');
    expect(calls.backendCreate[0].amount).toBe(200);
    expect(calls.backendCreate[0].reversalOf).toBe('row-3');
    expect(calls.backendDelete).toHaveLength(0);
    expect(db.cashFlow).toHaveLength(2);
    expect(db.cashFlow.find(r => r.id === 'row-3').reversedBy).toBeDefined();
  });

  test('failed backend mutation preserves the local record (no false local-only reversal)', async () => {
    const { context, db, calls } = buildSandbox({
      cashFlow: [{ id: 'row-4', _backendId: 'uuid-row-4', type: 'in', amount: 300, method: 'cash', desc: 'fail path' }],
      confirmResult: true,
      backendCreateFails: true,
      reversePinThreshold: 999999,
      prompts: [{ expectedText: 'سبب الاسترجاع', value: 'سبب الفشل' }]
    });
    await context.reverseTreasuryEntry('row-4');
    expect(calls.backendCreate).toHaveLength(1);
    expect(db.cashFlow).toHaveLength(1);
    const original = db.cashFlow[0];
    expect(original.reversedBy).toBeUndefined();
    expect(original.reversedAt).toBeUndefined();
    expect(calls.toasts.some(t => t.kind === 'error')).toBe(true);
    expect(calls.appErrors.some(e => e.action === 'treasury.reverse')).toBe(true);
  });

  test('wrong PIN aborts with zero backend mutations', async () => {
    const { context, db, calls } = buildSandbox({
      cashFlow: [{ id: 'row-5', _backendId: 'uuid-row-5', type: 'in', amount: 9500, method: 'cash', desc: 'pin gate' }],
      confirmResult: true,
      reversePinThreshold: 3000,
      currentUser: ADMIN,
      prompts: [
        { expectedText: 'سبب الاسترجاع', value: 'سبب' },
        { expectedText: 'PIN المالك', value: 'wrong-pin' }
      ]
    });
    await context.reverseTreasuryEntry('row-5');
    expect(calls.backendCreate).toHaveLength(0);
    expect(calls.backendDelete).toHaveLength(0);
    expect(db.cashFlow).toHaveLength(1);
  });

  test('renderTreasuryReverseAction keeps the raw id in the onclick (UUID-safe)', () => {
    const fn = extractFunction('renderTreasuryReverseAction');
    expect(fn).not.toMatch(/Number\(c\.id\)/);
    expect(fn).toContain("String(c.id ?? (c._backendId ?? ''))");
  });
});
