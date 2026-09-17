'use strict';
// Release-candidate flow validation: exercises the INSTALLED app over real HTTP.
// Usage: node rc-flow.js <baseUrl> <username> <password> <companyId> [<secondCompanyId>]
const base = (process.argv[2] || 'http://127.0.0.1:3001').replace(/\/$/, '');
const username = process.argv[3] || 'admin';
const password = process.argv[4];
const company = process.argv[5];
const secondCompany = process.argv[6];

let token = null;

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json };
}

function ok(name, cond, extra) {
  const mark = cond ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`);
  if (!cond) process.exitCode = 1;
  return cond;
}

async function main() {
  // 1. Login with company selection
  const login = await api('POST', '/api/v1/auth/login', { username, password, company });
  ok('login with company selection', login.status === 200 && login.body && login.body.data && login.body.data.accessToken,
    { status: login.status, hasToken: !!(login.body && login.body.data && login.body.data.accessToken) });
  if (!login.body || !login.body.data || !login.body.data.accessToken) { console.error('login failed, aborting'); process.exit(1); }
  token = login.body.data.accessToken;
  const user = login.body.data.user;
  ok('login returns user + effectiveRole', !!user && !!login.body.data.effectiveRole,
    { username: user && user.username, effectiveRole: login.body.data.effectiveRole, tenantId: login.body.data.accessToken ? 'in-token' : undefined });

  // 2. Global product (products are GLOBAL — no tenant stamping)
  const prod = await api('POST', '/api/v1/inventory', { name: 'RC Widget Pro', sku: 'RC-SKU-' + Date.now(), sellPrice: 125, quantity: 50 });
  ok('create product (GLOBAL)', prod.status === 201 && prod.body.data && prod.body.data.id,
    { status: prod.status, id: prod.body && prod.body.data && prod.body.data.id });
  const productId = prod.body && prod.body.data && prod.body.data.id;

  // 3. Customer (TENANT)
  const cust = await api('POST', '/api/v1/customers', { name: 'RC Customer One', email: 'cust@rc.local', phone: '0111111111' });
  ok('create customer (tenant-scoped)', cust.status === 201 && cust.body.data && cust.body.data.id,
    { status: cust.status, id: cust.body && cust.body.data && cust.body.data.id, tenantId: cust.body && cust.body.data && cust.body.data.tenantId });

  // 4. Sale (TENANT)
  const sale = await api('POST', '/api/v1/sales', {
    items: [{ productId, qty: 2, price: 125 }], total: 250, customer: 'RC Customer One', payment: 'cash'
  });
  ok('create sale', sale.status === 201 && sale.body.data && (sale.body.data.id || sale.body.data.invoiceId),
    { status: sale.status, id: sale.body && sale.body.data && (sale.body.data.id || sale.body.data.invoiceId), tenantId: sale.body && sale.body.data && sale.body.data.tenantId });

  // 5. Purchase (TENANT)
  const pur = await api('POST', '/api/v1/purchases', {
    items: [{ productId, qty: 10, cost: 80 }], total: 800, supplier: 'RC Supplier Co', payment: 'bank'
  });
  ok('create purchase', pur.status === 201 && pur.body.data && (pur.body.data.id || pur.body.data.orderNumber),
    { status: pur.status, id: pur.body && pur.body.data && (pur.body.data.id || pur.body.data.orderNumber), tenantId: pur.body && pur.body.data && pur.body.data.tenantId });

  // 6. Treasury entry (TENANT)
  const tx = await api('POST', '/api/v1/treasury', { type: 'in', amount: 250, balance: 250, desc: 'RC sale deposit' });
  ok('create treasury entry', tx.status === 201 && tx.body.data && tx.body.data.id,
    { status: tx.status, id: tx.body && tx.body.data && tx.body.data.id, tenantId: tx.body && tx.body.data && tx.body.data.tenantId });

  // 7. List / read everything
  const [prodList, custList, saleList, purList, txList] = await Promise.all([
    api('GET', '/api/v1/inventory'), api('GET', '/api/v1/customers'), api('GET', '/api/v1/sales'),
    api('GET', '/api/v1/purchases'), api('GET', '/api/v1/treasury')
  ]);
  ok('list products', prodList.status === 200 && Array.isArray(prodList.body.data.products) && prodList.body.data.products.length >= 1,
    { count: prodList.body && prodList.body.data && prodList.body.data.products && prodList.body.data.products.length });
  ok('list customers', custList.status === 200 && Array.isArray(custList.body.data.customers) && custList.body.data.customers.length >= 1,
    { count: custList.body && custList.body.data && custList.body.data.customers && custList.body.data.customers.length });
  ok('list sales', saleList.status === 200 && Array.isArray(saleList.body.data.invoices) && saleList.body.data.invoices.length >= 1,
    { count: saleList.body && saleList.body.data && saleList.body.data.invoices && saleList.body.data.invoices.length });
  ok('list purchases', purList.status === 200 && Array.isArray(purList.body.data.invoices) && purList.body.data.invoices.length >= 1,
    { count: purList.body && purList.body.data && purList.body.data.invoices && purList.body.data.invoices.length });
  ok('list treasury', txList.status === 200 && Array.isArray(txList.body.data.entries) && txList.body.data.entries.length >= 1,
    { count: txList.body && txList.body.data && txList.body.data.entries && txList.body.data.entries.length });

  // Verify created records carry the tenant stamp on disk
  const saleOnDisk = saleList.body.data.invoices.find(i => i.id === (sale.body.data.id || sale.body.data.invoiceId));
  ok('sale tenant-stamped', !!saleOnDisk && saleOnDisk.tenantId === company, { tenantId: saleOnDisk && saleOnDisk.tenantId });
  const txOnDisk = txList.body.data.entries.find(e => e.id === tx.body.data.id);
  ok('treasury tenant-stamped', !!txOnDisk && txOnDisk.tenantId === company, { tenantId: txOnDisk && txOnDisk.tenantId });

  // Products must NOT carry tenantId (GLOBAL)
  const prodOnDisk = prodList.body.data.products.find(p => p.id === productId);
  ok('product has NO tenantId (GLOBAL)', !!prodOnDisk && prodOnDisk.tenantId === undefined, { tenantId: prodOnDisk && prodOnDisk.tenantId });

  console.log('\n=== FLOW COMPLETE ===');
  console.log('Summary: 1 product (global), 1 customer, 1 sale, 1 purchase, 1 treasury entry');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
