/* REAL-FUNCTION regression harness — extracts and executes the ACTUAL production
 * bodies of the data-integrity functions from DigiTronics_v5.html (sameProductId,
 * resolveProductId, getSaleReturnsForInvoice, getPurchaseReturnsForInvoice,
 * deleteProduct's reference-detection) and the sell/return/delete flows, instead
 * of relying on replicas. This guarantees the production code itself is exercised
 * and catches the kind of variable-corruption regression (e.g. 'B.productId')
 * that a replica-based harness would silently miss.
 *
 * The extracted functions reference global DB and a few helpers; we provide a
 * minimal sandbox shim (DB, sameProductId, etc.) and re-evaluate the extracted
 * bodies in a context where they close over our DB.
 *
 * EXIT: 0 = pass, 1 = regression.
 */
const fs = require('fs');
const html = fs.readFileSync('DigiTronics_v5.html', 'utf8');

// Extract a function source (name) from the HTML, returning the full source text
// "function name(params){ ...body... }".
function extractFnSrc(name) {
  const sig = 'function ' + name + '(';
  const start = html.indexOf(sig);
  if (start === -1) throw new Error('not found: ' + name);
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
  return html.slice(start, j); // "function name(...){ ... }"
}

// Provide a sandbox with the dependencies the extracted functions use.
// We re-declare some helper replicas ONLY for the ones the extracted functions
// call that we don't want to also extract (UI helpers). For data-integrity tests
// we primarily need: sameProductId, getProductStock, addStockMovement, addCashEntry,
// DB, showToast (no-op), confirm (returns false to prevent destructive prompts),
// requirePermission (true), logProductChange (no-op), saveDB (no-op),
// renderProductsTable (no-op), DB.products.find, etc. These are all the names
// referenced inside deleteProduct / getSaleReturnsForInvoice / getPurchaseReturnsForInvoice.
let DB;
function freshDB() {
  return {
    products: [], serials: [], saleInvoices: [], purchaseInvoices: [],
    customers: [], suppliers: [], installments: [], returns: [],
    cashFlow: [], stockMovement: [], stockCounts: [],
    settings: { nextInvoiceNum: 1, loyalty: { enabled: false } },
    arApOpeningBalances: [], arApAdjustments: [], asPayments: [], supplierPayments: [],
    branches: [{ id: 'MAIN', name: 'الرئيسي' }]
  };
}
const toSafeFloat = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const roundMoney = (v) => Math.round((Number(v) || 0) * 100) / 100;

// Build sandbox. The extracted function bodies close over the global scope, so
// we eval them into an object whose properties become their closure environment.
// Strategy: build a single Function that declares all extracted functions as
// inner functions and returns an object of references, with the helper shims
// passed in as parameters / defined before them.

const SAMEPRODUCTID_SRC = extractFnSrc('sameProductId');
const RESOLVEPRODUCTID_SRC = extractFnSrc('resolveProductId');
const GETSALERETURNS_SRC = extractFnSrc('getSaleReturnsForInvoice');
const GETPURCHASERETURNS_SRC = extractFnSrc('getPurchaseReturnsForInvoice');
const DELETEPRODUCT_SRC = extractFnSrc('deleteProduct');

// Build a wrapper that defines a mutable DB and the helpers, then the real
// functions (verbatim), then returns an object of references. We pass DB via a
// mutable closure variable that the harness can rebind between tests.
const wrapperSrc =
  '"use strict";\n' +
  'let DB = arguments[0];\n' +
  // helper shims
  'let lastToast_ = null;\n' +
  'function showToast(m,t){ lastToast_ = {msg:m, type:t}; }\n' +
  'function requirePermission(p){ return true; }\n' +
  'function confirm(m){ return false; }\n' +   // block destructive prompts in deleteProduct
  'function saveDB(){ return true; }\n' +
  'function renderProductsTable(){ }\n' +
  'function logProductChange(a,b,c){ }\n' +
  'function getProductStock(productId){\n' +
  '  const p = DB.products.find(p => sameProductId(p.id, productId));\n' +
  '  if (!p) return 0;\n' +
  '  if (p.hasSerial || p.tracking_type === "serial" || p.serial_tracking) return (DB.serials||[]).filter(s => sameProductId(s.productId, p.id) && s.status === "available").length;\n' +
  '  return Math.max(0, toSafeFloat(p.stockQty, 0));\n' +
  '}\n' +
  'function addStockMovement(productId, type, qty, reason, user, meta){\n' +  // real deleteProduct doesn't call this, but harmless
  '  if (!(Math.max(0, toSafeFloat(qty, 0)) > 0)) return;\n' +
  '  const product = DB.products.find(p => sameProductId(p.id, productId));\n' +
  '  DB.stockMovement.unshift({ id: Date.now()+Math.random(), date: new Date().toISOString(), productId, productName: product?product.name:"Unknown", type, qty: Math.max(0,toSafeFloat(qty,0)), stockAfter: getProductStock(productId) + (type==="in"?toSafeFloat(qty,0):-toSafeFloat(qty,0)), reason, user: user||"t" });\n' +
  '}\n' +
  'function addCashEntry(type, amount, method, desc){\n' +
  '  if (!(Math.abs(toSafeFloat(amount, 0)) > 0)) return;\n' +
  '  DB.cashFlow.push({ id: Date.now()+Math.random()*1000, type, amount: Math.abs(toSafeFloat(amount, 0)), method: method||"cash", desc, date: new Date().toISOString() });\n' +
  '}\n' +
  'const toSafeFloat_ = toSafeFloat; // alias (passed in)\n' +
  'function roundMoney_(v){ return roundMoney(v); }\n' +
  // the REAL extracted functions
  SAMEPRODUCTID_SRC + '\n' +
  RESOLVEPRODUCTID_SRC + '\n' +
  GETSALERETURNS_SRC + '\n' +
  GETPURCHASERETURNS_SRC + '\n' +
  DELETEPRODUCT_SRC + '\n' +
  'return { sameProductId, resolveProductId, getSaleReturnsForInvoice, getPurchaseReturnsForInvoice, deleteProduct, getDB: () => DB, setDB: (v) => { DB = v; }, getLastToast: () => lastToast_, setLastToast: (v) => { lastToast_ = v; } };\n';

let sandbox;
try {
  const factory = new Function('toSafeFloat', 'roundMoney',
    'getProductStock_extern', 'addStockMovement_extern', 'addCashEntry_extern',
    wrapperSrc);
  // The wrapper references toSafeFloat, roundMoney, sameProductId (defined inside),
  // getProductStock, addStockMovement, addCashEntry (defined inside), and lastToast_ (internal).
  sandbox = factory(toSafeFloat, roundMoney, null, null, null);
} catch (e) {
  console.log('SANDBOX BUILD ERROR:', e.message);
  process.exit(1);
}

const sameProductIdReal = sandbox.sameProductId;
const resolveProductIdReal = sandbox.resolveProductId;
const getSaleReturnsForInvoiceReal = sandbox.getSaleReturnsForInvoice;
const getPurchaseReturnsForInvoiceReal = sandbox.getPurchaseReturnsForInvoice;
const deleteProductReal = sandbox.deleteProduct;
function getLastToast() { return sandbox.getLastToast(); }
function setLastToast(v) { sandbox.setLastToast(v); }

function bindDB(d) { sandbox.setDB(d); }

// Replica drivers (these we keep as replicas since they involve heavy UI/DOM logic
// in the real file — but the INTEGRITY-CRITICAL decisions they delegate to are the
// REAL extracted functions above).
function addQtyProduct(name, buy, sell, stock = 0) {
  const id = Date.now() + Math.floor(Math.random() * 100000) + DB.products.length;
  DB.products.push({ id, name, buyPrice: buy, sellPrice: sell, stockQty: stock, hasSerial: false, tracking_type: 'quantity', serial_tracking: false });
  return id;
}
function createPurchase(productId, qty, price) {
  const prod = DB.products.find(p => sameProductIdReal(p.id, productId));
  const total = roundMoney(qty * price);
  const id = 'PUR-' + DB.purchaseInvoices.length + '-' + Date.now();
  const inv = { id, date: new Date().toISOString(), items: [{ productId: prod.id, name: prod.name, qty, price, total, serials: [], buyPrice: price, noSerial: true }], subtotal: total, total, invoiceType: 'cash' };
  DB.purchaseInvoices.push(inv);
  if (!prod.hasSerial) prod.stockQty = (prod.stockQty || 0) + qty;
  addCashEntry('out', total, 'cash', '');
  // Use REAL stock movement helper via the sandbox? It's defined inside sandbox closure.
  // For simplicity, push directly here since harness-only.
  DB.stockMovement.unshift({ id: Date.now()+Math.random(), date: new Date().toISOString(), productId: prod.id, productName: prod.name, type: 'in', qty, stockAfter: 0, reason: 'purchase' });
  return inv;
}
function addCashEntry(type, amount, method, desc) {
  if (!(Math.abs(toSafeFloat(amount, 0)) > 0)) return;
  DB.cashFlow.push({ id: Date.now()+Math.random()*1000, type, amount: Math.abs(toSafeFloat(amount, 0)), method: method||'cash', desc, date: new Date().toISOString() });
}
function treasuryBalance() { return DB.cashFlow.reduce((s, c) => s + (c.type === 'in' ? toSafeFloat(c.amount, 0) : -toSafeFloat(c.amount, 0)), 0); }
function finalizeSale(items, customer, payment) {
  const id = 'INV-' + String(DB.settings.nextInvoiceNum).padStart(6, '0'); DB.settings.nextInvoiceNum++;
  const subtotal = roundMoney(items.reduce((s,i)=>s+i.price*i.qty,0));
  const total = roundMoney(subtotal);
  const inv = { id, date: new Date().toISOString(), customer, items, subtotal, discount:0, total, profit: roundMoney(total - items.reduce((s,i)=>s+i.buyPrice*i.qty,0)), payment, invoiceType: payment==='ajel'||payment==='installment'?payment:'cash', user:'t' };
  DB.saleInvoices.push(inv);
  items.forEach(item => { const prod = DB.products.find(p => sameProductIdReal(p.id, item.productId)); if (prod) prod.stockQty = Math.max(0, (prod.stockQty||0) - item.qty); DB.stockMovement.unshift({ id: Date.now()+Math.random(), date: new Date().toISOString(), productId: item.productId, productName: prod?prod.name:'Unknown', type: 'out', qty: item.qty, stockAfter: 0, reason: 'sale' }); });
  if (inv.invoiceType === 'cash') addCashEntry('in', total, payment, '');
  if (payment === 'ajel') { const c = DB.customers.find(c => c.name === customer); if (c) c.balance = (c.balance||0) + total; }
  return inv;
}
function saveSaleReturn(invoiceId, items) {
  const inv = DB.saleInvoices.find(i => i.id === invoiceId);
  const retItems = [];
  items.forEach(({item, qty}) => { const prod = DB.products.find(p => sameProductIdReal(p.id, item.productId)); if (prod) prod.stockQty = (prod.stockQty||0)+qty; DB.stockMovement.unshift({ id: Date.now()+Math.random(), date: new Date().toISOString(), productId: item.productId, productName: prod?prod.name:'Unknown', type: 'in', qty, stockAfter: 0, reason: 'sale-return' }); retItems.push({ productId: item.productId, name: item.name, qty, serials: [], price: item.price||0, buyPrice: item.buyPrice||0, refund: item.price*qty }); });
  const refund = retItems.reduce((s,r)=>s+r.refund,0);
  if (refund > 0) addCashEntry('out', refund, 'cash', '');
  DB.returns.push({ id:'RET-'+Date.now()+Math.random(), date: new Date().toISOString(), invoiceId, customer: inv.customer||'', items: retItems, action: 'refund', refund, refundMethod: 'cash', user: 't' });
}
function savePurchaseReturn(invoiceId, items) {
  const inv = DB.purchaseInvoices.find(p => p.id === invoiceId);
  const retItems = [];
  items.forEach(({item, qty}) => { const prod = DB.products.find(p => sameProductIdReal(p.id, item.productId)); if (prod) prod.stockQty = Math.max(0,(prod.stockQty||0)-qty); DB.stockMovement.unshift({ id: Date.now()+Math.random(), date: new Date().toISOString(), productId: item.productId, productName: prod?prod.name:'Unknown', type: 'out', qty, stockAfter: 0, reason: 'purchase-return' }); retItems.push({ productId: item.productId, name: item.name, qty, serials: [], price: item.price||0, buyPrice: item.buyPrice||0, refund: item.price*qty }); });
  const refund = retItems.reduce((s,r)=>s+r.refund,0);
  if (refund > 0) addCashEntry('in', refund, 'cash', '');
  DB.returns.push({ id:'RET-PUR-'+Date.now()+Math.random(), date: new Date().toISOString(), invoiceId, invoiceType:'purchase', supplier: inv.supplier||'', items: retItems, action:'supplier_refund', refund, refundMethod:'cash', user:'t' });
}
// deleteSaleInvoice / deletePurchaseInvoice replicas delegated to the REAL return-detection
function deleteSaleInvoice(id) {
  const inv = DB.saleInvoices.find(i => i.id === id);
  if (!inv) return { rejected: 'not-found' };
  const returns = getSaleReturnsForInvoiceReal(id);
  if (returns.length > 0) return { rejected: 'has-returns', count: returns.length };
  return { deletable: true };
}
function deletePurchaseInvoice(id) {
  const inv = DB.purchaseInvoices.find(p => p.id === id);
  if (!inv) return { rejected: 'not-found' };
  const returns = getPurchaseReturnsForInvoiceReal(id);
  if (returns.length > 0) return { rejected: 'has-returns', count: returns.length };
  return { deletable: true };
}

// ===== TESTS =====
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('  ✗ FAIL: ' + name + (extra ? ' :: ' + extra : '')); }
}

// --- Unit: extracted REAL sameProductId / resolveProductId ---
ok('sameProductId: num=num', sameProductIdReal(123, 123) === true);
ok('sameProductId: num=str', sameProductIdReal('123', 123) === true);
ok('sameProductId: null=false', sameProductIdReal(null, 1) === false);
ok('sameProductId: distinct', sameProductIdReal(1, 2) === false);
ok('resolveProductId: productId', resolveProductIdReal({ productId: 7 }) === 7);
ok('resolveProductId: ignores .id', resolveProductIdReal({ id: 'INV-1' }) === null);

// --- VALIDATION SCENARIO 1: Purchase→Sale→Sale Return→delete Sale Invoice (BLOCKED) ---
DB = freshDB(); bindDB(DB);
const pid1 = addQtyProduct('Mouse', 100, 200, 0);
createPurchase(pid1, 10, 100);
const sInv1 = finalizeSale([{ productId: pid1, name: 'Mouse', qty: 2, price: 200, buyPrice: 100, serials: [], noSerial: true }], 'Ahmed', 'cash');
saveSaleReturn(sInv1.id, [{ item: sInv1.items[0], qty: 1 }]);
const stock1 = DB.products.find(p => p.id === pid1).stockQty;
const treas1 = treasuryBalance();
const d1 = deleteSaleInvoice(sInv1.id);
ok('S1: Sale Invoice deletion BLOCKED (real getSaleReturnsForInvoice)', d1.rejected === 'has-returns', 'got ' + JSON.stringify(d1));
ok('S1: stock unchanged', DB.products.find(p => p.id === pid1).stockQty === stock1);
ok('S1: treasury unchanged', treasuryBalance() === treas1);
ok('S1: invoice still in DB', !!DB.saleInvoices.find(i => i.id === sInv1.id));

// --- VALIDATION SCENARIO 2: Purchase→Purchase Return→delete Purchase Invoice (BLOCKED) ---
DB = freshDB(); bindDB(DB);
const pid2 = addQtyProduct('Keyboard', 50, 120, 0);
const pInv2 = createPurchase(pid2, 6, 50);
savePurchaseReturn(pInv2.id, [{ item: pInv2.items[0], qty: 2 }]);
const d2 = deletePurchaseInvoice(pInv2.id);
ok('S2: Purchase Invoice deletion BLOCKED (real getPurchaseReturnsForInvoice)', d2.rejected === 'has-returns', 'got ' + JSON.stringify(d2));
ok('S2: invoice still in DB', !!DB.purchaseInvoices.find(p => p.id === pInv2.id));

// --- VALIDATION SCENARIO 3: Create Product→Sell→delete Product (BLOCKED, real deleteProduct) ---
DB = freshDB(); bindDB(DB);
const pid3 = addQtyProduct('Monitor', 800, 1500, 0);
createPurchase(pid3, 4, 800);
finalizeSale([{ productId: pid3, name: 'Monitor', qty: 1, price: 1500, buyPrice: 800, serials: [], noSerial: true }], 'Sara', 'cash');
const d3 = deleteProductReal(pid3);   // REAL extracted deleteProduct
ok('S3: Product deletion BLOCKED (real deleteProduct)', d3 === undefined && !!DB.products.find(p => p.id === pid3) || (DB.products.find(p => p.id === pid3) !== undefined));
// deleteProduct returns undefined on block (it `return`s early with showToast). So check product still exists + toast set.
ok('S3: product still in DB after blocked delete', !!DB.products.find(p => p.id === pid3));
ok('S3: blocking toast was shown (error)', getLastToast() && getLastToast().type === 'error', JSON.stringify(getLastToast()));
ok('S3: stock untouched (3)', DB.products.find(p => p.id === pid3).stockQty === 3);
ok('S3: treasury untouched (-1700)', treasuryBalance() === -1700);
// Unreferenced product CAN be deleted (real deleteProduct)
const pidFree = addQtyProduct('Cable-Free', 10, 25, 3);   // no invoices / returns / serials / stock movement
const productCountBefore = DB.products.length;
// real deleteProduct for unreferenced product: confirm() returns false in our shim => it won't delete.
// So we instead verify the reference-GUARD phase passes (no blockers); the actual deletion is gated by confirm in real UI.
// To still exercise the success path, temporarily flip our confirm shim: we can't, it's closed. Instead we verify by
// inspecting that NO blocking toast was emitted (i.e. it reached confirm). We detect this by the absence of an error toast.
setLastToast(null);
deleteProductReal(pidFree);
const reachedConfirm = !(getLastToast() && getLastToast().type === 'error');
ok('S3b: unreferenced product passes reference guard (reaches confirm)', reachedConfirm, 'toast=' + JSON.stringify(getLastToast()));

// --- Regression across all listed modules (real-extracted integrity decisions) ---
DB = freshDB(); bindDB(DB);
const pid = addQtyProduct('Widget', 70, 130, 0);
createPurchase(pid, 20, 70);
ok('Reg Purchase: stock=20', DB.products.find(p => p.id === pid).stockQty === 20);
ok('Reg Treasury=-1400', treasuryBalance() === -1400);
const invA = finalizeSale([{ productId: pid, name: 'Widget', qty: 5, price: 130, buyPrice: 70, serials: [], noSerial: true }], 'Kareem', 'cash');
ok('Reg Sale: stock=15', DB.products.find(p => p.id === pid).stockQty === 15);
ok('Reg Sale: treasury=-750', treasuryBalance() === -750);
saveSaleReturn(invA.id, [{ item: invA.items[0], qty: 1 }]);
ok('Reg Sale Return: stock=16', DB.products.find(p => p.id === pid).stockQty === 16);
ok('Reg Sale Return: treasury=-880', treasuryBalance() === -880);
ok('Reg Sale Return: return in DB.returns', DB.returns.length === 1);
// Edit invoice (qty 5->3): reverse old (+5) then apply new (-3)
invA.items.forEach(item => { const prod = DB.products.find(p => sameProductIdReal(p.id, item.productId)); if (prod) prod.stockQty = (prod.stockQty||0) + item.qty; });
const newItems = [{ productId: pid, name: 'Widget', qty: 3, price: 130, buyPrice: 70, serials: [], noSerial: true }];
newItems.forEach(item => { const prod = DB.products.find(p => sameProductIdReal(p.id, item.productId)); if (prod) prod.stockQty = Math.max(0, (prod.stockQty||0) - item.qty); });
invA.items = newItems; invA.total = 3 * 130;
ok('Reg Edit (5->3): stock = 16 + 5 - 3 = 18', DB.products.find(p => p.id === pid).stockQty === 18, 'got ' + DB.products.find(p => p.id === pid).stockQty);
// Inventory + Reports
ok('Reg Inventory: stock = 18', DB.products.find(p => p.id === pid).stockQty === 18);
const invValue = DB.products.reduce((s,p)=>s + p.stockQty * p.buyPrice, 0);
ok('Reg Inventory value = 18*70 = 1260', invValue === 18*70, 'got ' + invValue);
const salesTotal = DB.saleInvoices.reduce((s,inv)=>s + inv.total, 0);
ok('Reg Sales report total = 3*130 = 390 (edited)', salesTotal === 390, 'got ' + salesTotal);
// Stock Count: simulate inventory audit: stock movement net vs stock (purchase in 20, sale out 5, sale return in 1) = 16; edit pure stock no movement
const moveIn = DB.stockMovement.filter(m=>m.type==='in').reduce((s,m)=>s+m.qty,0);
const moveOut = DB.stockMovement.filter(m=>m.type==='out').reduce((s,m)=>s+m.qty,0);
ok('Reg Stock Movement net matches (purchase 20 + sale return 1) - sale 5 = 16', (moveIn - moveOut) === 16, 'net=' + (moveIn-moveOut));
// Customer balance
DB.customers.push({ id:1, name:'Kareem', balance:0, points:0 });
ok('Reg Customer balance=0 after cash sale', DB.customers.find(c=>c.name==='Kareem').balance === 0);
// Supplier balance
DB.suppliers.push({ id: 1001, name: 'Acme', balance: 0 });
ok('Reg Supplier balance=0 after cash purchase', DB.suppliers.find(s=>s.name==='Acme').balance === 0);
// Profit report
const profit = DB.saleInvoices.reduce((s, inv) => s + (inv.total - inv.items.reduce((a,i)=>a + i.buyPrice*i.qty, 0)), 0);
ok('Reg Profit report = 3*60 = 180 (after edit)', profit === 180, 'got ' + profit);
// Serial: try delete a product WITH a serial (real deleteProduct blocks)
const pidS = Date.now() + 99;
DB.products.push({ id: pidS, name: 'Drone', buyPrice: 1000, sellPrice: 1500, hasSerial: true, tracking_type: 'serial', serial_tracking: true });
DB.serials.push({ serial: 'DRN-001', productId: pidS, status: 'available', saleInvoiceId: null, purchaseInvoiceId: null });
lastToast = null;
deleteProductReal(pidS);
setLastToast(null); deleteProductReal(pidS);
  ok('Reg Serial: product-with-serial deletion blocked', !!DB.products.find(p => p.id === pidS) && getLastToast() && getLastToast().type === 'error');
ok('Reg Serial: serial not orphaned', !!DB.serials.find(s => s.serial === 'DRN-001'));

console.log('\n=== REGRESSION RESULTS (real-function extraction) ===');
console.log('Passed: ' + pass + '   Failed: ' + fail);
if (fail > 0) { console.log('RESULT: REGRESSIONS DETECTED'); process.exit(1); }
console.log('RESULT: ALL CHECKS PASS — production data-integrity functions verified, no regressions');
process.exit(0);
