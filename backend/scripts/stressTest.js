// Stress test: hammers a booted backend (isolated temp store) with
// parallel CRUD storms across modules, parallel logins, parallel token
// refreshes, and sync-style duplicate pushes, then verifies data
// integrity: every store parses, record counts are exact, no 5xx,
// no .tmp leftovers, and the child process is still alive.
// Usage: node scripts/stressTest.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 39492;
const BASE = `http://127.0.0.1:${PORT}`;

const MODULES = [
  { path: '/api/v1/customers', key: 'customers', make: i => ({ id: `st-c-${i}`, name: `Stress C ${i}` }) },
  { path: '/api/v1/suppliers', key: 'suppliers', make: i => ({ id: `st-s-${i}`, name: `Stress S ${i}` }) },
  { path: '/api/v1/treasury', key: 'entries', make: i => ({ id: `st-t-${i}`, type: 'in', amount: i, method: 'cash' }) },
  { path: '/api/v1/employees', key: 'employees', make: i => ({ id: `st-e-${i}`, name: `Stress E ${i}` }) },
  { path: '/api/v1/partners', key: 'partners', make: i => ({ id: `st-p-${i}`, name: `Stress P ${i}` }) }
];

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  -> ' + detail}`);
  if (!ok) failures++;
}

async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, body: json };
}

async function scenarioCrudStorm(perModule) {
  // Parallel creates across all modules at once.
  const creates = [];
  for (const mod of MODULES) {
    for (let i = 0; i < perModule; i++) {
      creates.push(api('POST', mod.path, mod.make(i)).then(r => ({ mod, i, r })));
    }
  }
  const results = await Promise.all(creates);
  const bad = results.filter(x => x.r.status !== 201);
  check(`crud-storm: ${results.length} parallel creates all 201`, bad.length === 0,
    `${bad.length} non-201 (e.g. ${bad[0] && bad[0].r.status})`);
  const s5xx = results.filter(x => x.r.status >= 500);
  check('crud-storm: zero 5xx', s5xx.length === 0, `${s5xx.length} server errors`);

  // Parallel mixed reads + updates while writes continue.
  const mixed = [];
  for (const mod of MODULES) {
    for (let i = 0; i < perModule; i++) {
      mixed.push(api('GET', `${mod.path}?limit=5&page=${1 + (i % 3)}`));
      if (mod.path !== '/api/v1/treasury') {
        const id = mod.make(i).id;
        mixed.push(api('PUT', `${mod.path}/${id}`, { notes: 'stressed' }));
      }
    }
  }
  const mixedRes = await Promise.all(mixed);
  const mixedBad = mixedRes.filter(r => r.status >= 500);
  check(`crud-storm: ${mixedRes.length} parallel reads/updates, zero 5xx`, mixedBad.length === 0,
    `${mixedBad.length} server errors`);

  // Exact record counts per module.
  for (const mod of MODULES) {
    const r = await api('GET', `${mod.path}?limit=1`);
    const total = r.body && r.body.data && r.body.data.total;
    check(`crud-storm: ${mod.key} count == ${perModule}`, total === perModule, `got ${total}`);
  }
}

async function scenarioParallelLogins(n) {
  await api('POST', '/api/v1/users', {
    username: 'stress-user', password: 'Stress#1234', fullName: 'Stress User', role: 'Manager'
  });
  const logins = await Promise.all(
    Array.from({ length: n }, () => api('POST', '/api/v1/auth/login', { username: 'stress-user', password: 'Stress#1234' }))
  );
  const ok = logins.filter(r => r.status === 200 && r.body && r.body.data && r.body.data.accessToken);
  check(`parallel-logins: ${n}/${n} succeeded with tokens`, ok.length === n, `${ok.length} ok`);
  return ok[0] && ok[0].body.data.refreshToken;
}

async function scenarioParallelRefresh(refreshToken, n) {
  const res = await Promise.all(
    Array.from({ length: n }, () => api('POST', '/api/v1/auth/refresh', { refreshToken }))
  );
  const ok = res.filter(r => r.status === 200);
  const s5xx = res.filter(r => r.status >= 500);
  check(`parallel-refresh: ${n}/${n} succeeded`, ok.length === n, `${ok.length} ok`);
  check('parallel-refresh: zero 5xx', s5xx.length === 0, `${s5xx.length} server errors`);
}

async function scenarioDuplicatePush(records, pushesEach) {
  // Sync-style: same client-supplied id pushed several times in parallel.
  // Exactly one push per id may win; final count must equal `records`.
  const pushes = [];
  for (let i = 0; i < records; i++) {
    for (let p = 0; p < pushesEach; p++) {
      pushes.push(api('POST', '/api/v1/customers', { id: `dup-${i}`, name: `Dup ${i}` }));
    }
  }
  const res = await Promise.all(pushes);
  const s5xx = res.filter(r => r.status >= 500);
  check(`duplicate-push: ${res.length} parallel pushes, zero 5xx`, s5xx.length === 0, `${s5xx.length} server errors`);
  const r = await api('GET', '/api/v1/customers?limit=1&search=Dup');
  const total = r.body && r.body.data && r.body.data.total;
  check(`duplicate-push: deduped count == ${records}`, total === records, `got ${total}`);
}

function verifyStores(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  let allOk = true;
  for (const f of files) {
    try {
      JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      allOk = false;
      check(`store integrity: ${f} parses`, false, e.message);
    }
  }
  if (allOk) check(`store integrity: ${files.length} store files all valid JSON`, true);
  const tmp = fs.readdirSync(dir).filter(f => f.includes('.tmp'));
  check('store integrity: no .tmp leftovers', tmp.length === 0, tmp.join(','));
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digitronics-stress-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DIGITRONICS_DATA_DIR: dir, LOG_FILE: '', NODE_ENV: 'test', RATE_LIMIT_MAX: '1000000' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let childErr = '';
  child.stderr.on('data', d => { childErr += d; });

  try {
    const deadline = Date.now() + 15000;
    for (;;) {
      try {
        const res = await fetch(`${BASE}/api/v1/health`);
        if (res.ok) break;
      } catch (_) {}
      if (Date.now() > deadline) throw new Error('backend did not start');
      await new Promise(r => setTimeout(r, 200));
    }

    await scenarioCrudStorm(30);            // 150 parallel creates + 300 mixed reads/updates
    const refreshToken = await scenarioParallelLogins(50);
    await scenarioParallelRefresh(refreshToken, 40);
    await scenarioDuplicatePush(20, 4);     // 80 parallel pushes, 20 unique ids
    verifyStores(dir);
    check('child process alive after all scenarios', child.exitCode === null, `exitCode=${child.exitCode}`);
  } finally {
    child.kill('SIGKILL');
    if (failures > 0 && childErr) console.error('--- child stderr ---\n' + childErr);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\nSTRESS TEST: ALL CHECKS PASSED' : `\nSTRESS TEST: ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
