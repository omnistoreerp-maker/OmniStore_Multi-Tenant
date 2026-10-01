'use strict';

// frontendPartnersSync.test.js — partners page backend-mode regression.
//
// Same defect class as the employees page: renderPartners() rendered rows
// from the API without hydrating the local mirror, and deletePartner()
// only called the backend when the record still carried _backendId — so
// partners with lost sync flags resurrected on every reload. The REAL
// deletePartner function is extracted from index.html and run in a sandbox.

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

function buildPartnerSandbox(opts = {}) {
  const db = {
    partners: opts.dbPartners || [],
    partnerTransactions: [],
    capitalPartners: []
  };
  const context = {
    console,
    DB: db,
    USE_BACKEND: true,
    backendApi: opts.backendApi || { partners: {} },
    isOwnerUser: () => true,
    confirm: () => true,
    saveDB: () => {},
    renderPartners: () => {},
    showToast: () => {},
    document: {
      getElementById: () => elementStub(),
      createElement: () => elementStub(),
      querySelectorAll: () => [],
      addEventListener: () => {}
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout, clearTimeout, setInterval: () => 42, clearInterval: () => {}
  };
  context.globalThis = context;
  context.window = context;

  vm.createContext(context);
  vm.runInContext(extractFunction('deletePartner'), context, { filename: 'index.html-partners-sync.js' });
  return { context, db };
}

describe('frontend partners backend-mode sync (real index.html function)', () => {
  test('deletePartner falls back to the legacy id when _backendId is lost (no resurrection)', async () => {
    const deleted = [];
    const backendApi = { partners: { delete: (id) => { deleted.push(String(id)); return Promise.resolve({ success: true }); } } };
    const { context, db } = buildPartnerSandbox({
      dbPartners: [{ id: 'legacy-7', name: 'Sync Lost', capital: 100 }],
      backendApi
    });
    await context.deletePartner(0);
    expect(deleted).toEqual(['legacy-7']);
    expect(db.partners.length).toBe(0);
  });

  test('deletePartner prefers _backendId when present', async () => {
    const deleted = [];
    const backendApi = { partners: { delete: (id) => { deleted.push(String(id)); return Promise.resolve({ success: true }); } } };
    const { context } = buildPartnerSandbox({
      dbPartners: [{ id: 'local-2', _backendId: 'uuid-42', name: 'Synced', capital: 200 }],
      backendApi
    });
    await context.deletePartner(0);
    expect(deleted).toEqual(['uuid-42']);
  });

  test('renderPartners hydrates the DB mirror from the API response', () => {
    // Row actions are idx-based against DB.partners; without hydration they
    // operate on stale local records while the grid shows API rows. The
    // hydration goes through mergeBackendRows so pending local records
    // (failed/offline creates) are kept visible instead of replaced-and-lost.
    expect(HTML.includes('DB.partners = mergeBackendRows(DB.partners, partners)')).toBe(true);
  });
});
