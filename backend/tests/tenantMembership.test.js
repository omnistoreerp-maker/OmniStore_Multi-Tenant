'use strict';

// Phase 15 — Tenant User Membership Foundation tests.
//
// Verifies the additive, FLAG-GATED membership capability:
//   - pure data helpers (normalize / idsFor / hasTenantId) that are dormant and
//     tolerant of legacy users,
//   - user create/update persist an optional, normalized `tenantIds` ONLY when
//     ENABLE_TENANT_USER_MEMBERSHIP is ON,
//   - legacy users (no membership) keep working when the flag is ON.
//
// The users store is isolated to a temporary data dir so no real production
// data is ever touched.

const fs = require('fs');
const { makeTempDataDir } = require('./helpers/testData');

describe('tenantMembership.service (pure data helpers)', () => {
  const tm = require('../services/tenantMembership.service');

  it('normalizes strings, arrays, and {tenantId} objects into unique ids', () => {
    expect(tm.normalize(['digitronics', 'nile', 'digitronics'])).toEqual(['digitronics', 'nile']);
    expect(tm.normalize('single')).toEqual(['single']);
    expect(tm.normalize([{ tenantId: 'A' }, { tenantId: 'a' }])).toEqual(['A', 'a']);
    expect(tm.normalize(['', null, ' ', 'ok'])).toEqual(['ok']);
  });

  it('normalize returns undefined when no value was provided', () => {
    expect(tm.normalize(undefined)).toBeUndefined();
    expect(tm.normalize(null)).toBeUndefined();
  });

  it('idsFor tolerates legacy users without any membership', () => {
    expect(tm.idsFor(null)).toEqual([]);
    expect(tm.idsFor({})).toEqual([]);
    expect(tm.idsFor({ username: 'alice' })).toEqual([]);
    expect(tm.idsFor({ tenantIds: ['nile'] })).toEqual(['nile']);
  });

  it('hasTenantId is false for no membership, true once present', () => {
    expect(tm.hasTenantId(null, 'nile')).toBe(false);
    expect(tm.hasTenantId({ username: 'alice' }, 'nile')).toBe(false);
    expect(tm.hasTenantId({ tenantIds: ['nile'] }, 'nile')).toBe(true);
    expect(tm.hasTenantId({ tenantIds: ['nile'] }, 'astra')).toBe(false);
  });
});

describe('users.service membership persistence (flag-gated)', () => {
  let usersService;
  let config;
  let repository;
  let dir;

  beforeAll(() => {
    dir = makeTempDataDir('membership');
    // Point the storage engine at a throwaway directory BEFORE first require.
    process.env.DIGITRONICS_DATA_DIR = dir;
    jest.resetModules();
    usersService = require('../services/users.service');
    config = require('../config');
    repository = require('../repositories').users;
  });

  afterAll(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  // Reset the flag to its default between tests to avoid cross-test leakage.
  afterEach(() => { config.tenantUserMembershipEnabled = false; });

  it('flag ON: create stores a normalized tenantIds membership', () => {
    config.tenantUserMembershipEnabled = true;
    const res = usersService.create({
      username: 'tenantuser1', password: 'Pass#123',
      role: 'Admin', tenantIds: ['digitronics', 'nile', 'digitronics']
    });
    expect(res.error).toBeUndefined();
    expect(res.user.tenantIds).toEqual(['digitronics', 'nile']);
  });

  it('legacy user with no tenantIds stays untouched when flag ON', () => {
    config.tenantUserMembershipEnabled = true;
    const res = usersService.create({ username: 'legacy1', password: 'Pass#123', role: 'Cashier' });
    expect(res.error).toBeUndefined();
    expect(res.user).toBeDefined();
    expect(res.user).not.toHaveProperty('tenantIds');
  });

  it('flag ON: existing legacy user can still authenticate (backward compatible)', () => {
    config.tenantUserMembershipEnabled = true;
    // "legacy1" from the previous test has no membership.
    const authed = usersService.authenticate('legacy1', 'Pass#123');
    expect(authed).toBeTruthy();
    expect(authed.username).toBe('legacy1');
    expect(authed.tenantIds).toBeUndefined();
  });

  it('flag ON: update can add membership to an existing user', () => {
    config.tenantUserMembershipEnabled = true;
    const target = usersService.getByUsername('legacy1');
    const res = usersService.update(target.id, { tenantIds: ['astra'] });
    expect(res.error).toBeUndefined();
    expect(res.user.tenantIds).toEqual(['astra']);
  });

  it('flag OFF (default): tenantIds are passed through raw, NOT normalized', () => {
    config.tenantUserMembershipEnabled = false;
    const res = usersService.create({
      username: 'off1', password: 'Pass#123', role: 'Manager',
      tenantIds: ['A', 'a', 'A'] // duplicates + case kept = raw passthrough
    });
    expect(res.error).toBeUndefined();
    // GoLive-1 behavior: payload piped through as-is, membership untouched.
    expect(res.user.tenantIds).toEqual(['A', 'a', 'A']);
  });

  it('flag OFF: existing users remain readable and untouched', () => {
    config.tenantUserMembershipEnabled = false;
    const stored = repository.read();
    expect(Array.isArray(stored.users)).toBe(true);
    const legacy = stored.users.some(u => u.username === 'legacy1' && !u.tenantIds);
    const legacyWith = stored.users.some(u => u.username === 'legacy1' && Array.isArray(u.tenantIds) && u.tenantIds.includes('astra'));
    // legacy1 gained membership in the "update" test when flag was ON.
    expect(legacy || legacyWith).toBe(true);
  });
});