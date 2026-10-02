'use strict';

// controlCenterSecurity.test.js â€” security regression suite for the Platform
// Control Center reapply (branch security/control-center-hardening-reapply-20261002,
// BASE=65c7f39, official 4-role architecture).
//
//   F1 FILE_EXPOSURE       â€” traversal/dot-segment/encoded/manifest paths must
//                            never reach server-side files (guard runs before
//                            express.static on the NORMALIZED+DECODED path).
//   F2 AUTHORIZATION       â€” tenant-Owner account management requires
//                            platform.security.manage (MASTER_OWNER-level);
//                            team mutations require platform.team.manage;
//                            LAST_OWNER / LAST_MASTER stay ADDITIONAL layers.
//   F3 OFFICIAL_ROLES      â€” DEVELOPER / DATA_ENTRY are official registry
//                            roles: grantable by MASTER_OWNER and usable on
//                            their official surfaces (no over-block).
//   F4 UNKNOWN_ROLE        â€” roles outside the official registry FAIL CLOSED
//                            at every gate (DENY, never a default ALLOW).
//   F5 AUDIT_SECURITY      â€” authorization/bearer/credential material is
//                            redacted; actor attribution stays server-derived;
//                            diagnostics/dashboard/activity never echo it.
//   F6 CATALOG_VALIDATION  â€” an add-on is never persisted for a tenant that
//                            does not exist (400, store untouched).
//   F7 LAST_MASTER         â€” last active MASTER_OWNER cannot be demoted,
//                            disabled or removed (409); 2-owner case allowed.
//   F8 ADMIN_BOUNDARY      â€” DEVELOPER / DATA_ENTRY / PLATFORM_ADMIN are
//                            denied team/role/security surfaces and allowed
//                            on their official ones.

const http = require('http');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const PASSWORD = 'Pass#123';
const stamp = new Date().toISOString();
const tempDirs = [];
let rawPort = 0;

const companies = [
  { id: 'digi', name: 'DigiTronics', code: 'DIGI', active: true },
  { id: 'nile', name: 'Nile Electronics', code: 'NILE', active: true }
];

function hash(pw) {
  return bcrypt.hashSync(pw, 10);
}

function makeUsers() {
  return { users: [
    { id: 'u-master', username: 'master', password: hash(PASSWORD), role: 'Viewer', fullName: 'Platform Master', tenantIds: [], createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
    { id: 'u-padmin', username: 'padmin', password: hash(PASSWORD), role: 'Viewer', fullName: 'Platform Operator', tenantIds: [], createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
    { id: 'u-owner', username: 'digiOwner', password: hash(PASSWORD), role: 'Owner', fullName: 'Digi Owner', tenantIds: ['digi'], tenantRoles: { digi: 'Owner' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
    { id: 'u-mgr', username: 'digiManager', password: hash(PASSWORD), role: 'Manager', fullName: 'Digi Manager', tenantIds: ['digi'], tenantRoles: { digi: 'Manager' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
    { id: 'u-dev', username: 'devuser', password: hash(PASSWORD), role: 'Technician', fullName: 'Developer User', tenantIds: ['digi'], tenantRoles: { digi: 'Technician' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
    { id: 'u-data', username: 'dataentry', password: hash(PASSWORD), role: 'Cashier', fullName: 'Data Entry User', tenantIds: ['digi'], tenantRoles: { digi: 'Cashier' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
    { id: 'u-ghost', username: 'ghost', password: hash(PASSWORD), role: 'Viewer', fullName: 'Injected Role', tenantIds: ['digi'], tenantRoles: { digi: 'Viewer' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 }
  ] };
}

// Base members. Suites add OFFICIAL entries (dev/data) or the on-purpose
// off-registry entry (ghost) as needed.
function baseAdmins() {
  return { admins: [
    { username: 'master', platformRole: 'MASTER_OWNER', status: 'active', createdAt: stamp, updatedAt: stamp },
    { username: 'padmin', platformRole: 'PLATFORM_ADMIN', status: 'active', createdAt: stamp, updatedAt: stamp }
  ] };
}

function seedAll(dir, extraAdmins) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', makeUsers());
  const admins = baseAdmins();
  admins.admins = admins.admins.concat(extraAdmins || []);
  seed(dir, 'platformAdmins', admins);
}

const FLAGS = ['ENABLE_TENANT_CARRY', 'ENABLE_MULTI_COMPANY_LOGIN', 'ENABLE_TENANT_ROLES'];
const ORIGINAL_FLAGS = {};

function setFlags() {
  for (const k of FLAGS) ORIGINAL_FLAGS[k] = process.env[k];
  process.env.ENABLE_TENANT_CARRY = 'true';
  process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
  process.env.ENABLE_TENANT_ROLES = 'true';
}

function restoreFlags() {
  for (const k of FLAGS) {
    if (ORIGINAL_FLAGS[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_FLAGS[k];
  }
}

// Verbatim-path HTTP GET: Node's http client forwards the path EXACTLY as
// given (no client-side normalization) â€” the same shape the audit probe used
// to prove the static-tree exposure.
function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: rawPort, path: rawPath, method: 'GET' },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------- F1

describe('F1. FILE_EXPOSURE â€” traversal guard runs before express.static', () => {
  let server;
  let dataDir;
  let rawServer;

  const deniedPaths = [
    '/backend/server.js',
    '/x/../backend/server.js',
    '/./backend/server.js',
    '/foo%2f..%2fbackend%2fserver.js',
    '/x/../../backend/server.js',
    '/%2e%2e/backend/server.js',
    '/..%2fbackend/server.js',
    '/%62ackend/server.js',
    '/x/../backend/.env',
    '/.env',
    '/.git/config',
    '/package.json',
    '/package-lock.json',
    '/x/../backend/data/platformAdmins.json',
    '/x/../backend/data/users.json',
    '/docs/REAL_REPOSITORY_RECONCILIATION.md',
    '/x/../tests/e2e/backend-sync.spec.js'
  ];

  const forbiddenMarkers = ['module.exports', 'PRIVATE_PREFIXES', 'JWT_SECRET', '"admins"', 'BEGIN PRIVATE KEY', '"devDependencies"'];

  beforeAll(async () => {
    dataDir = makeTempDataDir('cc-file-exposure');
    tempDirs.push(dataDir);
    seedAll(dataDir);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    rawServer = http.createServer(server.app).listen(0);
    await new Promise((r) => rawServer.once('listening', r));
    rawPort = rawServer.address().port;
  });

  afterAll(async () => {
    if (rawServer) await new Promise((r) => rawServer.close(r));
  });

  for (const p of deniedPaths) {
    test(`denied: ${p}`, async () => {
      const res = await rawGet(p);
      expect([400, 403, 404]).toContain(res.status);
      for (const marker of forbiddenMarkers) {
        expect(res.body).not.toContain(marker);
      }
    });
  }

  test('legitimate frontend files are still served (guard does not over-block)', async () => {
    const page = await rawGet('/index.html');
    expect(page.status).toBe(200);
    const platformPage = await rawGet('/platform.html');
    expect(platformPage.status).toBe(200);
  });

  test('supertest client path: /backend/server.js stays 403', async () => {
    const res = await request(server.app).get('/backend/server.js');
    expect(res.status).toBe(403);
  });
});

// ------------------------------------------------------- F2 + F7 + F8 core

describe('F2/F7/F8. AUTHORIZATION â€” owner gate, team gate, last-owner layers', () => {
  let server;
  let dataDir;
  let masterToken;
  let padminToken;
  let devToken;
  let entryToken;
  let ownerToken;

  beforeAll(async () => {
    setFlags();
    dataDir = makeTempDataDir('cc-authz');
    tempDirs.push(dataDir);
    seedAll(dataDir, [
      { username: 'devuser', platformRole: 'DEVELOPER', status: 'active', createdAt: stamp, updatedAt: stamp },
      { username: 'dataentry', platformRole: 'DATA_ENTRY', status: 'active', createdAt: stamp, updatedAt: stamp }
    ]);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
    padminToken = (await login(server.app, 'padmin', PASSWORD)).accessToken;
    devToken = (await login(server.app, 'devuser', PASSWORD, 'digi')).accessToken;
    entryToken = (await login(server.app, 'dataentry', PASSWORD, 'digi')).accessToken;
    ownerToken = (await login(server.app, 'digiOwner', PASSWORD, 'digi')).accessToken;
  });

  afterAll(restoreFlags);

  // ---- team mutations are platform.team.manage (MASTER_OWNER-level) ----

  test('PLATFORM_ADMIN cannot grant a platform role (403, store unchanged)', async () => {
    const before = JSON.stringify(readStore(dataDir, 'platformAdmins'));
    const res = await request(server.app)
      .post('/api/v1/platform/admins')
      .set('Authorization', 'Bearer ' + padminToken)
      .send({ username: 'digiManager', platformRole: 'PLATFORM_ADMIN' });
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('PLATFORM_PERMISSION_DENIED');
    expect(JSON.stringify(readStore(dataDir, 'platformAdmins'))).toBe(before);
  });

  test('PLATFORM_ADMIN cannot self-promote via PATCH (403, store unchanged)', async () => {
    const before = JSON.stringify(readStore(dataDir, 'platformAdmins'));
    const res = await request(server.app)
      .patch('/api/v1/platform/admins/padmin')
      .set('Authorization', 'Bearer ' + padminToken)
      .send({ platformRole: 'MASTER_OWNER' });
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('PLATFORM_PERMISSION_DENIED');
    expect(JSON.stringify(readStore(dataDir, 'platformAdmins'))).toBe(before);
  });

  test('PLATFORM_ADMIN cannot revoke a MASTER_OWNER (403, store unchanged)', async () => {
    const before = JSON.stringify(readStore(dataDir, 'platformAdmins'));
    const res = await request(server.app)
      .delete('/api/v1/platform/admins/master')
      .set('Authorization', 'Bearer ' + padminToken);
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('PLATFORM_PERMISSION_DENIED');
    expect(JSON.stringify(readStore(dataDir, 'platformAdmins'))).toBe(before);
  });

  // ---- tenant-Owner account management: platform.security.manage ----

  test('PLATFORM_ADMIN cannot reset a tenant Owner password (403 role gate)', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform/users/u-owner/reset-password')
      .set('Authorization', 'Bearer ' + padminToken)
      .send({ newPassword: 'Hijacked#999' });
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('OWNER_MANAGEMENT_FORBIDDEN');
  });

  test('PLATFORM_ADMIN disabling a tenant Owner hits the role gate FIRST (403, not last-owner-only)', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform/users/u-owner/disable')
      .set('Authorization', 'Bearer ' + padminToken)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('OWNER_MANAGEMENT_FORBIDDEN');
    const store = readStore(dataDir, 'users');
    expect(store.users.find((u) => u.id === 'u-owner').status || 'active').toBe('active');
  });

  test('PLATFORM_ADMIN cannot force-logout a tenant Owner (403)', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform/users/u-owner/force-logout')
      .set('Authorization', 'Bearer ' + padminToken)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('OWNER_MANAGEMENT_FORBIDDEN');
  });

  test('PLATFORM_ADMIN cannot enable a tenant Owner (403)', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform/users/u-owner/enable')
      .set('Authorization', 'Bearer ' + padminToken)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('OWNER_MANAGEMENT_FORBIDDEN');
  });

  test('PLATFORM_ADMIN keeps normal-user management (no over-block: reset ordinary user 200)', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform/users/u-mgr/reset-password')
      .set('Authorization', 'Bearer ' + padminToken)
      .send({ newPassword: 'Regular#1111' });
    expect(res.status).toBe(200);
  });

  test('LAST_OWNER stays an additional layer for MASTER_OWNER (409, not 200)', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform/users/u-owner/disable')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.details && res.body.details.code).toBe('LAST_OWNER_PROTECTION');
  });

  test('MASTER_OWNER can reset a tenant Owner password (permission holder, no over-block)', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform/users/u-owner/reset-password')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ newPassword: 'OwnerKept#2222' });
    expect(res.status).toBe(200);
  });

  // ---- last MASTER_OWNER layers (409 with current-architecture messages) ----

  test('last MASTER_OWNER cannot be demoted (409, role stays)', async () => {
    const res = await request(server.app)
      .patch('/api/v1/platform/admins/master')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ platformRole: 'PLATFORM_ADMIN' });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('last active MASTER_OWNER');
    const store = readStore(dataDir, 'platformAdmins');
    expect(store.admins.find((a) => a.username === 'master').platformRole).toBe('MASTER_OWNER');
  });

  test('last MASTER_OWNER cannot be disabled (409, status stays active)', async () => {
    const res = await request(server.app)
      .patch('/api/v1/platform/admins/master')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ status: 'disabled' });
    expect(res.status).toBe(409);
    const store = readStore(dataDir, 'platformAdmins');
    expect(store.admins.find((a) => a.username === 'master').status).toBe('active');
  });

  test('last MASTER_OWNER cannot be removed (409, store keeps entry)', async () => {
    const res = await request(server.app)
      .delete('/api/v1/platform/admins/master')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('last active MASTER_OWNER');
    const store = readStore(dataDir, 'platformAdmins');
    expect(store.admins.some((a) => a.username === 'master')).toBe(true);
  });

  test('with two MASTER_OWNERs one owner CAN be demoted/removed (allowed case)', async () => {
    const cc = require('../services/platformControlCenter.service');
    const platformAdmin = require('../services/platformAdmin.service');
    const actor = { id: 'u-master', username: 'master' };

    const added = cc.addTeamMember(actor, { username: 'second', platformRole: 'MASTER_OWNER' });
    expect(added.member).toBeTruthy();
    expect(platformAdmin.activeOwnerCount()).toBe(2);

    const demoted = cc.updateTeamMember(actor, 'second', { platformRole: 'PLATFORM_ADMIN' });
    expect(demoted.member.platformRole).toBe('PLATFORM_ADMIN');
    expect(platformAdmin.activeOwnerCount()).toBe(1);

    const removedNonOwner = cc.removeTeamMember(actor, 'second');
    expect(removedNonOwner.ok).toBe(true);

    const readded = cc.addTeamMember(actor, { username: 'second', platformRole: 'MASTER_OWNER' });
    expect(readded.member).toBeTruthy();
    expect(platformAdmin.activeOwnerCount()).toBe(2);

    const removed = cc.removeTeamMember(actor, 'second');
    expect(removed.ok).toBe(true);
    expect(platformAdmin.activeOwnerCount()).toBe(1);
  });

  test('MASTER_OWNER can still manage non-master members (control retained)', async () => {
    const revoke = await request(server.app)
      .delete('/api/v1/platform/admins/padmin')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(revoke.status).toBe(200);
    const grant = await request(server.app)
      .post('/api/v1/platform/admins')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ username: 'padmin', platformRole: 'PLATFORM_ADMIN' });
    expect(grant.status).toBe(200);
  });

  // ---- boundary matrix: DEVELOPER / DATA_ENTRY / PLATFORM_ADMIN ----

  test('DEVELOPER is denied team management surfaces (read+write)', async () => {
    const read = await request(server.app)
      .get('/api/v1/platform/admins')
      .set('Authorization', 'Bearer ' + devToken);
    expect(read.status).toBe(403);
    const write = await request(server.app)
      .post('/api/v1/platform/admins')
      .set('Authorization', 'Bearer ' + devToken)
      .send({ username: 'digiManager', platformRole: 'DEVELOPER' });
    expect(write.status).toBe(403);
  });

  test('DATA_ENTRY is denied team management surfaces (read+write)', async () => {
    const read = await request(server.app)
      .get('/api/v1/platform/admins')
      .set('Authorization', 'Bearer ' + entryToken);
    expect(read.status).toBe(403);
    const write = await request(server.app)
      .post('/api/v1/platform/admins')
      .set('Authorization', 'Bearer ' + entryToken)
      .send({ username: 'digiManager', platformRole: 'DATA_ENTRY' });
    expect(write.status).toBe(403);
  });

  test('PLATFORM_ADMIN can READ the team (team.view official) but not the matrix', async () => {
    const read = await request(server.app)
      .get('/api/v1/platform/admins')
      .set('Authorization', 'Bearer ' + padminToken);
    expect(read.status).toBe(200);
    const matrix = await request(server.app)
      .get('/api/v1/platform/control-center/matrix')
      .set('Authorization', 'Bearer ' + padminToken);
    expect(matrix.status).toBe(403);
  });

  test('PLATFORM_ADMIN can read audit (audit.view official) but not diagnostics', async () => {
    const audit = await request(server.app)
      .get('/api/v1/platform/audit')
      .set('Authorization', 'Bearer ' + padminToken);
    expect(audit.status).toBe(200);
    const diag = await request(server.app)
      .get('/api/v1/platform/control-center/diagnostics')
      .set('Authorization', 'Bearer ' + padminToken);
    expect(diag.status).toBe(403);
  });

  test('DEVELOPER official surfaces: diagnostics+audit allowed, legacy broad gate denied', async () => {
    const diag = await request(server.app)
      .get('/api/v1/platform/control-center/diagnostics')
      .set('Authorization', 'Bearer ' + devToken);
    expect(diag.status).toBe(200);
    const audit = await request(server.app)
      .get('/api/v1/platform/audit')
      .set('Authorization', 'Bearer ' + devToken);
    expect(audit.status).toBe(200);
    const summary = await request(server.app)
      .get('/api/v1/platform/summary')
      .set('Authorization', 'Bearer ' + devToken);
    expect(summary.status).toBe(403);
    expect(summary.body.details && summary.body.details.code).toBe('PLATFORM_ADMIN_REQUIRED');
  });

  test('DATA_ENTRY official surfaces: catalog allowed, security surfaces denied', async () => {
    const catalog = await request(server.app)
      .get('/api/v1/platform/control-center/catalog')
      .set('Authorization', 'Bearer ' + entryToken);
    expect(catalog.status).toBe(200);
    const created = await request(server.app)
      .post('/api/v1/platform/control-center/catalog')
      .set('Authorization', 'Bearer ' + entryToken)
      .send({ title: 'Data entry probe' });
    expect(created.status).toBe(201);
    const audit = await request(server.app)
      .get('/api/v1/platform/audit')
      .set('Authorization', 'Bearer ' + entryToken);
    expect(audit.status).toBe(403);
    const summary = await request(server.app)
      .get('/api/v1/platform/summary')
      .set('Authorization', 'Bearer ' + entryToken);
    expect(summary.status).toBe(403);
    const matrix = await request(server.app)
      .get('/api/v1/platform/control-center/matrix')
      .set('Authorization', 'Bearer ' + entryToken);
    expect(matrix.status).toBe(403);
  });

  test('tenant Owner still has zero platform access (role isolation intact)', async () => {
    // The earlier MASTER_OWNER reset changed the Owner's password and bumped
    // tokenVersion — a fresh login with the NEW password proves the ROLE gate,
    // not a revoked token.
    ownerToken = (await login(server.app, 'digiOwner', 'OwnerKept#2222', 'digi')).accessToken;
    const res = await request(server.app)
      .get('/api/v1/platform/summary')
      .set('Authorization', 'Bearer ' + ownerToken);
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('PLATFORM_ADMIN_REQUIRED');
  });
});

// ---------------------------------------------------------------- F3

describe('F3. OFFICIAL_ROLES â€” registry is the single source of truth', () => {
  let server;
  let dataDir;
  let masterToken;
  let devToken;
  let entryToken;

  beforeAll(async () => {
    setFlags();
    dataDir = makeTempDataDir('cc-official');
    tempDirs.push(dataDir);
    seedAll(dataDir); // no dev/entry entries yet â€” granted through the API
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
  });

  afterAll(restoreFlags);

  test('registry lists exactly the four official roles', () => {
    const registry = require('../permissions/platformRegistry');
    expect(registry.PLATFORM_ROLES).toEqual(['MASTER_OWNER', 'PLATFORM_ADMIN', 'DEVELOPER', 'DATA_ENTRY']);
    for (const role of registry.PLATFORM_ROLES) {
      expect(registry.isPlatformRole(role)).toBe(true);
    }
    expect(registry.isPlatformRole('HACKER')).toBe(false);
    expect(registry.isPlatformRole('')).toBe(false);
  });

  test('MASTER_OWNER can grant DEVELOPER (official role -> 200 + persisted)', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform/admins')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ username: 'devuser', platformRole: 'DEVELOPER' });
    expect(res.status).toBe(200);
    const store = readStore(dataDir, 'platformAdmins');
    expect(store.admins.find((a) => a.username === 'devuser').platformRole).toBe('DEVELOPER');
  });

  test('MASTER_OWNER can grant DATA_ENTRY (official role -> 200 + persisted)', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform/admins')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ username: 'dataentry', platformRole: 'DATA_ENTRY' });
    expect(res.status).toBe(200);
    const store = readStore(dataDir, 'platformAdmins');
    expect(store.admins.find((a) => a.username === 'dataentry').platformRole).toBe('DATA_ENTRY');
  });

  test('service resolves official roles exactly (platformRoleFor)', () => {
    const platformAdmin = require('../services/platformAdmin.service');
    expect(platformAdmin.platformRoleFor('devuser')).toBe('DEVELOPER');
    expect(platformAdmin.platformRoleFor('dataentry')).toBe('DATA_ENTRY');
    expect(platformAdmin.platformRoleFor('master')).toBe('MASTER_OWNER');
    expect(platformAdmin.platformRoleFor('padmin')).toBe('PLATFORM_ADMIN');
    expect(platformAdmin.platformRoleFor('nobody')).toBeNull();
  });

  test('granted DEVELOPER reaches its official access surface', async () => {
    devToken = (await login(server.app, 'devuser', PASSWORD, 'digi')).accessToken;
    const access = await request(server.app)
      .get('/api/v1/platform/control-center/access')
      .set('Authorization', 'Bearer ' + devToken);
    expect(access.status).toBe(200);
    expect(access.body.data.platformRole).toBe('DEVELOPER');
    expect(access.body.data.permissions).toContain('platform.diagnostics.view');
    expect(access.body.data.fullAccess).toBe(false);
    const dash = await request(server.app)
      .get('/api/v1/platform/control-center/dashboard')
      .set('Authorization', 'Bearer ' + devToken);
    expect(dash.status).toBe(200);
  });

  test('granted DATA_ENTRY reaches its official catalog surface', async () => {
    entryToken = (await login(server.app, 'dataentry', PASSWORD, 'digi')).accessToken;
    const access = await request(server.app)
      .get('/api/v1/platform/control-center/access')
      .set('Authorization', 'Bearer ' + entryToken);
    expect(access.status).toBe(200);
    expect(access.body.data.platformRole).toBe('DATA_ENTRY');
    expect(access.body.data.permissions).toEqual(expect.arrayContaining(['catalog.read', 'catalog.create', 'catalog.update']));
    const created = await request(server.app)
      .post('/api/v1/platform/control-center/catalog')
      .set('Authorization', 'Bearer ' + entryToken)
      .send({ title: 'Official entry', type: 'feature' });
    expect(created.status).toBe(201);
  });
});

// ---------------------------------------------------------------- F4

describe('F4. UNKNOWN_ROLE â€” off-registry roles fail CLOSED everywhere', () => {
  let server;
  let dataDir;
  let masterToken;
  let ghostToken;

  beforeAll(async () => {
    setFlags();
    dataDir = makeTempDataDir('cc-unknown');
    tempDirs.push(dataDir);
    // ghost carries a hand-injected, OFF-REGISTRY store role on purpose.
    seedAll(dataDir, [
      { username: 'ghost', platformRole: 'HACKER', status: 'active', createdAt: stamp, updatedAt: stamp }
    ]);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
    ghostToken = (await login(server.app, 'ghost', PASSWORD, 'digi')).accessToken;
  });

  afterAll(restoreFlags);

  test('service: platformRoleFor is fail-closed for the injected role', () => {
    const platformAdmin = require('../services/platformAdmin.service');
    expect(platformAdmin.platformRoleFor('ghost')).toBeNull();
    expect(platformAdmin.resolvePermissionsFor('ghost')).toEqual([]);
    expect(platformAdmin.isPlatformAdmin('ghost')).toBe(false);
    expect(platformAdmin.platformRoleFor('master')).toBe('MASTER_OWNER');
  });

  test('injected role is denied the legacy broad platform gate (403)', async () => {
    const res = await request(server.app)
      .get('/api/v1/platform/summary')
      .set('Authorization', 'Bearer ' + ghostToken);
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('PLATFORM_ADMIN_REQUIRED');
  });

  test('injected role is denied permission-gated surfaces (403, no invented grant)', async () => {
    const dash = await request(server.app)
      .get('/api/v1/platform/control-center/dashboard')
      .set('Authorization', 'Bearer ' + ghostToken);
    expect(dash.status).toBe(403);
    expect(dash.body.details && dash.body.details.code).toBe('PLATFORM_ACCESS_REQUIRED');
    const me = await request(server.app)
      .get('/api/v1/platform/me')
      .set('Authorization', 'Bearer ' + ghostToken);
    expect(me.status).toBe(404);
  });

  test('granting an off-registry role value is rejected (400, store unchanged)', async () => {
    const before = JSON.stringify(readStore(dataDir, 'platformAdmins'));
    const res = await request(server.app)
      .post('/api/v1/platform/admins')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ username: 'digiManager', platformRole: 'HACKER' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('platformRole must be one of');
    expect(JSON.stringify(readStore(dataDir, 'platformAdmins'))).toBe(before);
  });
});

// ---------------------------------------------------------------- F5

describe('F5. AUDIT_SECURITY â€” no raw authorization/bearer/credential storage', () => {
  let server;
  let dataDir;
  let masterToken;

  const rawMarkers = ['Bearer leakprobe', 'RawAuditLeak1!', 'sk_live_AUDITLEAK', 'tok_AUDITTOKEN', 'cred_AUDITCRED'];

  beforeAll(async () => {
    setFlags();
    dataDir = makeTempDataDir('cc-auditsec');
    tempDirs.push(dataDir);
    seedAll(dataDir);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
  });

  afterAll(restoreFlags);

  test('mutation with authorization material in the body is accepted (200)', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform/users/u-mgr/reset-password')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({
        newPassword: 'Audited#4455',
        password: 'RawAuditLeak1!',
        authorization: 'Bearer leakprobe',
        bearer: 'Bearer leakprobe',
        credential: 'cred_AUDITCRED',
        apiKey: 'sk_live_AUDITLEAK',
        token: 'tok_AUDITTOKEN',
        sessionId: 'sid_AUDITSESSION'
      });
    expect(res.status).toBe(200);
  });

  test('platform audit API never echoes the raw material', async () => {
    const res = await request(server.app)
      .get('/api/v1/platform/audit?limit=200')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    for (const marker of rawMarkers) expect(raw).not.toContain(marker);
    expect(raw).not.toContain(masterToken);
  });

  test('audit store file: sensitive values redacted, session JWT absent, [REDACTED] present', () => {
    const file = path.join(dataDir, 'auditLog.json');
    expect(fs.existsSync(file)).toBe(true);
    const raw = fs.readFileSync(file, 'utf8');
    for (const marker of rawMarkers) expect(raw).not.toContain(marker);
    expect(raw).not.toContain(masterToken);
    expect(raw).not.toContain(PASSWORD);
    expect(raw).toContain('[REDACTED]');
  });

  test('actor in the audit trail stays server-derived', async () => {
    const res = await request(server.app)
      .get('/api/v1/platform/audit?limit=200')
      .set('Authorization', 'Bearer ' + masterToken);
    const entries = (res.body.data && res.body.data.entries) || [];
    const reset = entries.find((e) => e.action === 'PLATFORM_USER_PASSWORD_RESET');
    expect(reset).toBeTruthy();
    expect(reset.userId).toBe('u-master');
  });

  test('diagnostics + dashboard never echo the raw material (activity/stats only)', async () => {
    const diag = await request(server.app)
      .get('/api/v1/platform/control-center/diagnostics')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(diag.status).toBe(200);
    const dash = await request(server.app)
      .get('/api/v1/platform/control-center/dashboard')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(dash.status).toBe(200);
    for (const src of [JSON.stringify(diag.body), JSON.stringify(dash.body)]) {
      for (const marker of rawMarkers) expect(src).not.toContain(marker);
      expect(src).not.toContain(masterToken);
      expect(src).not.toContain(PASSWORD);
    }
  });
});

// ---------------------------------------------------------------- F6

describe('F6. CATALOG_VALIDATION â€” add-ons require an existing tenant', () => {
  let server;
  let dataDir;
  let masterToken;

  beforeAll(async () => {
    setFlags();
    dataDir = makeTempDataDir('cc-addon');
    tempDirs.push(dataDir);
    seedAll(dataDir);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
  });

  afterAll(restoreFlags);

  test('unknown tenant add-on is rejected with 400 and never persisted', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform/admin/tenants/unknown-co/addons')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ addon_key: 'x', status: 'active' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid tenant or addon key');
    const store = readStore(dataDir, 'tenantAddons');
    const records = (store && store.tenantAddons) || [];
    expect(records.some((a) => a.tenantId === 'unknown-co')).toBe(false);
  });

  test('existing tenant add-on still saves (no over-block)', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform/admin/tenants/digi/addons')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ addon_key: 'starter', status: 'active' });
    expect(res.status).toBe(200);
    const store = readStore(dataDir, 'tenantAddons');
    expect(store.tenantAddons.some((a) => a.tenantId === 'digi' && a.addonKey === 'starter')).toBe(true);
  });

  test('unknown tenant add-on deletion is a real 404 (nothing created earlier)', async () => {
    const res = await request(server.app)
      .delete('/api/v1/platform/admin/tenants/unknown-co/addons/x')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(res.status).toBe(404);
  });
});

registerCleanup(() => [], () => tempDirs);
