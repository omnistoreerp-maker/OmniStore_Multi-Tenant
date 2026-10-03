'use strict';

// platformAdminSeed.test.js — Master Control visibility bootstrap.
//
// The Control Center is only visible when every link of this chain holds:
//
//   ensureSeeded()            -> an entry in the platformAdmins store
//   platformRoleFor(user)     -> 'MASTER_OWNER' (server-authoritative)
//   GET /api/v1/platform/me   -> 200 { platformRole }
//   index.html                -> #platformMasterNav shown,
//                                canAccessPage('platform-master') === true
//
// Before the dev/test bootstrap, a fresh install with no PLATFORM_ADMINS
// configured left the store empty forever: /platform/me answered 404, every
// platform route answered 403 and the nav stayed display:none — with no way
// for an operator to get in. This suite pins the bootstrap AND its boundary
// so the fix can never drift into a production or privilege hole:
//
//   - development/test + empty store -> exactly ONE owner, no credential
//   - an operator's PLATFORM_ADMINS list always wins
//   - a store that already has entries is never overwritten
//   - production (and any unrecognised runtime) + empty store -> NO write
//   - the seeded identity reaches platform routes; nobody else does
//
// The store fixture is deliberately NOT written by this suite for the HTTP
// path: boot must produce it, which is the behaviour under test.

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');

const ROOT = path.resolve(__dirname, '..', '..');
const PASSWORD = 'Pass#123';
const tempDirs = [];

// Run `fn(config, service)` against a FRESH module registry bound to `dir`,
// booted the way the runtime under test would be. DIGITRONICS_DATA_DIR is
// pinned to a temp directory first, so no code path in here can ever resolve
// to the repository's backend/data.
function withFreshStore(dir, nodeEnv, extraEnv, fn) {
  const prevDir = process.env.DIGITRONICS_DATA_DIR;
  const prevEnv = process.env.NODE_ENV;
  const saved = {};
  jest.resetModules();
  process.env.DIGITRONICS_DATA_DIR = dir;
  process.env.NODE_ENV = nodeEnv;
  for (const key of Object.keys(extraEnv || {})) {
    saved[key] = process.env[key];
    if (extraEnv[key] === undefined) delete process.env[key];
    else process.env[key] = extraEnv[key];
  }
  try {
    return fn(require('../config'), require('../services/platformAdmin.service'));
  } finally {
    if (prevDir === undefined) delete process.env.DIGITRONICS_DATA_DIR;
    else process.env.DIGITRONICS_DATA_DIR = prevDir;
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    jest.resetModules();
  }
}

describe('Master Control bootstrap — admin-seed -> role', () => {
  afterAll(() => {
    tempDirs.forEach((d) => {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
    });
  });

  test('development/test: an empty store seeds exactly one owner and no credential', () => {
    const dir = makeTempDataDir('seed-dev');
    tempDirs.push(dir);
    withFreshStore(dir, 'test', { PLATFORM_ADMINS: undefined }, (config, service) => {
      expect(readStore(dir, 'platformAdmins')).toBeNull();

      const seeded = service.ensureSeeded();
      expect(seeded).toHaveLength(1);
      expect(seeded[0].username).toBe(service.DEV_BOOTSTRAP_OWNER);
      expect(seeded[0].platformRole).toBe('MASTER_OWNER');
      expect(seeded[0].status).toBe('active');

      // A username and a role — never a password, token or secret.
      const forbidden = ['password', 'token', 'secret', 'apikey', 'privatekey', 'jwt', 'hash'];
      for (const key of Object.keys(seeded[0])) {
        expect(forbidden).not.toContain(String(key).toLowerCase());
      }

      // role: the seeded identity resolves a real platform role...
      expect(service.platformRoleFor(service.DEV_BOOTSTRAP_OWNER)).toBe('MASTER_OWNER');
      expect(service.resolvePermissionsFor(service.DEV_BOOTSTRAP_OWNER).length).toBeGreaterThan(0);
      // ...and an ordinary username resolves nothing at all.
      expect(service.platformRoleFor('digiOwner')).toBeNull();
      expect(service.resolvePermissionsFor('digiOwner')).toEqual([]);
      expect(service.isPlatformAdmin('digiOwner')).toBe(false);

      // Idempotent: a second boot neither duplicates nor rewrites the entry.
      expect(service.ensureSeeded()).toHaveLength(1);
      expect(readStore(dir, 'platformAdmins').admins).toHaveLength(1);
    });
  });

  test('an operator PLATFORM_ADMINS list wins over the bootstrap', () => {
    const dir = makeTempDataDir('seed-env');
    tempDirs.push(dir);
    withFreshStore(dir, 'test', { PLATFORM_ADMINS: 'alice, bob' }, (config, service) => {
      const seeded = service.ensureSeeded();
      expect(seeded.map((e) => e.username)).toEqual(['alice', 'bob']);
      expect(service.platformRoleFor('alice')).toBe('MASTER_OWNER');
      expect(service.platformRoleFor('bob')).toBe('MASTER_OWNER');
      // The bootstrap identity is NOT added on top of operator configuration.
      expect(service.platformRoleFor(service.DEV_BOOTSTRAP_OWNER)).toBeNull();
      expect(readStore(dir, 'platformAdmins').admins).toHaveLength(2);
    });
  });

  test('a store that already has entries is never overwritten', () => {
    const dir = makeTempDataDir('seed-existing');
    tempDirs.push(dir);
    seed(dir, 'platformAdmins', {
      admins: [{ username: 'operator', platformRole: 'PLATFORM_ADMIN', status: 'active' }]
    });
    withFreshStore(dir, 'test', { PLATFORM_ADMINS: undefined }, (config, service) => {
      const result = service.ensureSeeded();
      expect(result).toHaveLength(1);
      expect(result[0].username).toBe('operator');
      expect(service.platformRoleFor(service.DEV_BOOTSTRAP_OWNER)).toBeNull();
      expect(readStore(dir, 'platformAdmins').admins).toHaveLength(1);
    });
  });

  test('production: an empty store stays empty — the bootstrap never writes', () => {
    const dir = makeTempDataDir('seed-prod');
    tempDirs.push(dir);
    withFreshStore(dir, 'production', { PLATFORM_ADMINS: undefined }, (config, service) => {
      // Prove the runtime under test really is production.
      expect(config.env).toBe('production');
      expect(config.isProduction).toBe(true);

      const result = service.ensureSeeded();
      expect(result).toEqual([]);
      // No file at all: a production store is created only by an operator.
      expect(readStore(dir, 'platformAdmins')).toBeNull();
      expect(service.platformRoleFor(service.DEV_BOOTSTRAP_OWNER)).toBe(null);
      expect(service.isPlatformAdmin(service.DEV_BOOTSTRAP_OWNER)).toBe(false);
      expect(service.resolvePermissionsFor(service.DEV_BOOTSTRAP_OWNER)).toEqual([]);
    });
  });

  test('production: an explicit operator PLATFORM_ADMINS list still seeds', () => {
    const dir = makeTempDataDir('seed-prod-env');
    tempDirs.push(dir);
    withFreshStore(dir, 'production', { PLATFORM_ADMINS: 'ops-owner' }, (config, service) => {
      expect(config.env).toBe('production');
      const seeded = service.ensureSeeded();
      expect(seeded.map((e) => e.username)).toEqual(['ops-owner']);
      expect(service.platformRoleFor('ops-owner')).toBe('MASTER_OWNER');
      expect(service.platformRoleFor(service.DEV_BOOTSTRAP_OWNER)).toBeNull();
    });
  });

  test('an unrecognised runtime (staging) never receives a seeded owner', () => {
    const dir = makeTempDataDir('seed-staging');
    tempDirs.push(dir);
    withFreshStore(dir, 'staging', { PLATFORM_ADMINS: undefined }, (config, service) => {
      expect(service.ensureSeeded()).toEqual([]);
      expect(readStore(dir, 'platformAdmins')).toBeNull();
      expect(service.platformRoleFor(service.DEV_BOOTSTRAP_OWNER)).toBeNull();
    });
  });
});

describe('Master Control bootstrap — role -> visibility/access over HTTP', () => {
  let server;
  let dataDir;
  let masterToken;
  let ownerToken;
  let ORIGINAL_FLAGS;

  const companies = [{ id: 'digi', name: 'DigiTronics', code: 'DIGI', active: true }];
  const stamp = new Date().toISOString();
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const users = {
    users: [
      // The bootstrap identity: no platformAdmins fixture is written by this
      // suite, so if this user can reach platform scope, boot seeded it.
      { id: 'u-master', username: 'master', password: hash, role: 'Viewer', fullName: 'Platform Master', createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      // An ordinary tenant Owner — must never be visible to platform scope.
      {
        id: 'u-digi', username: 'digiOwner', password: hash, role: 'Owner',
        fullName: 'Digi Owner', tenantIds: ['digi'], tenantRoles: { digi: 'Owner' },
        createdAt: stamp, updatedAt: stamp, tokenVersion: 0
      }
    ]
  };

  beforeAll(async () => {
    ORIGINAL_FLAGS = {
      CARRY: process.env.ENABLE_TENANT_CARRY,
      MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
      ROLES: process.env.ENABLE_TENANT_ROLES
    };
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    delete process.env.PLATFORM_ADMINS;
    dataDir = makeTempDataDir('seed-http');
    tempDirs.push(dataDir);
    seed(dataDir, 'companies', companies);
    seed(dataDir, 'users', users);
    // platformAdmins is deliberately NOT seeded: boot must create it.
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
    ownerToken = (await login(server.app, 'digiOwner', PASSWORD, 'digi')).accessToken;
    expect(masterToken).toBeTruthy();
    expect(ownerToken).toBeTruthy();
  });

  afterAll(() => {
    if (ORIGINAL_FLAGS.CARRY === undefined) delete process.env.ENABLE_TENANT_CARRY; else process.env.ENABLE_TENANT_CARRY = ORIGINAL_FLAGS.CARRY;
    if (ORIGINAL_FLAGS.MC === undefined) delete process.env.ENABLE_MULTI_COMPANY_LOGIN; else process.env.ENABLE_MULTI_COMPANY_LOGIN = ORIGINAL_FLAGS.MC;
    if (ORIGINAL_FLAGS.ROLES === undefined) delete process.env.ENABLE_TENANT_ROLES; else process.env.ENABLE_TENANT_ROLES = ORIGINAL_FLAGS.ROLES;
  });

  test('the boot path seeds the store — no fixture wrote it', () => {
    const stored = readStore(dataDir, 'platformAdmins');
    expect(stored).not.toBeNull();
    expect(stored.admins).toHaveLength(1);
    expect(stored.admins[0].username).toBe('master');
    expect(stored.admins[0].platformRole).toBe('MASTER_OWNER');
  });

  test('seed -> role: GET /platform/me returns the seeded platform role', async () => {
    const res = await request(server.app)
      .get('/api/v1/platform/me')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.platformRole).toBe('MASTER_OWNER');
  });

  test('role -> access: the seeded owner passes requirePlatformAdmin', async () => {
    const res = await request(server.app)
      .get('/api/v1/platform/companies')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(res.status).toBe(200);
  });

  test('an ordinary tenant Owner is invisible to platform scope', async () => {
    const me = await request(server.app)
      .get('/api/v1/platform/me')
      .set('Authorization', 'Bearer ' + ownerToken);
    // Fail-closed identity: 404, so a normal user learns nothing exists.
    expect(me.status).toBe(404);

    const route = await request(server.app)
      .get('/api/v1/platform/companies')
      .set('Authorization', 'Bearer ' + ownerToken);
    expect(route.status).toBe(403);
    expect(route.body.details && route.body.details.code).toBe('PLATFORM_ADMIN_REQUIRED');
  });

  test('anonymous is rejected before any role logic runs', async () => {
    expect((await request(server.app).get('/api/v1/platform/me')).status).toBe(401);
    expect((await request(server.app).get('/api/v1/platform/companies')).status).toBe(401);
  });

  test('visibility: the 200 role is exactly what index.html turns into a visible nav', () => {
    // The behavioural nav mapping itself is pinned by
    // frontendPlatformGating.test.js; this asserts the contract the seed
    // feeds into still exists, i.e. that a server-issued platformRole is the
    // only thing that reveals the Control Center.
    const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    expect(page).toContain('id="platformMasterNav"');
    expect(page).toContain("nav.style.display = platformRole ? '' : 'none'");
    expect(page).toContain("if (page === 'platform-master') return !!platformRole && USE_BACKEND;");
  });
});
