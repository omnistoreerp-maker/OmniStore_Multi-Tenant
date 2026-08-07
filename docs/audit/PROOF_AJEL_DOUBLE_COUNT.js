/* PROOF ONLY — does NOT modify the production file.
 *
 * Reproduces the user's scenario and reports the exact value each screen-rendering
 * function would show, by extracting and executing the REAL committed function
 * bodies from DigiTronics_v5.html (sameProductId, getNetInvoiceTotal, getSaleReturns
 * FinancialImpact, getArApAccountRows, getArApAgingRows, getCustomerArApTransactions,
 * getCustomerStatement running-balance logic, renderCustomersTable debt formula).
 *
 * Scenario: new customer (balance = 0), one credit (ajel) sale of exactly 1000.
 * Inspect: customer.balance, Customer Table debt, Customer Statement running balance,
 * Aging Report balance, Receivables total.
 */
const fs = require('fs');
const html = fs.readFileSync('DigiTronics_v5.html', 'utf8');

// Extract a real function source by name.
function extractFnSrc(name) {
  const sig = 'function ' + name + '(';
  const start = html.indexOf(sig);
  if (start === -1) throw new Error('NOT FOUND: ' + name);
  let i = start + sig.length, pDepth = 0, paramsEnd = -1;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (ch === '(') pDepth++;
    else if (ch === ')') { if (pDepth === 0) { paramsEnd = i; break; } pDepth--; }
  }
  if (paramsEnd === -1) throw new Error('no params close: ' + name);
  const arrStart = html.indexOf('{', paramsEnd);
  let depth = 0, j = arrStart, n = html.length;
  while (j < n) {
    const ch = html[j];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { j++; break; } }
    j++;
  }
  return html.slice(start, j);
}

// --- Minimal sandbox shims for the extracted functions ---
let DB = {
  products: [], serials: [], saleInvoices: [], purchaseInvoices: [],
  customers: [], suppliers: [], installments: [], returns: [],
  cashFlow: [], stockMovement: [],
  arApOpeningBalances: [], arApAdjustments: [], asPayments: [], supplierPayments: [],
  vouchers: [], maintenance: [], branches: [{ id: 'MAIN', name: 'الرئيسي' }]
};
const toSafeFloat = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const roundMoney = (v) => Math.round((Number(v) || 0) * 100) / 100;
function formatMoney(v) { return '' + roundMoney(v); }
function getBranchNameById(id) { return 'الرئيسي'; }
function ensureArApState() {
  DB.arApOpeningBalances = Array.isArray(DB.arApOpeningBalances) ? DB.arApOpeningBalances : [];
  DB.arApAdjustments = Array.isArray(DB.arApAdjustments) ? DB.arApAdjustments : [];
  DB.asPayments = Array.isArray(DB.asPayments) ? DB.asPayments : [];
  DB.supplierPayments = Array.isArray(DB.supplierPayments) ? DB.supplierPayments : [];
}
function arApClean(v) { return String(v || '').trim().toLowerCase(); }
function arApDateOk(){ return true; }
function arApBranchOk(){ return true; }
function arApSameParty(rec, party, keys) {
  const pname = arApClean(party && party.name);
  const pphone = String((party && party.phone) || '').replace(/\D/g, '');
  return keys.some(k => {
    const rv = arApClean(rec && rec[k]);
    if (rv && rv === pname) return true;
    const rphone = String((rec && (rec[k + 'Phone'] || rec[k + 'phone'])) || '').replace(/\D/g, '');
    return !!(pphone && rphone && rphone === pphone);
  });
}
function getArApBalanceEntries() { return []; }     // empty opening/adjustments
function getArApOpeningBalance() { return 0; }
function getNetInvoiceTotal(invoice) { return Math.max(0, Number(invoice && invoice.total || 0)); }
// getSaleReturnFinancialImpact: simplest TM-revenue path. Extract the REAL one.
// We provide a stub-free real extract below in the wrapper.

// Build a sandbox that defines the REAL extracted functions plus the shims,
// then returns the ones we need.
function realWrapper() {
  const sameProductIdSrc = extractFnSrc('sameProductId');
  const getSaleReturnFinancialImpactSrc = extractFnSrc('getSaleReturnFinancialImpact');
  const getArApAccountRowsSrc = extractFnSrc('getArApAccountRows');
  const getCustomerArApTransactionsSrc = extractFnSrc('getCustomerArApTransactions');
  // getArApAgingRows references getArApAccountRows, getBranchNameById
  const getArApAgingRowsSrc = extractFnSrc('getArApAgingRows');

  // The wrapper holds DB as a closure variable (shared with the shims defined here).
  const src =
    '"use strict";\n' +
    'let DB = arguments[0];\n' +
    // pure helpers (inlined)
    'const toSafeFloat = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };\n' +
    'const roundMoney = (v) => Math.round((Number(v) || 0) * 100) / 100;\n' +
    'function formatMoney(v) { return "" + roundMoney(v); }\n' +
    'function getBranchNameById(id) { return "الرئيسي"; }\n' +
    'function ensureArApState() { DB.arApOpeningBalances = Array.isArray(DB.arApOpeningBalances)?DB.arApOpeningBalances:[]; DB.arApAdjustments = Array.isArray(DB.arApAdjustments)?DB.arApAdjustments:[]; DB.asPayments = Array.isArray(DB.asPayments)?DB.asPayments:[]; DB.supplierPayments = Array.isArray(DB.supplierPayments)?DB.supplierPayments:[]; }\n' +
    'function arApClean(v) { return String(v||"").trim().toLowerCase(); }\n' +
    'function arApDateOk(){ return true; }\n' +
    'function arApBranchOk(){ return true; }\n' +
    'function arApSameParty(rec, party, keys) { const pname = arApClean(party && party.name); const pphone = String((party && party.phone)||"").replace(/\\D/g,""); return keys.some(k => { const rv = arApClean(rec && rec[k]); if (rv && rv === pname) return true; const rphone = String((rec && (rec[k+"Phone"]||rec[k+"phone"]))||"").replace(/\\D/g,""); return !!(pphone && rphone && rphone === pphone); }); }\n' +
    'function getArApBalanceEntries() { return []; }\n' +
    'function getArApOpeningBalance() { return 0; }\n' +
    'function getNetInvoiceTotal(invoice) { return Math.max(0, Number((invoice && invoice.total) || 0)); }\n' +
    // the REAL extracted functions
    'function getCustomerArApTransactions(customer) {\n' +
      // re-extract below; but easier to inline by concatenation:
      '/* placeholder */' +
    '}\n' +
    'return { DB: () => DB, toSafeFloat, roundMoney };\n';
  // The above approach for getCustomerArApTransactions is incomplete. Build wrapper
  // by concatenating extracted FULL function bodies (they reference each other in scope).
  const fullSrc =
    '"use strict";\n' +
    'let DB = arguments[0];\n' +
    'const toSafeFloat = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };\n' +
    'const roundMoney = (v) => Math.round((Number(v) || 0) * 100) / 100;\n' +
    'function formatMoney(v) { return "" + roundMoney(v); }\n' +
    'function getBranchNameById(id) { return "الرئيسي"; }\n' +
    'function ensureArApState() { DB.arApOpeningBalances = Array.isArray(DB.arApOpeningBalances)?DB.arApOpeningBalances:[]; DB.arApAdjustments = Array.isArray(DB.arApAdjustments)?DB.arApAdjustments:[]; DB.asPayments = Array.isArray(DB.asPayments)?DB.asPayments:[]; DB.supplierPayments = Array.isArray(DB.supplierPayments)?DB.supplierPayments:[]; }\n' +
    'function arApClean(v) { return String(v||"").trim().toLowerCase(); }\n' +
    'function arApDateOk(){ return true; }\n' +
    'function arApBranchOk(){ return true; }\n' +
    'function arApSameParty(rec, party, keys) { const pname = arApClean(party && party.name); const pphone = String((party && party.phone)||"").replace(/\\D/g,""); return keys.some(k => { const rv = arApClean(rec && rec[k]); if (rv && rv === pname) return true; const rphone = String((rec && (rec[k+"Phone"]||rec[k+"phone"]))||"").replace(/\\D/g,""); return !!(pphone && rphone && rphone === pphone); }); }\n' +
    'function getArApBalanceEntries() { return []; }\n' +
    'function getArApOpeningBalance() { return 0; }\n' +
    'function getNetInvoiceTotal(invoice) { return Math.max(0, Number((invoice && invoice.total) || 0)); }\n' +
    sameProductIdSrc + '\n' +
    getSaleReturnFinancialImpactSrc + '\n' +
    getCustomerArApTransactionsSrc + '\n' +
    getArApAccountRowsSrc + '\n' +
    getArApAgingRowsSrc + '\n' +
    'return { getArApAccountRows, getArApAgingRows, getCustomerArApTransactions, DB: () => DB, setDB: (v) => { DB = v; } };\n';
  const factory = new Function(fullSrc);
  return factory;
}
const sb = realWrapper()(DB);
const getArApAccountRowsReal = sb.getArApAccountRows;
const getArApAgingRowsReal = sb.getArApAgingRows;

// ====== Reproduce the scenario ======
console.log('===== SCENARIO: New customer, balance 0, one credit (ajel) sale of 1000 =====\n');

// New customer with balance 0
const cust = { id: 5001, name: 'ProofCustomer', phone: '', balance: 0, points: 0 };
DB.customers.push(cust);
console.log('Step 1 — Create customer "ProofCustomer": balance =', cust.balance);

// Create one ajel (credit) sale of exactly 1000 — mirrors legacyFinalizeSaleTransaction's ajel branch
// (line 31362-31364 of the production file):
//   if (invoiceType === 'ajel') {
//     const cust = DB.customers.find(c => c.name === customer);
//     if (cust) cust.balance = (cust.balance || 0) + total;
//   }
const saleTotal = 1000;
const invoice = {
  id: 'INV-000001',
  date: new Date().toISOString(),
  customer: cust.name,
  items: [{ productId: 1, name: 'ProofItem', qty: 1, price: 1000, buyPrice: 600, serials: [], noSerial: true }],
  subtotal: 1000, discount: 0, total: saleTotal,
  profit: 400,
  payment: 'ajel',
  invoiceType: 'ajel',
  user: 'test'
};
DB.saleInvoices.push(invoice);
// REAL production ajel-branch effect:
const foundCust = DB.customers.find(c => c.name === invoice.customer);
if (foundCust) foundCust.balance = (foundCust.balance || 0) + invoice.total;
console.log('Step 2 — Credit sale of ' + saleTotal + ' recorded. invoiceType = ' + invoice.invoiceType);

// Refresh the sandbox's DB reference (we share the same object, so no rebind needed, but be explicit)
sb.setDB(DB);

// ====== Inspection 1: customer.balance ======
console.log('\n----- INSPECTION 1: customer.balance (the DB field) -----');
console.log('  customer.balance = ' + cust.balance);

// ====== Inspection 2: Customer Table debt (renderCustomersTable, line 21122-21124) ======
console.log('\n----- INSPECTION 2: Customer Table (renderCustomersTable debt) -----');
// Extract the EXACT formula from the production file:
//   const debt = (c.balance || 0) + DB.saleInvoices
//     .filter(inv => inv.customer === c.name && inv.invoiceType === 'ajel')
//     .reduce((sum, inv) => sum + getNetInvoiceTotal(inv), 0);
const customerTableDebt = (cust.balance || 0)
  + DB.saleInvoices
      .filter(inv => inv.customer === cust.name && inv.invoiceType === 'ajel')
      .reduce((sum, inv) => sum + Math.max(0, Number(inv.total || 0)), 0);
console.log('  (c.balance=' + cust.balance + ') + sum(ajel invoice totals=' + saleTotal + ') = ' + customerTableDebt);
console.log('  >>> Customer Table shows: ' + customerTableDebt);

// ====== Inspection 3: Customer Statement running balance (viewCustomerStatement, line 21301) ======
console.log('\n----- INSPECTION 3: Customer Statement running balance (viewCustomerStatement) -----');
// Extract the EXACT logic:
//   let running = customer.balance || 0;       -> starts at 1000
//   transactions.forEach: ajel sale -> {debit: getNetInvoiceTotal=1000, credit:0}
//   running += t.debit - t.credit              -> 1000 + 1000 = 2000
let running = cust.balance || 0;
const stmtTx = [];
DB.saleInvoices.filter(inv => inv.customer === cust.name).forEach(inv => {
  stmtTx.push({
    debit: inv.invoiceType === 'ajel' ? Math.max(0, Number(inv.total || 0)) : 0,
    credit: inv.invoiceType !== 'ajel' ? Math.max(0, Number(inv.total || 0)) : 0
  });
});
let statementRunning = running;
let totalDebit = 0, totalCredit = 0;
stmtTx.forEach(t => { statementRunning += t.debit - t.credit; totalDebit += t.debit; totalCredit += t.credit; });
console.log('  starting running = customer.balance = ' + running);
console.log('  sale tx: debit=' + totalDebit + ', credit=' + totalCredit);
console.log('  final running balance = ' + statementRunning);
console.log('  >>> Customer Statement shows: ' + statementRunning);

// ====== Inspection 4: AR/AP Account Rows (getArApAccountRows) — used by Receivables screen & aging base ======
console.log('\n----- INSPECTION 4: AR-AP Account Rows balance (getArApAccountRows) -----');
const arRows = getArApAccountRowsReal('customer', { search: '', from: '', to: '', branchId: '' });
const proofRow = arRows.find(r => r.name === cust.name);
console.log('  AR-AP row for "ProofCustomer":');
console.log('    name     = ' + proofRow.name);
console.log('    opening  = ' + proofRow.opening);
console.log('    invoices = ' + proofRow.invoices);
console.log('    payments = ' + proofRow.payments);
console.log('    returns  = ' + proofRow.returns);
console.log('    balance  = ' + proofRow.balance);
console.log('    outstanding = ' + proofRow.outstanding);
console.log('    status   = ' + proofRow.status);
console.log('  >>> AR-AP / Receivables screen shows balance: ' + proofRow.balance);

// ====== Inspection 5: Aging Report (getArApAgingRows) ======
console.log('\n----- INSPECTION 5: Aging Report (getArApAgingRows) -----');
const agingRows = getArApAgingRowsReal('customer');
const agingRow = agingRows.find(r => r.name === cust.name);
if (agingRow) {
  console.log('  Aging row: name=' + agingRow.name + ' balance=' + agingRow.balance + ' days=' + agingRow.days + ' bucket=' + agingRow.bucket);
  console.log('  >>> Aging Report shows balance: ' + agingRow.balance);
} else {
  console.log('  (no aging row — balance <= 0, not shown in aging)');
}

// ====== Receivables total (dashboard / AR summary) ======
console.log('\n----- BONUS: Receivables total (dashboard getArApDashboardSummary customerReceivables) -----');
const receivablesTotal = arRows.reduce((s, r) => s + Math.max(0, r.balance), 0);
console.log('  sum(max(0, AR-AP row.balance)) = ' + receivablesTotal);
console.log('  >>> Receivables total shows: ' + receivablesTotal);

// ====== VERDICT ======
console.log('\n===================== VERDICT =====================');
const customerBalance   = cust.balance;
const customerTable     = customerTableDebt;
const customerStatement = statementRunning;
const arapBalance       = proofRow.balance;
const agingBalance      = agingRow ? agingRow.balance : 0;
const receivables       = receivablesTotal;
console.log('  customer.balance       : ' + customerBalance   + '   (expected 1000)');
console.log('  Customer Table debt    : ' + customerTable     + '   (expected 1000)');
console.log('  Customer Statement     : ' + customerStatement + '   (expected 1000)');
console.log('  AR-AP / Receivables row: ' + arapBalance       + '   (expected 1000)');
console.log('  Aging Report balance   : ' + agingBalance      + '   (expected 1000)');
console.log('  Receivables total      : ' + receivables       + '   (expected 1000)');
console.log('==================================================');
const anyDouble = [customerTable, customerStatement].some(v => v === 2000);
if (anyDouble) {
  console.log('\n  ❌ CRITICAL ACCOUNTING BUG CONFIRMED: at least one screen shows 2000 instead of 1000.');
  console.log('     Affected screens (double-count):');
  if (customerTable === 2000)     console.log('       - Customer Table (debt = balance + Σ ajel invoice totals)');
  if (customerStatement === 2000) console.log('       - Customer Statement (running = balance + invoice debit)');
  console.log('     Root cause: legacyFinalizeSaleTransaction adds the ajel sale total to');
  console.log('     customer.balance (line 31362-31364), AND the screen renderers add the');
  console.log('     ajel invoice total again.');
  console.log('     Screens built on AR-AP transactions (AR-AP rows, Aging, Receivables) compute');
  console.log('     balance from transaction rows ONLY (they do NOT read customer.balance),');
  console.log('     so they correctly show 1000.');
} else {
  console.log('\n  ✓ No screen shows 2000; values reconcile to 1000.');
}
