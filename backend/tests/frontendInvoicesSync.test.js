'use strict';

// frontendInvoicesSync.test.js — invoices pages backend-mode regression.
//
// deleteSaleInvoice / deletePurchaseInvoice looked records up with a strict
// `i.id === id` against a mirror that was never hydrated from the API, so for
// backend rows the handler exited silently (`if (!inv) return`) — dead delete
// buttons — and the local filter also missed records addressed by their
// backend id. The REAL functions are extracted from index.html and run in a
// vm sandbox.

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

function buildInvoiceSandbox(fnName, opts = {}) {
  const db = {
    saleInvoices: opts.saleInvoices || [],
    purchaseInvoices: opts.purchaseInvoices || [],
    serials: opts.serials || [],
    products: opts.products || [],
    stockMovement: [],
    cashFlow: [],
    approvals: []
  };
  const context = {
    console,
    DB: db,
    USE_BACKEND: true,
    backendApi: opts.backendApi || {},
    backendOpQueue: { enqueue: () => {} },
    requirePermission: () => true,
    confirm: () => true,
    saveDB: () => {},
    renderInvoices: () => {},
    renderPurchases: () => {},
    renderTreasury: () => {},
    showToast: () => {},
    logActivity: () => {},
    addStockMovement: () => {},
    addCashEntry: () => {},
    formatMoney: (n) => String(n),
    document: {
      getElementById: () => elementStub(),
      createElement: () => elementStub(),
      querySelectorAll: () => [],
      addEventListener: () => {}
    }
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(extractFunction(fnName), context, { filename: 'index.html-' + fnName + '.js' });
  return { context, db };
}

describe('frontend invoices backend-mode sync (real index.html functions)', () => {
  test('deleteSaleInvoice resolves a backend row addressed by its backend id', async () => {
    const deleted = [];
    const backendApi = { sales: { delete: (id) => { deleted.push(String(id)); return Promise.resolve({ success: true }); } } };
    const { context, db } = buildInvoiceSandbox('deleteSaleInvoice', {
      saleInvoices: [{ id: 'INV-000001', _backendId: 'uuid-sale-1', invoiceType: 'cash', total: 100, customer: 'X', items: [] }],
      backendApi
    });
    await context.deleteSaleInvoice('uuid-sale-1');
    expect(deleted).toEqual(['uuid-sale-1']);
    expect(db.saleInvoices).toHaveLength(0);
  });

  test('deleteSaleInvoice still works with the legacy id (no backend id needed)', async () => {
    const deleted = [];
    const backendApi = { sales: { delete: (id) => { deleted.push(String(id)); return Promise.resolve({ success: true }); } } };
    const { context, db } = buildInvoiceSandbox('deleteSaleInvoice', {
      saleInvoices: [{ id: 'INV-000002', invoiceType: 'cash', total: 50, customer: 'Y', items: [] }],
      backendApi
    });
    await context.deleteSaleInvoice('INV-000002');
    expect(deleted).toEqual(['INV-000002']);
    expect(db.saleInvoices).toHaveLength(0);
  });

  test('deletePurchaseInvoice resolves a backend row addressed by its backend id', async () => {
    const deleted = [];
    const backendApi = { purchases: { delete: (id) => { deleted.push(String(id)); return Promise.resolve({ success: true }); } } };
    const { context, db } = buildInvoiceSandbox('deletePurchaseInvoice', {
      purchaseInvoices: [{ id: 'PUR-000001', _backendId: 'uuid-pur-1', invoiceType: 'cash', total: 80, supplier: 'S', items: [] }],
      backendApi
    });
    await context.deletePurchaseInvoice('uuid-pur-1');
    expect(deleted).toEqual(['uuid-pur-1']);
    expect(db.purchaseInvoices).toHaveLength(0);
  });

  test('render functions hydrate the invoice mirrors through the safe merge', () => {
    expect(HTML.includes('DB.saleInvoices = mergeBackendRows(DB.saleInvoices, invoices)')).toBe(true);
    expect(HTML.includes('DB.purchaseInvoices = mergeBackendRows(DB.purchaseInvoices, purchases)')).toBe(true);
  });
});
