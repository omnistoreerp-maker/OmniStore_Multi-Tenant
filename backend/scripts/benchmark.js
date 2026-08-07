// Repeatable benchmark for the JSON persistence layer.
// Boots the backend against an isolated temp store, then measures
// sequential read and write latency on a 500-record store.
// Usage: node scripts/benchmark.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 39490;
const BASE = `http://127.0.0.1:${PORT}`;

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digitronics-bench-'));
  const customers = {
    customers: Array.from({ length: 500 }, (_, i) => ({ id: 'c' + i, name: 'Customer ' + i, phone: '010' + i }))
  };
  fs.writeFileSync(path.join(dir, 'customers.json'), JSON.stringify(customers));

  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DIGITRONICS_DATA_DIR: dir, LOG_FILE: '', NODE_ENV: 'test' },
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

    // warmup
    for (let i = 0; i < 20; i++) await fetch(`${BASE}/api/v1/customers`);

    const reads = 300;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < reads; i++) {
      const res = await fetch(`${BASE}/api/v1/customers`);
      await res.json();
    }
    const readMs = Number(process.hrtime.bigint() - t0) / 1e6;

    const writes = 50;
    const t1 = process.hrtime.bigint();
    for (let i = 0; i < writes; i++) {
      await fetch(`${BASE}/api/v1/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bench ' + i })
      });
    }
    const writeMs = Number(process.hrtime.bigint() - t1) / 1e6;

    console.log(`READ  x${reads} (500-record store): ${readMs.toFixed(1)}ms total, ${(readMs / reads).toFixed(2)}ms/req`);
    console.log(`WRITE x${writes}: ${writeMs.toFixed(1)}ms total, ${(writeMs / writes).toFixed(2)}ms/req`);
  } finally {
    child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
