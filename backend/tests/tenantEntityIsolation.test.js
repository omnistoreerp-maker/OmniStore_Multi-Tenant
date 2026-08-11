'use strict';

// Phase 22 — Tenant Entity Isolation (additive, flag + accessor gated).
//
// Enforces tenant ownership at the repository entity boundary (BaseRepository)
// ONLY when ENABLE_TENANT_ENTITY_ISOLATION=true AND a trusted tenant accessor
// is wired. The current tenant always comes from the accessor (the trusted
// signed-request context) — never from body, query, X-Company-Id or raw JSON.
//
// Rules under isolation:
//   CREATE  -> missing tenantId is bound to the current tenant; a tenantId
//              claiming another tenant is rejected (null). No double stamping.
//   FIND    -> same-tenant or legacy (no tenantId) visible; other tenancy -> null
//              (applied explicitly even when Phase 13 filtering is off).
//   UPDATE  -> only records owned by the current tenant; legacy and other
//              tenancy rejected (null); a patch can never move/reassign owner.
//   DELETE  -> only records owned by the current tenant; legacy and other
//              tenancy rejected (false).
//   Legacy records stay readable but are read-only under isolation.
//   Rejections happen BEFORE persistence — store content is untouched.
//   Flag/accessor off => every method keeps its exact Phase 21 behaviour.

const fs = require('fs');
const { makeTempDataDir, seed } = require('./helpers/testData');

const ORIGINAL_ENV = {
  DIR: process.env.DIGITRONICS_DATA_DIR,
  MD: process.env.ENABLE_TENANT_METADATA,
  FLT: process.env.ENABLE_TENANT_FILTERING,
  ISO: process.env.ENABLE_TENANT_ENTITY_ISOLATION
};

const tempDirs = [];

function freshRepo(storeName, accessor) {
  jest.resetModules();
  const BaseRepository = require('../repositories/BaseRepository');
  return new BaseRepository(storeName, accessor);
}

function makeDir() {
  const dir = makeTempDataDir('tenant-iso');
  tempDirs.push(dir);
  process.env.DIGITRONICS_DATA_DIR = dir;
  return dir;
}

const accessorA = {
  getCurrentTenant: () => ({ tenantId: 'A-orange' })
};

const accessorB = {
  getCurrentTenant: () => ({ tenantId: 'B-blue' })
};

// users seeded with: one A-owned, one B-owned, one legacy (unowned), one ghost
function seedMixed(dir) {
  seed(dir, 'users', {
    users: [
      { id: 'mine', tenantId: 'A-orange', name: 'Mine' },
      { id: 'other', tenantId: 'B-blue', name: 'Other' },
      { id: 'legacy', name: 'Legacy' }
    ]
  });
}

function rawUsers(dir) {
  return fs.readFileSync(`${dir}/users.json`, 'utf-8');
}

afterAll(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  tempDirs.length = 0;
  const mapping = {
    DIGITRONICS_DATA_DIR: 'DIR',
    ENABLE_TENANT_METADATA: 'MD',
    ENABLE_TENANT_FILTERING: 'FLT',
    ENABLE_TENANT_ENTITY_ISOLATION: 'ISO'
  };
  for (const [envKey, origKey] of Object.entries(mapping)) {
    const orig = ORIGINAL_ENV[origKey];
    if (orig === undefined) delete process.env[envKey];
    else process.env[envKey] = orig;
  }
});

describe('Phase 22 — CREATE isolation', () => {
  beforeEach(() => {
    process.env.ENABLE_TENANT_METADATA = 'false';
    process.env.ENABLE_TENANT_FILTERING = 'false';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';
  });

  test('1. createEntity without tenantId binds the current tenant', () => {
    const dir = makeDir();
    const repo = freshRepo('users', accessorA);
    const created = repo.createEntity('users', { id: 'u-new', name: 'New' });
    expect(created.tenantId).toBe('A-orange');
    expect(repo.findEntity('users', 'u-new').tenantId).toBe('A-orange');
    const raw = rawUsers(dir);
    const record = JSON.parse(raw).users.find(u => u.id === 'u-new');
    expect(record.tenantId).toBe('A-orange');
  });

  test('2. createEntity with the same tenantId is allowed', () => {
    const dir = makeDir();
    const repo = freshRepo('users', accessorA);
    const created = repo.createEntity('users', { id: 'u-same', name: 'Same', tenantId: 'A-orange' });
    expect(created).not.toBeNull();
    expect(created.tenantId).toBe('A-orange');
  });

  test('3. createEntity claiming a foreign tenantId is rejected and not persisted', () => {
    const dir = makeDir();
    seed(dir, 'users', { users: [] });
    const before = rawUsers(dir);
    const repo = freshRepo('users', accessorA);
    expect(repo.createEntity('users', { id: 'u-bad', name: 'Bad', tenantId: 'B-blue' })).toBeNull();
    expect(repo.findEntity('users', 'u-bad')).toBeNull();
    expect(rawUsers(dir)).toBe(before);
  });

  test('4. isolation flag ON but NO tenant context => no invented tenant', () => {
    const dir = makeDir();
    const repo = freshRepo('users');
    const created = repo.createEntity('users', { id: 'u-plain', name: 'Plain' });
    expect(created).not.toBeNull();
    expect(created.tenantId).toBeUndefined();
    expect(repo.findEntity('users', 'u-plain').tenantId).toBeUndefined();
  });

  test('5. isolation flag OFF => foreign tenantId stored as-is (Phase 21 parity)', () => {
    const dir = makeDir();
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'false';
    const repo = freshRepo('users', accessorA);
    const created = repo.createEntity('users', { id: 'u-off', name: 'Off', tenantId: 'B-blue' });
    expect(created.tenantId).toBe('B-blue');
    expect(repo.findEntity('users', 'u-off').tenantId).toBe('B-blue');
  });
});

describe('Phase 22 — FIND isolation', () => {
  beforeEach(() => {
    process.env.ENABLE_TENANT_METADATA = 'false';
    process.env.ENABLE_TENANT_FILTERING = 'false';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';
  });

  test('6. own-tenant record is found', () => {
    const dir = makeDir();
    seedMixed(dir);
    const repo = freshRepo('users', accessorA);
    expect(repo.findEntity('users', 'mine').name).toBe('Mine');
  });

  test('7. other-tenant record is null even when Phase 13 filtering is OFF', () => {
    const dir = makeDir();
    seedMixed(dir);
    const repo = freshRepo('users', accessorA);
    expect(repo.findEntity('users', 'other')).toBeNull();
  });

  test('8. legacy (unowned) record remains visible', () => {
    const dir = makeDir();
    seedMixed(dir);
    const repo = freshRepo('users', accessorA);
    expect(repo.findEntity('users', 'legacy')).toEqual({ id: 'legacy', name: 'Legacy' });
  });

  test('9. missing record is null', () => {
    const dir = makeDir();
    seedMixed(dir);
    const repo = freshRepo('users', accessorA);
    expect(repo.findEntity('users', 'ghost')).toBeNull();
    expect(repo.findEntity('users', null)).toBeNull();
  });
});

describe('Phase 22 — UPDATE isolation', () => {
  beforeEach(() => {
    process.env.ENABLE_TENANT_METADATA = 'false';
    process.env.ENABLE_TENANT_FILTERING = 'false';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';
  });

  test('10. own-tenant record can be updated; ownership is preserved', () => {
    const dir = makeDir();
    seedMixed(dir);
    const repo = freshRepo('users', accessorA);
    const updated = repo.updateEntity('users', 'mine', { name: 'Mine v2' });
    expect(updated.name).toBe('Mine v2');
    expect(updated.tenantId).toBe('A-orange');
    expect(repo.findEntity('users', 'mine').name).toBe('Mine v2');
  });

  test('11. cross-tenant update is rejected (null) and not persisted', () => {
    const dir = makeDir();
    seedMixed(dir);
    const before = rawUsers(dir);
    const repo = freshRepo('users', accessorA);
    expect(repo.updateEntity('users', 'other', { name: 'Hijacked' })).toBeNull();
    expect(rawUsers(dir)).toBe(before);
  });

  test('12. foreign record remains byte-for-byte unchanged after rejected update', () => {
    const dir = makeDir();
    seedMixed(dir);
    const repo = freshRepo('users', accessorA);
    repo.updateEntity('users', 'other', { name: 'Hijacked' });
    const stored = JSON.parse(rawUsers(dir));
    expect(stored.users.find(u => u.id === 'other')).toEqual({ id: 'other', tenantId: 'B-blue', name: 'Other' });
  });

  test('13. a patch cannot move or reassign ownership (tenantId in body rejected)', () => {
    const dir = makeDir();
    seedMixed(dir);
    const repo = freshRepo('users', accessorA);
    expect(repo.updateEntity('users', 'mine', { tenantId: 'B-blue' })).toBeNull();
    expect(repo.updateEntity('users', 'mine', { name: 'OK', tenantId: 'B-blue' })).toBeNull();
    expect(repo.findEntity('users', 'mine').tenantId).toBe('A-orange');
  });

  test('14. legacy (unowned) record is read-only: update rejected', () => {
    const dir = makeDir();
    seedMixed(dir);
    const before = rawUsers(dir);
    const repo = freshRepo('users', accessorA);
    expect(repo.updateEntity('users', 'legacy', { name: 'Touched' })).toBeNull();
    expect(rawUsers(dir)).toBe(before);
  });

  test('15. rejected update leaves the whole store untouched (no partial write)', () => {
    const dir = makeDir();
    seedMixed(dir);
    const before = rawUsers(dir);
    const repo = freshRepo('users', accessorA);
    expect(repo.updateEntity('users', 'other', { name: 'Hijacked' })).toBeNull();
    expect(repo.updateEntity('users', 'legacy', { name: 'Touched' })).toBeNull();
    expect(rawUsers(dir)).toBe(before);
  });
});

describe('Phase 22 — DELETE isolation', () => {
  beforeEach(() => {
    process.env.ENABLE_TENANT_METADATA = 'false';
    process.env.ENABLE_TENANT_FILTERING = 'false';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';
  });

  test('16. own-tenant record can be deleted', () => {
    const dir = makeDir();
    seedMixed(dir);
    const repo = freshRepo('users', accessorA);
    expect(repo.deleteEntity('users', 'mine')).toBe(true);
    expect(repo.findEntity('users', 'mine')).toBeNull();
  });

  test('17. cross-tenant delete is rejected (false)', () => {
    const dir = makeDir();
    seedMixed(dir);
    const before = rawUsers(dir);
    const repo = freshRepo('users', accessorA);
    expect(repo.deleteEntity('users', 'other')).toBe(false);
    expect(rawUsers(dir)).toBe(before);
  });

  test('18. foreign record survives a rejected delete (byte-for-byte)', () => {
    const dir = makeDir();
    seedMixed(dir);
    const repo = freshRepo('users', accessorA);
    repo.deleteEntity('users', 'other');
    const stored = JSON.parse(rawUsers(dir));
    expect(stored.users.find(u => u.id === 'other')).toEqual({ id: 'other', tenantId: 'B-blue', name: 'Other' });
  });

  test('19. legacy record is read-only: delete rejected', () => {
    const dir = makeDir();
    seedMixed(dir);
    const before = rawUsers(dir);
    const repo = freshRepo('users', accessorA);
    expect(repo.deleteEntity('users', 'legacy')).toBe(false);
    expect(rawUsers(dir)).toBe(before);
  });

  test('20. other-tenant + legacy rejected together leave store fully intact', () => {
    const dir = makeDir();
    seedMixed(dir);
    const before = rawUsers(dir);
    const repo = freshRepo('users', accessorA);
    expect(repo.deleteEntity('users', 'other')).toBe(false);
    expect(repo.deleteEntity('users', 'legacy')).toBe(false);
    expect(repo.deleteEntity('users', 'ghost')).toBe(false);
    expect(rawUsers(dir)).toBe(before);
  });
});

describe('Phase 22 — security posture (context stays the ONLY authority)', () => {
  beforeEach(() => {
    process.env.ENABLE_TENANT_METADATA = 'false';
    process.env.ENABLE_TENANT_FILTERING = 'false';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';
  });

  test('header-claimed tenantId in the payload cannot leak into ownership transport', () => {
    // Simulates an "X-Company-Id"-style client assertion smuggled into JSON:
    // even when the payload carries another tenantId, the only thing that
    // matters is the trusted accessor. Cross-tenant create is still rejected.
    const dir = makeDir();
    seed(dir, 'users', { users: [] });
    const repo = freshRepo('users', accessorA);
    expect(repo.createEntity('users', { id: 'u-x', name: 'X', tenantId: 'B-blue' })).toBeNull();
    const before = rawUsers(dir);
    expect(repo.updateEntity('users', 'ghost', { tenantId: 'B-blue' })).toBeNull();
    expect(rawUsers(dir)).toBe(before);
  });

  test('claim/context mismatch cannot escalate: accessor is the single source', () => {
    // A record that itself claims to belong to the *other* tenant is never
    // writable or deletable by the current (A) context.
    const dir = makeDir();
    seedMixed(dir);
    const repo = freshRepo('users', accessorA);
    expect(repo.findEntity('users', 'other')).toBeNull();
    expect(repo.updateEntity('users', 'other', { name: 'Escalate' })).toBeNull();
    expect(repo.deleteEntity('users', 'other')).toBe(false);
  });

  test('query-style extra fields do not leak visibility (id alone is not enough)', () => {
    const dir = makeDir();
    seedMixed(dir);
    const repo = freshRepo('users', accessorA);
    // A "query" hint like ?tenantId=B-blue is, at this layer, just data:
    // the target record id resolves under the trusted tenant only.
    expect(repo.findEntity('users', 'other')).toBeNull();
    expect(repo.findEntity('users', 'mine')).toBeTruthy();
  });
});

describe('Phase 22 — interaction with Phase 12/13 (no regressions)', () => {
  test('find: filtering ON + isolation ON never leaks other tenancy (explicit rule)', () => {
    const dir = makeDir();
    seedMixed(dir);
    process.env.ENABLE_TENANT_METADATA = 'false';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';
    const repo = freshRepo('users', accessorA);
    const ids = repo.read().users.map(u => u.id);
    expect(ids).toEqual(['mine', 'legacy']);
    expect(repo.findEntity('users', 'other')).toBeNull();
  });

  test('create: metadata stamping + isolation bind exactly once (no double stamp)', () => {
    const dir = makeDir();
    process.env.ENABLE_TENANT_METADATA = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'false';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';
    const repo = freshRepo('users', accessorA);
    const created = repo.createEntity('users', { id: 'u-exact', name: 'Exact' });
    expect(created.tenantId).toBe('A-orange');
    const record = JSON.parse(rawUsers(dir)).users.find(u => u.id === 'u-exact');
    expect(record.tenantId).toBe('A-orange');
  });

  test('create: pre-existing legacy record is not touched by isolation+metadata', () => {
    const dir = makeDir();
    seed(dir, 'users', { users: [{ id: 'old', name: 'Old' }] });
    const before = rawUsers(dir);
    process.env.ENABLE_TENANT_METADATA = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'false';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';
    const repo = freshRepo('users', accessorA);
    repo.createEntity('users', { id: 'new', name: 'New' });
    const stored = JSON.parse(rawUsers(dir));
    const old = stored.users.find(u => u.id === 'old');
    expect(old).toEqual({ id: 'old', name: 'Old' });
    expect(stored.users.find(u => u.id === 'new').tenantId).toBe('A-orange');
    expect(before).not.toContain('tenantId');
  });

  test('regression: accessor present + isolation OFF => Phase 21 parity (create/update/delete/find)', () => {
    const dir = makeDir();
    seedMixed(dir);
    process.env.ENABLE_TENANT_METADATA = 'false';
    process.env.ENABLE_TENANT_FILTERING = 'false';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'false';
    const repo = freshRepo('users', accessorA);
    expect(repo.findEntity('users', 'other')).toEqual({ id: 'other', tenantId: 'B-blue', name: 'Other' });
    expect(repo.updateEntity('users', 'other', { name: 'Other v2' })).not.toBeNull();
    expect(repo.deleteEntity('users', 'legacy')).toBe(true);
    expect(repo.createEntity('users', { id: 'u-fresh', name: 'Fresh' })).not.toBeNull();
  });

  test('regression: flags OFF, NO accessor => entity API is liaison (Phase 21 defaults)', () => {
    const dir = makeDir();
    process.env.ENABLE_TENANT_METADATA = 'false';
    process.env.ENABLE_TENANT_FILTERING = 'false';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'false';
    const repo = freshRepo('users');
    const created = repo.createEntity('users', { id: 'u-a', name: 'A' });
    expect(created).toEqual({ id: 'u-a', name: 'A' });
    expect(repo.updateEntity('users', 'u-a', { name: 'A2' })).not.toBeNull();
    expect(repo.deleteEntity('users', 'u-a')).toBe(true);
    expect(repo.findEntity('users', 'u-a')).toBeNull();
  });

  test('regression: hasTenant/getCurrentTenant contract unchanged', () => {
    const dir = makeDir();
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';
    const repo = freshRepo('users');
    expect(repo.hasTenant()).toBe(false);
    expect(repo.getCurrentTenant()).toBeNull();
    const wired = freshRepo('users', accessorA);
    expect(wired.hasTenant()).toBe(true);
    expect(wired.getCurrentTenant().tenantId).toBe('A-orange');
  });
});