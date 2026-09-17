// Phase 21C — round-trip coverage for the sync adapter.
// Boots the backend against an isolated temp data dir, serves a TEST-ONLY
// copy of the page with USE_BACKEND=true + API_BASE_URL pointed at that
// backend (the committed HTML is never modified), then drives the adapter
// create/list/update/delete/refresh flows and asserts the
// _syncedToBackend / _backendId transitions plus 400-duplicate -> synced.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const PAGE = process.argv[2] || 'index.html';
const PORT = parseInt(process.argv[3] || '19040', 10);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 200) : ''));
}

// --- Boot backend in-process against an isolated temp data dir ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'digitronics-21c-'));
process.env.DIGITRONICS_DATA_DIR = tmp;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = '21c-test-secret';
process.env.LOG_FILE = '';
delete process.env.AUTH_REQUIRED;
delete process.env.RATE_LIMIT_MAX;
const app = require(path.join(ROOT, 'backend', 'server.js'));

function backendReq(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ hostname: '127.0.0.1', port: BACKEND_PORT, path: '/api/v1' + p, method, headers: data ? { 'Content-Type': 'application/json' } : {} }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(raw); } catch (_) {} resolve({ status: res.statusCode, json: j }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let BACKEND_PORT;

(async () => {
  const backend = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  BACKEND_PORT = backend.address().port;
  const apiBase = 'http://127.0.0.1:' + BACKEND_PORT;

  // --- Static front server: serve a TEST-ONLY transformed copy of the page ---
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/' + PAGE;
    const file = path.join(ROOT, p);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('nf'); return; }
      let out = data.toString('utf-8');
      if (p === '/' + PAGE) {
        out = out.replace('const USE_BACKEND = false;', 'const USE_BACKEND = true;');
        out = out.replace("const API_BASE_URL = '';", "const API_BASE_URL = '" + apiBase + "';");
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/html' });
      res.end(out);
    });
  });
  await new Promise((r) => server.listen(PORT, r));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { if (typeof frSkip === 'function') frSkip(); });
  await page.fill('#loginUser', 'admin');
  await page.fill('#loginPass', 'admin123');
  await page.click('#loginBtn');
  await page.waitForTimeout(1500);

  check('Test-only override: USE_BACKEND=true + API_BASE_URL set', await page.evaluate(() => USE_BACKEND === true && /127\.0\.0\.1:\d+/.test(API_BASE_URL)));
  check('Page loads with zero JS errors', errors.length === 0, errors.join(';'));

  // --- CREATE flow via syncPendingSales ---
  const created = await page.evaluate(async (id) => {
    DB.saleInvoices.push({ id, customer: 'Roundtrip', items: [{ product: 'P1', qty: 1, price: 50 }], total: 50, payment: 'cash', _syncedToBackend: false, _backendId: null });
    saveDB();
    await digitronicsDataAdapter.syncPendingSales();
    const rec = (DB.saleInvoices || []).find((i) => String(i.id) === String(id));
    return rec ? { synced: rec._syncedToBackend === true, backendId: rec._backendId || null } : { synced: false, backendId: null };
  }, 'INV-RT-0001');
  check('CREATE: _syncedToBackend flips true after syncPendingSales', created.synced === true, JSON.stringify(created));
  check('CREATE: _backendId set from backend response', !!created.backendId, JSON.stringify(created));
  const onBack = await backendReq('GET', '/sales/INV-RT-0001');
  check('CREATE: record persisted on backend', onBack.status === 200 && !!onBack.json && onBack.json.success === true, 'status=' + onBack.status);

  // --- 400-DUPLICATE -> synced (idempotent create-sync, 21A.3) ---
  const dup = await page.evaluate(async (id) => {
    DB.saleInvoices.push({ id, customer: 'Roundtrip-dup', items: [{ product: 'P1', qty: 1, price: 50 }], total: 50, payment: 'cash', _syncedToBackend: false, _backendId: null });
    await digitronicsDataAdapter.syncPendingSales();
    const dupRec = (DB.saleInvoices || []).filter((i) => String(i.id) === String(id) && i.customer === 'Roundtrip-dup');
    return dupRec.length ? { synced: dupRec[0]._syncedToBackend === true, backendId: dupRec[0]._backendId || null } : { synced: false, backendId: null };
  }, 'INV-RT-0001');
  check('400-DUPLICATE: duplicate create treated as synced via getById probe', dup.synced === true && !!dup.backendId, JSON.stringify(dup));
  const dupList = await backendReq('GET', '/sales');
  check('400-DUPLICATE: backend holds a single record (no double-insert)', dupList.status === 200 && dupList.json && dupList.json.data && Array.isArray(dupList.json.data.invoices) && dupList.json.data.invoices.filter((i) => String(i.id) === 'INV-RT-0001').length === 1, 'count=' + (dupList.json && dupList.json.data && dupList.json.data.invoices ? dupList.json.data.invoices.filter((i) => String(i.id) === 'INV-RT-0001').length : -1));

  // --- UPDATE flow via backendOpQueue ---
  const upd = await page.evaluate(async (id) => {
    backendOpQueue.clearAll();
    backendOpQueue.enqueue({ type: 'update', id, _backendId: id, payload: { customer: 'Roundtrip Updated', total: 75 } });
    await backendOpQueue.process();
    return { pending: backendOpQueue.pending() };
  }, 'INV-RT-0001');
  check('UPDATE: queue drains (pending 0)', upd.pending === 0, JSON.stringify(upd));
  const updBack = await backendReq('GET', '/sales/INV-RT-0001');
  check('UPDATE: backend reflects changed fields', updBack.status === 200 && updBack.json && updBack.json.data && updBack.json.data.customer === 'Roundtrip Updated' && updBack.json.data.total === 75, JSON.stringify(updBack.json && updBack.json.data));
  const updSync = await page.evaluate(async (id) => {
    const rec = (DB.saleInvoices || []).find((i) => String(i.id) === String(id));
    return rec ? rec._syncedToBackend === true : false;
  }, 'INV-RT-0001');
  check('UPDATE: local record stays _syncedToBackend', updSync === true);

  // --- DELETE flow via backendOpQueue ---
  const del = await page.evaluate(async (id) => {
    backendOpQueue.clearAll();
    backendOpQueue.enqueue({ type: 'delete', id, _backendId: id });
    await backendOpQueue.process();
    return { pending: backendOpQueue.pending(), tombstoned: backendOpQueue.isTombstoned(id) };
  }, 'INV-RT-0001');
  check('DELETE: queue drains (pending 0)', del.pending === 0, JSON.stringify(del));
  const delBack = await backendReq('GET', '/sales/INV-RT-0001');
  check('DELETE: backend record removed', delBack.status === 404 || (delBack.json && delBack.json.success === false), 'status=' + delBack.status);
  check('DELETE: local tombstone recorded', del.tombstoned === true);

  // --- LIST flow: server-side record must be visible through the adapter ---
  await backendReq('POST', '/sales', { id: 'INV-RT-0100', customer: 'ServerSide', items: [{ product: 'P2', qty: 2, price: 30 }], total: 60, payment: 'cash' });
  const list = await page.evaluate(async () => {
    const arr = await digitronicsDataAdapter.listSales();
    return { isArray: Array.isArray(arr), hasServer: Array.isArray(arr) ? arr.some((i) => String(i.id) === 'INV-RT-0100') : false };
  });
  check('LIST: listSales() returns the server-side record', list.isArray && list.hasServer, JSON.stringify(list));

  // --- REFRESH flow: server-side record must merge into local DB (21A.4) ---
  await backendReq('POST', '/sales', { id: 'INV-RT-0200', customer: 'ServerRefresh', items: [{ product: 'P3', qty: 1, price: 10 }], total: 10, payment: 'cash' });
  const refresh = await page.evaluate(async () => {
    await digitronicsDataAdapter.refreshSales();
    return (DB.saleInvoices || []).some((i) => String(i.id) === 'INV-RT-0200');
  });
  check('REFRESH: refreshSales() merges server-side record into local DB', refresh === true);

  // --- REFRESH merge of an existing record (updatedAt-based two-way merge) ---
  const localBefore = await page.evaluate(async (id) => {
    DB.saleInvoices.push({ id, customer: 'LocalBefore', items: [{ product: 'P4', qty: 1, price: 20 }], total: 20, payment: 'cash', _syncedToBackend: true, _backendId: id });
    return true;
  }, 'INV-RT-0300');
  await backendReq('POST', '/sales', { id: 'INV-RT-0300', customer: 'ServerNewer', items: [{ product: 'P4', qty: 1, price: 20 }], total: 20, payment: 'cash' });
  await backendReq('PUT', '/sales/INV-RT-0300', { customer: 'ServerNewer', updatedAt: new Date(Date.now() + 60000).toISOString() });
  const merged = await page.evaluate(async (id) => {
    await digitronicsDataAdapter.refreshSales();
    const rec = (DB.saleInvoices || []).find((i) => String(i.id) === String(id));
    return rec ? { customer: rec.customer, synced: rec._syncedToBackend === true } : null;
  }, 'INV-RT-0300');
  check('REFRESH: newer server update merges into existing local record', !!merged && merged.customer === 'ServerNewer' && merged.synced === true, JSON.stringify(merged));

  await backendReq('DELETE', '/sales/INV-RT-0100');
  await backendReq('DELETE', '/sales/INV-RT-0200');
  await backendReq('DELETE', '/sales/INV-RT-0300');

  console.log('---');
  const failed = results.filter((r) => !r.ok);
  console.log(PAGE + ' (backend-sync) | TOTAL: ' + results.length + ' | PASS: ' + (results.length - failed.length) + ' | FAIL: ' + failed.length);
  await browser.close();
  server.close();
  backend.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });