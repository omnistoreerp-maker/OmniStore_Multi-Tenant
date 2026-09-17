'use strict';

// Phase 21 — Repository Entity API Foundation (additive).
//
// Verifies the four new entity methods on BaseRepository:
//   createEntity / updateEntity / deleteEntity / findEntity
// built purely on top of the existing read()/write() primitives, without
// touching storageAdapter, fileStore, services or controllers.
//
// Covered (per Phase 21 spec):
//   - findEntity existing / missing
//   - createEntity / updateEntity / deleteEntity happy paths
//   - update missing / delete missing behavior
//   - duplicate/create identity behavior
//   - legacy repository methods (read/write/readCollection/findIn/findIndexIn)
//     still work and are unchanged
//   - Phase 12 CREATE metadata stamping remains intact (createEntity inherits it)
//   - Phase 13 read-time filtering remains intact (findEntity inherits it)
//   - feature flags OFF remain unchanged
//   - tenant accessor behavior unchanged (null/false without accessor; no
//     behavioral change from accessor presence alone when flags are off)
//
// All tests use isolated temporary data directories (never backend/data).

const fs = require('fs');
const { makeTempDataDir, seed } = require('./helpers/testData');

const ORIGINAL_ENV = {
  DIR: process.env.DIGITRONICS_DATA_DIR,
  MD: process.env.ENABLE_TENANT_METADATA,
  FLT: process.env.ENABLE_TENANT_FILTERING
};

const tempDirs = [];

// Fresh BaseRepository bound to a temp dir. jest.resetModules() re-reads
// config + fileStore so the current process.env is honored per instance.
function freshRepo(storeName, accessor) {
  jest.resetModules();
  const BaseRepository = require('../repositories/BaseRepository');
  return new BaseRepository(storeName, accessor);
}

function makeDir() {
  const dir = makeTempDataDir('repo-entity');
  tempDirs.push(dir);
  process.env.DIGITRONICS_DATA_DIR = dir;
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  tempDirs.length = 0;
  const mapping = { DIGITRONICS_DATA_DIR: 'DIR', ENABLE_TENANT_METADATA: 'MD', ENABLE_TENANT_FILTERING: 'FLT' };
  for (const [envKey, origKey] of Object.entries(mapping)) {
    const orig = ORIGINAL_ENV[origKey];
    if (orig === undefined) delete process.env[envKey];
    else process.env[envKey] = orig;
  }
});

// ---------------------------------------------------------------------------
// Default posture: all flags OFF, no tenant accessor.
// ---------------------------------------------------------------------------
describe('Phase 21 — entity API, flags OFF, no accessor', () => {
  beforeEach(() => {
    process.env.ENABLE_TENANT_METADATA = 'false';
    process.env.ENABLE_TENANT_FILTERING = 'false';
  });

  test('findEntity returns an existing record by id', () => {
    const dir = makeDir();
    seed(dir, 'users', { users: [{ id: 'u1', name: 'Ada' }, { id: 'u2', name: 'Bob' }] });
    const repo = freshRepo('users');
    expect(repo.findEntity('users', 'u1')).toEqual({ id: 'u1', name: 'Ada' });
    expect(repo.findEntity('users', 'u2')).toEqual({ id: 'u2', name: 'Bob' });
  });

  test('findEntity returns null for a missing record', () => {
    const dir = makeDir();
    seed(dir, 'users', { users: [{ id: 'u1', name: 'Ada' }] });
    const repo = freshRepo('users');
    expect(repo.findEntity('users', 'ghost')).toBeNull();
    expect(repo.findEntity('users', '')).toBeNull();
    expect(repo.findEntity('users', null)).toBeNull();
  });

  test('findEntity matches invoiceId convention (sales-like store)', () => {
    const dir = makeDir();
    seed(dir, 'sales', { invoices: [{ invoiceId: 'INV-1', total: 10 }] });
    const repo = freshRepo('sales');
    expect(repo.findEntity('invoices', 'INV-1').total).toBe(10);
    expect(repo.findEntity('invoices', 'INV-2')).toBeNull();
  });

  test('findEntity on an empty/absent store returns null', () => {
    const dir = makeDir();
    const repo = freshRepo('users');
    expect(repo.findEntity('users', 'u1')).toBeNull();
    expect(repo.findEntity('missingCollection', 'u1')).toBeNull();
  });

  test('createEntity persists and returns the created entity', () => {
    const dir = makeDir();
    const repo = freshRepo('users');
    const created = repo.createEntity('users', { id: 'u9', name: 'Zoe' });
    expect(created).toEqual({ id: 'u9', name: 'Zoe' });
    expect(repo.findEntity('users', 'u9')).toEqual({ id: 'u9', name: 'Zoe' });
    const raw = fs.readFileSync(`${dir}/users.json`, 'utf-8');
    expect(raw).toContain('u9');
  });

  test('createEntity appends into an existing collection', () => {
    const dir = makeDir();
    seed(dir, 'users', { users: [{ id: 'u1', name: 'Ada' }] });
    const repo = freshRepo('users');
    repo.createEntity('users', { id: 'u2', name: 'Bob' });
    expect(repo.findEntity('users', 'u1')).toBeTruthy();
    expect(repo.findEntity('users', 'u2')).toBeTruthy();
  });

  test('createEntity refuses a duplicate identity (existing convention)', () => {
    const dir = makeDir();
    seed(dir, 'users', { users: [{ id: 'u1', name: 'Ada' }] });
    const repo = freshRepo('users');
    expect(repo.createEntity('users', { id: 'u1', name: 'Ada 2' })).toBeNull();
    expect(repo.findEntity('users', 'u1').name).toBe('Ada');
  });

  test('createEntity rejects non-object entities and invalid names', () => {
    const dir = makeDir();
    const repo = freshRepo('users');
    expect(repo.createEntity('users', 'nope')).toBeNull();
    expect(repo.createEntity('users', [1, 2])).toBeNull();
    expect(repo.createEntity('', { id: 'x' })).toBeNull();
    expect(repo.createEntity(null, { id: 'x' })).toBeNull();
    expect(repo.findEntity('users', 'x')).toBeNull();
  });

  test('updateEntity merges a patch and preserves identity', () => {
    const dir = makeDir();
    seed(dir, 'users', { users: [{ id: 'u1', name: 'Ada', role: 'Cashier' }] });
    const repo = freshRepo('users');
    const updated = repo.updateEntity('users', 'u1', { name: 'Ada Lovelace', role: 'Admin' });
    expect(updated.name).toBe('Ada Lovelace');
    expect(updated.role).toBe('Admin');
    expect(updated.id).toBe('u1');
    expect(repo.findEntity('users', 'u1').name).toBe('Ada Lovelace');
  });

  test('updateEntity cannot silently rename a record (identity preserved)', () => {
    const dir = makeDir();
    seed(dir, 'users', { users: [{ id: 'u1', name: 'Ada' }] });
    const repo = freshRepo('users');
    repo.updateEntity('users', 'u1', { id: 'u999', name: 'Renamed' });
    expect(repo.findEntity('users', 'u1').name).toBe('Renamed');
    expect(repo.findEntity('users', 'u999')).toBeNull();
  });

  test('updateEntity returns null when the entity is missing', () => {
    const dir = makeDir();
    seed(dir, 'users', { users: [{ id: 'u1', name: 'Ada' }] });
    const repo = freshRepo('users');
    expect(repo.updateEntity('users', 'ghost', { name: 'X' })).toBeNull();
    expect(repo.updateEntity('users', null, { name: 'X' })).toBeNull();
    expect(repo.updateEntity('missingCollection', 'u1', { name: 'X' })).toBeNull();
  });

  test('deleteEntity removes and returns true', () => {
    const dir = makeDir();
    seed(dir, 'users', { users: [{ id: 'u1', name: 'Ada' }, { id: 'u2', name: 'Bob' }] });
    const repo = freshRepo('users');
    expect(repo.deleteEntity('users', 'u2')).toBe(true);
    expect(repo.findEntity('users', 'u2')).toBeNull();
    expect(repo.findEntity('users', 'u1')).toBeTruthy();
    const raw = fs.readFileSync(`${dir}/users.json`, 'utf-8');
    expect(raw).not.toContain('"u2"');
  });

  test('deleteEntity returns false when missing', () => {
    const dir = makeDir();
    seed(dir, 'users', { users: [{ id: 'u1', name: 'Ada' }] });
    const repo = freshRepo('users');
    expect(repo.deleteEntity('users', 'ghost')).toBe(false);
    expect(repo.deleteEntity('users', null)).toBe(false);
    expect(repo.deleteEntity('missingCollection', 'u1')).toBe(false);
  });

  test('legacy repository methods remain intact', () => {
    const dir = makeDir();
    const repo = freshRepo('users');
    expect(typeof repo.read).toBe('function');
    expect(typeof repo.write).toBe('function');
    expect(typeof repo.readCollection).toBe('function');
    expect(typeof repo.findIn).toBe('function');
    expect(typeof repo.findIndexIn).toBe('function');

    const written = repo.write({ users: [{ id: 'u1', name: 'Ada' }] });
    expect(written).toBe(true);
    expect(repo.read().users).toHaveLength(1);
    expect(repo.readCollection('users')).toHaveLength(1);
    expect(repo.findIn(repo.readCollection('users'), u => u.id === 'u1').name).toBe('Ada');
    expect(repo.findIndexIn(repo.readCollection('users'), u => u.id === 'u1')).toBe(0);
    expect(repo.readCollection('missing')).toEqual([]);
  });

  test('tenant accessor returns null/false when not wired (unchanged)', () => {
    const dir = makeDir();
    const repo = freshRepo('users');
    expect(repo.getCurrentTenant()).toBeNull();
    expect(repo.hasTenant()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 12 — CREATE metadata stamping remains intact.
// ---------------------------------------------------------------------------
describe('Phase 21 — Phase 12 CREATE metadata stamping preserved', () => {
  beforeEach(() => {
    process.env.ENABLE_TENANT_METADATA = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'false';
  });

  test('createEntity inherits Phase 12 tenant stamping for new records', () => {
    const dir = makeDir();
    const accessor = { getCurrentTenant: () => ({ tenantId: 't1' }) };
    const repo = freshRepo('users', accessor);
    const created = repo.createEntity('users', { id: 'u-new', name: 'New' });
    expect(created.tenantId).toBe('t1');
    expect(repo.findEntity('users', 'u-new').tenantId).toBe('t1');
    const raw = fs.readFileSync(`${dir}/users.json`, 'utf-8');
    expect(raw).toContain('"tenantId": "t1"');
  });

  test('legacy write() stamping is byte-identical in behavior (existing vs new)', () => {
    const dir = makeDir();
    // Stage 1: persist an existing record with the flag OFF so it is unstamped.
    process.env.ENABLE_TENANT_METADATA = 'false';
    const plain = freshRepo('users');
    plain.write({ users: [{ id: 'existing', name: 'Old' }] });

    // Stage 2: turn stamping ON, add a NEW record through write().
    process.env.ENABLE_TENANT_METADATA = 'true';
    const accessor = { getCurrentTenant: () => ({ tenantId: 't1' }) };
    const repo = freshRepo('users', accessor);
    const db = repo.read();
    db.users = [...db.users, { id: 'new', name: 'New' }];
    expect(repo.write(db)).toBe(true);

    const after = freshRepo('users', accessor).read();
    const existing = after.users.find(u => u.id === 'existing');
    const created = after.users.find(u => u.id === 'new');
    expect(existing.tenantId).toBeUndefined();
    expect(created.tenantId).toBe('t1');
  });

  test('no accessor + flag ON => no stamping (Phase 12 gate unchanged)', () => {
    const dir = makeDir();
    const repo = freshRepo('users');
    const created = repo.createEntity('users', { id: 'u-plain', name: 'Plain' });
    expect(created.tenantId).toBeUndefined();
    expect(repo.findEntity('users', 'u-plain').tenantId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 13 — read-time filtering remains intact (findEntity inherits it).
// ---------------------------------------------------------------------------
describe('Phase 21 — Phase 13 read filtering preserved', () => {
  beforeEach(() => {
    process.env.ENABLE_TENANT_METADATA = 'false';
    process.env.ENABLE_TENANT_FILTERING = 'true';
  });

  const seedMixed = (dir) => seed(dir, 'users', {
    users: [
      { id: 'legacy', name: 'Legacy' },
      { id: 'mine', tenantId: 't1', name: 'Mine' },
      { id: 'other', tenantId: 't2', name: 'Other' }
    ]
  });

  test('read() filtering is unchanged (legacy + own tenant visible)', () => {
    const dir = makeDir();
    seedMixed(dir);
    const repo = freshRepo('users', { getCurrentTenant: () => ({ tenantId: 't1' }) });
    const ids = repo.read().users.map(u => u.id);
    expect(ids).toEqual(['legacy', 'mine']);
  });

  test('findEntity does not bypass filtering (hidden tenant record not found)', () => {
    const dir = makeDir();
    seedMixed(dir);
    const repo = freshRepo('users', { getCurrentTenant: () => ({ tenantId: 't1' }) });
    expect(repo.findEntity('users', 'legacy')).toBeTruthy();
    expect(repo.findEntity('users', 'mine')).toBeTruthy();
    expect(repo.findEntity('users', 'other')).toBeNull();
  });

  test('accessor present but flags OFF => no filtering (behavior unchanged)', () => {
    const dir = makeDir();
    seedMixed(dir);
    process.env.ENABLE_TENANT_FILTERING = 'false';
    const repo = freshRepo('users', { getCurrentTenant: () => ({ tenantId: 't1' }) });
    const ids = repo.read().users.map(u => u.id);
    expect(ids).toEqual(['legacy', 'mine', 'other']);
    expect(repo.hasTenant()).toBe(true);
  });
});