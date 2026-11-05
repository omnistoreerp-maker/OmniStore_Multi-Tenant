// Google account linking — TRUE cross-process concurrency.
//
// Two independent Node processes (separate PIDs, separate module graphs and
// fileStore caches) race to link the SAME Google subject to TWO different
// users in the SAME temporary data directory. The only coordination is the
// application's own cross-process file lock.
//
// Expected: exactly one success, one conflict, one persisted binding, no
// corrupted store.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const SHARED_SUB = 'google-sub-shared-xproc-001';
const USER_A = 'xproc-user-a';
const USER_B = 'xproc-user-b';

let dataDir;
let resultPaths = [];
let children = [];

function seedUsers() {
  const now = new Date().toISOString();
  seed(dataDir, 'users', {
    users: [
      {
        id: USER_A,
        username: 'xproc-a@example.com',
        fullName: 'Cross Process A',
        role: 'Admin',
        tenantIds: ['tenant-a'],
        permissions: ['users.read'],
        tokenVersion: 0,
        createdAt: now,
        updatedAt: now
      },
      {
        id: USER_B,
        username: 'xproc-b@example.com',
        fullName: 'Cross Process B',
        role: 'Cashier',
        tenantIds: ['tenant-b'],
        permissions: ['sales.read'],
        tokenVersion: 0,
        createdAt: now,
        updatedAt: now
      }
    ]
  });
}

function runWorker(userId, resultPath, startAt) {
  const workerPath = path.join(__dirname, 'helpers', 'googleLinkWorker.js');
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [workerPath, dataDir, userId, SHARED_SUB, String(startAt), resultPath],
      {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, DIGITRONICS_DATA_DIR: dataDir, NODE_ENV: 'test', AUTH_REQUIRED: 'false' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      }
    );
    children.push(child);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('close', (code) => resolve({ code, stdout, stderr, pid: child.pid, resultPath }));
  });
}

function readResult(proc) {
  if (!fs.existsSync(proc.resultPath)) {
    throw new Error(
      `Worker PID ${proc.pid} produced no result (exit=${proc.code}).\n` +
      `stdout: ${proc.stdout}\nstderr: ${proc.stderr}`
    );
  }
  return JSON.parse(fs.readFileSync(proc.resultPath, 'utf-8'));
}

registerCleanup(() => [], () => [dataDir]);

describe('Google linking across two OS processes', () => {
  let results;
  let processes;

  beforeAll(async () => {
    dataDir = makeTempDataDir('google-link-xproc');
    seedUsers();

    resultPaths = [
      path.join(dataDir, 'result-a.json'),
      path.join(dataDir, 'result-b.json')
    ];

    // Give both processes time to boot, then release them at the same instant.
    const startAt = Date.now() + 1500;
    processes = await Promise.all([
      runWorker(USER_A, resultPaths[0], startAt),
      runWorker(USER_B, resultPaths[1], startAt)
    ]);
    results = processes.map(readResult);

    // Machine-readable evidence for the verification report.
    console.log('XPROC_EVIDENCE ' + JSON.stringify({
      pids: results.map((r) => r.pid),
      successCount: results.filter((r) => r.ok && !r.conflict).length,
      conflictCount: results.filter((r) => r.conflict).length
    }));
  }, 30000);

  afterAll(() => {
    for (const child of children) {
      try { if (!child.killed) child.kill(); } catch (_) {}
    }
  });

  test('both processes completed successfully at the OS level', () => {
    expect(processes.map((p) => p.code)).toEqual([0, 0]);
  });

  test('the two attempts ran in genuinely different PIDs', () => {
    expect(results).toHaveLength(2);
    expect(results[0].pid).not.toBe(results[1].pid);
    expect(processes[0].pid).not.toBe(processes[1].pid);
  });

  test('exactly one process links and the other is rejected on conflict', () => {
    const successes = results.filter((r) => r.ok && !r.conflict);
    const rejections = results.filter((r) => r.conflict);

    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(1);
    expect(rejections[0].ok).toBe(false);
    expect(rejections[0].error).toMatch(/already linked/i);
  });

  test('the shared store ends with exactly one binding for the Google subject', () => {
    const db = readStore(dataDir, 'users');
    expect(db).toBeTruthy();
    expect(Array.isArray(db.users)).toBe(true);
    expect(db.users).toHaveLength(2);

    const bound = db.users.filter((u) => u && u.oauth && u.oauth.google === SHARED_SUB);
    expect(bound).toHaveLength(1);

    const winner = results.find((r) => r.ok && !r.conflict);
    expect(bound[0].id).toBe(winner.linkedUser);

    const googleBindings = db.users.filter((u) => u && u.oauth && u.oauth.google !== undefined);
    expect(googleBindings).toHaveLength(1);
    expect(new Set(googleBindings.map((u) => u.oauth.google)).size).toBe(1);
  });

  test('the store is valid JSON and no lock/temp artifacts remain', () => {
    expect(() => readStore(dataDir, 'users')).not.toThrow();
    expect(fs.existsSync(path.join(dataDir, 'users.json.tmp'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, '.users.lock'))).toBe(false);
  });
});
