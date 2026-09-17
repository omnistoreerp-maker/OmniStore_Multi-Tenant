'use strict';

// 3B.2-A — Async repository API tests.
//
// Verifies the Promise-based counterpart API added to BaseRepository:
//   readAsync / writeAsync / createAsync / updateAsync / deleteAsync /
//   findAsync / readCollectionAsync / _readOnDiskAsync
//
// All of them must:
//   - return Promises (never synchronous values)
//   - preserve the EXACT same tenant semantics as the synchronous API:
//       readAsync  -> read-time tenant filtering
//       writeAsync -> CREATE-time tenant stamping
//       createAsync/updateAsync/deleteAsync/findAsync -> Phase 22 ownership
//           isolation (cross-tenant update/delete BLOCKED)
//   - keep the current tenant correct even when requests interleave at an
//     async boundary (AsyncLocalStorage isolation, 3B.2-0)
//   - leave the synchronous API and every existing caller untouched
//
// All tests use isolated temporary data directories (never backend/data).

const fs = require('fs');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');

const ORIGINAL_ENV = {
  DIR: process.env.DIGITRONICS_DATA_DIR,
  MD: process.env.ENABLE_TENANT_METADATA,
  FLT: process.env.ENABLE_TENANT_FILTERING,
  ISO: process.env.ENABLE_TENANT_ENTITY_ISOLATION
};

const tempDirs = [];

// The tenant store is a module singleton; the accessor must be created from
// the SAME instance the test drives. It is loaded once (not resetModules),
// while config + fileStore + BaseRepository are re-required per repo so the
// current process.env (DIGITRONICS_DATA_DIR, feature flags) is honored.
const tenantStore = require('../middleware/tenantStore');

function freshRepo(storeName, extraEnv) {
  for (const [key, val] of Object.entries(extraEnv || {})) process.env[key] = val;
  jest.resetModules();
  const BaseRepository = require('../repositories/BaseRepository');
  return new BaseRepository(storeName, tenantStore.createAccessor());
}

function makeDir() {
  const dir = makeTempDataDir('repo-async');
  tempDirs.push(dir);
  process.env.DIGITRONICS_DATA_DIR = dir;
  return dir;
}

// Run `handler` inside a fresh per-request ALS context (same way server.js
// mounts tenantStore.middleware before tenantCarry).
function runRequest(handler) {
  return new Promise((resolve, reject) => {
    tenantStore.middleware({}, {}, () => {
      Promise.resolve(handler()).then(resolve, reject);
    });
  });
}

// Shared barrier: both sides park on `await gate` so the two async chains are
// guaranteed to interleave (A sets tenant, B sets tenant, THEN both resume).
function makeGate() {
  let release;
  const gate = new Promise((r) => { release = r; });
  return { gate, release };
}

function afterEnvRestore() {
  const mapping = { DIGITRONICS_DATA_DIR: 'DIR', ENABLE_TENANT_METADATA: 'MD', ENABLE_TENANT_FILTERING: 'FLT', ENABLE_TENANT_ENTITY_ISOLATION: 'ISO' };
  for (const [envKey, origKey] of Object.entries(mapping)) {
    const orig = ORIGINAL_ENV[origKey];
    if (orig === undefined) delete process.env[envKey];
    else process.env[envKey] = orig;
  }
}

afterAll(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  tempDirs.length = 0;
  afterEnvRestore();
});

describe('3B.2-A — Async repository API', () => {
  // Test 1 — readAsync returns a real Promise resolving to the document.
  test('readAsync returns a Promise resolving to the store document', async () => {
    const dir = makeDir();
    seed(dir, 'customers', { customers: [{ id: 'c1', name: 'One', tenantId: 'tenant-a' }] });
    const repo = freshRepo('customers');

    const p = repo.readAsync();
    expect(p).toBeInstanceOf(Promise);

    const db = await p;
    expect(Array.isArray(db.customers)).toBe(true);
    expect(db.customers[0].id).toBe('c1');
  });

  // Test 2 — writeAsync persists correctly.
  test('writeAsync persists the document durably', async () => {
    const dir = makeDir();
    seed(dir, 'customers', { customers: [] });
    const repo = freshRepo('customers');

    const ok = await repo.writeAsync({ customers: [{ id: 'c1', name: 'One' }] });
    expect(ok).toBe(true);

    const onDisk = readStore(dir, 'customers');
    expect(onDisk.customers).toHaveLength(1);
    expect(onDisk.customers[0].id).toBe('c1');
  });

  // Test 3 — tenant filtering works through readAsync.
  test('readAsync applies read-time tenant filtering', async () => {
    const dir = makeDir();
    seed(dir, 'customers', {
      customers: [
        { id: 'a1', name: 'A1', tenantId: 'tenant-a' },
        { id: 'b1', name: 'B1', tenantId: 'tenant-b' }
      ]
    });
    const repo = freshRepo('customers', { ENABLE_TENANT_FILTERING: 'true' });

    const seen = await runRequest(async () => {
      tenantStore.set({ tenantId: 'tenant-a' });
      const db = await repo.readAsync();
      return (db.customers || []).map(c => c.id);
    });

    expect(seen).toEqual(['a1']);
  });

  // Test 4 — tenant stamping works through createAsync.
  test('createAsync stamps the current tenant on new records', async () => {
    const dir = makeDir();
    seed(dir, 'customers', { customers: [] });
    const repo = freshRepo('customers', { ENABLE_TENANT_METADATA: 'true', ENABLE_TENANT_ENTITY_ISOLATION: 'true' });

    const created = await runRequest(async () => {
      tenantStore.set({ tenantId: 'tenant-a' });
      return repo.createAsync('customers', { id: 'n1', name: 'New' });
    });

    expect(created).toBeTruthy();
    expect(created.tenantId).toBe('tenant-a');
    const onDisk = readStore(dir, 'customers');
    expect(onDisk.customers[0].tenantId).toBe('tenant-a');
  });

  // Test 5 — cross-tenant updateAsync is blocked.
  test('updateAsync blocks cross-tenant updates', async () => {
    const dir = makeDir();
    seed(dir, 'customers', {
      customers: [
        { id: 'a1', name: 'A1', tenantId: 'tenant-a' },
        { id: 'b1', name: 'B1', tenantId: 'tenant-b' }
      ]
    });
    const repo = freshRepo('customers', { ENABLE_TENANT_ENTITY_ISOLATION: 'true' });

    const result = await runRequest(async () => {
      tenantStore.set({ tenantId: 'tenant-b' });
      return repo.updateAsync('customers', 'a1', { name: 'HACKED' });
    });

    expect(result).toBeNull();
    const onDisk = readStore(dir, 'customers');
    expect(onDisk.customers.find(c => c.id === 'a1').name).toBe('A1');
  });

  // Test 6 — cross-tenant deleteAsync is blocked.
  test('deleteAsync blocks cross-tenant deletes', async () => {
    const dir = makeDir();
    seed(dir, 'customers', {
      customers: [
        { id: 'a1', name: 'A1', tenantId: 'tenant-a' },
        { id: 'b1', name: 'B1', tenantId: 'tenant-b' }
      ]
    });
    const repo = freshRepo('customers', { ENABLE_TENANT_ENTITY_ISOLATION: 'true' });

    const removed = await runRequest(async () => {
      tenantStore.set({ tenantId: 'tenant-b' });
      return repo.deleteAsync('customers', 'a1');
    });

    expect(removed).toBe(false);
    const onDisk = readStore(dir, 'customers');
    expect(onDisk.customers).toHaveLength(2);
    expect(onDisk.customers.some(c => c.id === 'a1')).toBe(true);
  });

  // Test 7 — same-tenant updateAsync works (positive control).
  test('updateAsync works for the owning tenant', async () => {
    const dir = makeDir();
    seed(dir, 'customers', { customers: [{ id: 'a1', name: 'A1', tenantId: 'tenant-a' }] });
    const repo = freshRepo('customers', { ENABLE_TENANT_ENTITY_ISOLATION: 'true' });

    const updated = await runRequest(async () => {
      tenantStore.set({ tenantId: 'tenant-a' });
      return repo.updateAsync('customers', 'a1', { name: 'A1-renamed' });
    });

    expect(updated).toBeTruthy();
    expect(updated.name).toBe('A1-renamed');
    expect(updated.tenantId).toBe('tenant-a');
  });

  // Test 8 — concurrent interleaved readAsync calls keep their own tenant.
  test('interleaved readAsync calls keep each request its own tenant', async () => {
    const dir = makeDir();
    seed(dir, 'customers', {
      customers: [
        { id: 'a1', name: 'A1', tenantId: 'tenant-a' },
        { id: 'b1', name: 'B1', tenantId: 'tenant-b' }
      ]
    });
    const repo = freshRepo('customers', { ENABLE_TENANT_FILTERING: 'true' });

    const { gate, release } = makeGate();

    const pa = runRequest(async () => {
      tenantStore.set({ tenantId: 'tenant-a' });
      await gate; // async boundary — B runs its set() in between
      const db = await repo.readAsync();
      return (db.customers || []).map(c => c.id);
    });
    const pb = runRequest(async () => {
      tenantStore.set({ tenantId: 'tenant-b' });
      await gate;
      const db = await repo.readAsync();
      return (db.customers || []).map(c => c.id);
    });

    release(); // resume both interleaved chains
    const [a, b] = await Promise.all([pa, pb]);

    expect(a).toEqual(['a1']);
    expect(b).toEqual(['b1']);
  });

  // Test 9 — findAsync respects tenant visibility.
  test('findAsync returns null for another tenant record under isolation', async () => {
    const dir = makeDir();
    seed(dir, 'customers', {
      customers: [
        { id: 'a1', name: 'A1', tenantId: 'tenant-a' },
        { id: 'b1', name: 'B1', tenantId: 'tenant-b' }
      ]
    });
    const repo = freshRepo('customers', { ENABLE_TENANT_ENTITY_ISOLATION: 'true' });

    const found = await runRequest(async () => {
      tenantStore.set({ tenantId: 'tenant-a' });
      return repo.findAsync('customers', 'b1');
    });

    expect(found).toBeNull();
  });
});
