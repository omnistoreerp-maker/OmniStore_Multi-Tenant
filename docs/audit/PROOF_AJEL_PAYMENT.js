/* Extended proof — adds Dashboard Receivables (renderFinancial) and the
 * customer-side-payment scenario, to confirm:
 *   (a) the double-count bug surfaces in MORE screens than just Table/Statement,
 *   (b) receiving a customer payment leaves customer.balance unchanged,
 *       so the Customer Table/Statement STAY inflated forever.
 *
 * Does NOT modify production code; uses real extracted values + the exact formulas
 * copied from the file at the cited lines.
 */
const fs = require('fs');
const html = fs.readFileSync('DigiTronics_v5.html', 'utf8');

let DB = {
  products: [], serials: [], saleInvoices: [], purchaseInvoices: [],
  customers: [], suppliers: [], installments: [], returns: [],
  cashFlow: [], stockMovement: [], asPayments: [], vouchers: [],
  branches: [{ id: 'MAIN', name: 'الرئيسي' }]
};
const roundMoney = (v) => Math.round((Number(v) || 0) * 100) / 100;
const getNetInvoiceTotal = (inv) => Math.max(0, Number((inv && inv.total) || 0));
const fmt = (v) => '' + roundMoney(v);

console.log('===== EXTENDED PROOF: scenario + a customer payment =====\n');

// New customer, balance 0
const cust = { id: 5001, name: 'ProofCustomer', phone: '0500000001', balance: 0, points: 0 };
DB.customers.push(cust);

// One ajel sale of 1000 (mirrors legacyFinalizeSaleTransaction ajel branch :31362-31364)
DB.saleInvoices.push({ id: 'INV-000001', date: new Date().toISOString(), customer: cust.name, total: 1000, invoiceType: 'ajel' });
const f = DB.customers.find(c => c.name === cust.name); if (f) f.balance = (f.balance || 0) + 1000;
console.log('After ajel sale of 1000: customer.balance =', cust.balance, '(expected 1000)\n');

// ---- Dashboard Receivables (renderFinancial :27641-27645) ----
const totalReceivables = DB.customers.reduce((sum, c) => {
  const customerDebt = (c.balance || 0)
    + DB.saleInvoices.filter(inv => inv.customer === c.name && inv.invoiceType === 'ajel')
                      .reduce((s, inv) => s + getNetInvoiceTotal(inv), 0);
  return sum + customerDebt;
}, 0);
console.log('A) Dashboard Receivables (renderFinancial:27641):', totalReceivables, '(expected 1000)');

// ---- Customer Table (renderCustomersTable :21122) ----
const custTable = (cust.balance || 0) + DB.saleInvoices.filter(inv => inv.customer === cust.name && inv.invoiceType === 'ajel').reduce((s, inv) => s + getNetInvoiceTotal(inv), 0);
console.log('B) Customer Table debt (renderCustomersTable:21122):', custTable, '(expected 1000)');

// ---- Customer Statement (viewCustomerStatement :21301) ----
let running = cust.balance || 0; let totalDebit = 0, totalCredit = 0;
DB.saleInvoices.filter(inv => inv.customer === cust.name).forEach(inv => { const d = inv.invoiceType === 'ajel' ? getNetInvoiceTotal(inv) : 0; const c = inv.invoiceType !== 'ajel' ? getNetInvoiceTotal(inv) : 0; totalDebit += d; totalCredit += c; running += d - c; });
console.log('C) Customer Statement final running (viewCustomerStatement:21301):', running, '(expected 1000)');

// ---- Voucher balance calculator (updateVoucherPartyInfo :33872, customer branch) ----
const invoiceDebt = DB.saleInvoices.filter(inv => inv.customer === cust.name && inv.invoiceType === 'ajel').reduce((s, inv) => s + getNetInvoiceTotal(inv), 0);
const payments = (DB.asPayments||[]).filter(p => p.entityId == cust.id && p.entityType === 'customer').reduce((s, p) => s + (p.direction === 'pay' ? p.amount : -p.amount), 0);
const vchPayments = (DB.vouchers||[]).filter(v => v.partyId == cust.id && v.partyType === 'customer').reduce((s, v) => s + (v.type === 'receipt' ? -v.amount : v.amount), 0);
const vchBal = (cust.balance || 0) + invoiceDebt - payments + vchPayments;
console.log('D) Voucher customer-balance calculator (updateVoucherPartyInfo:33872):', vchBal, '(expected 1000)');

console.log('\n----- SCENARIO 2: Receive a 400 customer payment -----');
// User opts to "تحصيل دفعة" via AR-AP collection (the proper accounting path):
// saveARPayment / saveASPayment ONLY push asPayment; does NOT write cust.balance.
DB.asPayments.push({ id: 1, date: new Date().toISOString(), entityId: cust.id, entityType: 'customer', entityName: cust.name, direction: 'pay', amount: 400 });
console.log('Payment of 400 received (asPayment recorded, balance field NOT touched).');
console.log('  customer.balance remains:', cust.balance);

// Re-read each screen AFTER payment
const pay2_receivables = DB.customers.reduce((s, c) => s + ((c.balance || 0) + DB.saleInvoices.filter(inv => inv.customer === c.name && inv.invoiceType === 'ajel').reduce((a, inv) => a + getNetInvoiceTotal(inv), 0)), 0);
const pay2_table = (cust.balance || 0) + DB.saleInvoices.filter(inv => inv.customer === cust.name && inv.invoiceType === 'ajel').reduce((s, inv) => s + getNetInvoiceTotal(inv), 0);
let r2 = cust.balance || 0; DB.saleInvoices.filter(inv => inv.customer === cust.name).forEach(inv => r2 += (inv.invoiceType === 'ajel' ? getNetInvoiceTotal(inv) : 0) - (inv.invoiceType !== 'ajel' ? getNetInvoiceTotal(inv) : 0));
const pay2_voucher = (cust.balance || 0) + invoiceDebt - (DB.asPayments.filter(p => p.entityId == cust.id && p.entityType === 'customer').reduce((s, p) => s + (p.direction === 'pay' ? p.amount : -p.amount), 0)) + vchPayments;
const arapDebit = DB.saleInvoices.filter(inv => inv.customer === cust.name).reduce((s, inv) => s + getNetInvoiceTotal(inv), 0)
  - (DB.asPayments.filter(p => p.entityId == cust.id && p.entityType === 'customer').reduce((s, p) => s + (p.direction === 'pay' ? p.amount : -p.amount), 0));

console.log('\nAFTER 400 payment (truth = 600 = 1000-400):');
console.log('  Dashboard Receivables:', pay2_receivables, '(should be 600)');
console.log('  Customer Table debt  :', pay2_table, '(should be 600)');
console.log('  Customer Statement   :', r2, '(should be 600)');
console.log('  Voucher balance calc :', pay2_voucher, '(should be 600)');
console.log('  AR-AP/Receivables(deduced):', arapDebit, '(should be 600)');

console.log('\n===== EXTENDED VERDICT =====');
const inflated = [pay2_receivables, pay2_table, r2].filter(v => v !== 600 && v !== 1000).length
  + [totalReceivables, custTable, running].filter(v => v !== 1000).length;
if (inflated > 0) {
  console.log('CRITICAL: ' + inflated + ' screen(s) show inflated debt after a customer payment.');
  console.log('  → The customer.balance field is NEVER decremented by saveASPayment / saveInstallmentPayment');
  console.log('    / saveARPayment; only saveVoucher(:33953) decrements it. After an AR-AP payment for an');
  console.log('    ajel customer, customer.balance keeps the original 1000 forever, so the broken renderers');
  console.log('    continue to show 1000 (and 2000 pre-payment) despite an actual 600 debt.');
}
