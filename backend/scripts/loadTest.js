// Load test: fires 100 / 500 / 1000 request rounds against a booted
// backend (isolated temp store) with bounded concurrency, and reports
// latency, throughput, memory and error rate per round.
// Usage: node scripts/loadTest.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 39491;
const BASE = `http://127.0.0.1:${PORT}`;
const CONCURRENCY = 20;

async function getRss() {
  try {
    const res = await fetch(`${BASE}/api/v1/liveness`);
    const body = await res.json();
    return body.data.memory.rssMb;
  } catch (_) {
    return null;
  }
}

async function round(totalRequests, tag) {
  const latencies = [];
  let errors = 0;
  const rssBefore = await getRss();
  const t0 = process.hrtime.bigint();

  let next = 0;
  async function worker() {
    while (next < totalRequests) {
      const i = next++;
      const start = process.hrtime.bigint();
      try {
        let res;
        if (i % 10 === 0) {
          res = await fetch(`${BASE}/api/v1/customers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: `load-${tag}-` + i, name: 'Load ' + i })
          });
        } else {
          res = await fetch(`${BASE}/api/v1/customers?limit=50&page=${1 + (i % 5)}`);
        }
        if (res.status >= 400) errors++;
        await res.text();
      } catch (_) {
        errors++;
      }
      latencies.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const rssAfter = await getRss();

  latencies.sort((a, b) => a - b);
  const avg = latencies.reduce((s, v) => s + v, 0) / latencies.length;
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const max = latencies[latencies.length - 1];

  return {
    requests: totalRequests,
    wallMs: wallMs.toFixed(0),
    throughput: (totalRequests / (wallMs / 1000)).toFixed(1),
    avgMs: avg.toFixed(2),
    p95Ms: p95.toFixed(2),
    maxMs: max.toFixed(2),
    errors,
    rssBefore,
    rssAfter
  };
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digitronics-load-'));
  const customers = {
    customers: Array.from({ length: 200 }, (_, i) => ({ id: 'seed-' + i, name: 'Seed ' + i }))
  };
  fs.writeFileSync(path.join(dir, 'customers.json'), JSON.stringify(customers));

  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DIGITRONICS_DATA_DIR: dir, LOG_FILE: '', NODE_ENV: 'test', RATE_LIMIT_MAX: '1000000' },
    stdio: ['ignore', 'ignore', 'pipe']
  });

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

    console.log('round | requests | wall ms | req/s | avg ms | p95 ms | max ms | errors | rss before->after (MB)');
    for (const n of [100, 500, 1000]) {
      const r = await round(n, n);
      console.log(`load  | ${r.requests} | ${r.wallMs} | ${r.throughput} | ${r.avgMs} | ${r.p95Ms} | ${r.maxMs} | ${r.errors} | ${r.rssBefore} -> ${r.rssAfter}`);
    }
    console.log('child alive after all rounds:', child.exitCode === null);
  } finally {
    child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
