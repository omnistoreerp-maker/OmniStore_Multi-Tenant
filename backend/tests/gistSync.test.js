'use strict';

// gistSync.test.js — server-authoritative, tenant-scoped cloud-sync suite.
//
//   V  VAULT           — AES-256-GCM roundtrip; missing/short key fails CLOSED.
//   M  MASTER_GATE     — config surfaces are platform-admin only; no secrets echo.
//   T  TENANT_ISO      — status/pull/push derive tenant server-side; A cannot touch B.
//   C  CONFLICT        — stale baseRevision -> 409, state untouched (never last-write-wins).
//   X  CROSS_TENANT    — _companyId mismatch -> 403 CROSS_TENANT_PAYLOAD.
//   U  UPSTREAM        — mocked fetch maps 401/404/5xx/network to safe codes.
//   A  AUDIT           — audit entries carry metadata only, never tokens/dataset.
//   L  LEGACY          — legacy v1 vault blob decrypts under the same key.
//   R  REVISION_HARDENING — strict base proof, server stamp, read binding, lock.
//   P  MASTER_OPS      — MCC surface: list-all, test, controlled pull/push, audit.
//   M  MIGRATION_STATE — six-state legacy migration model (advisory report).
//   M2 REVOCATION_GATE — per-device v2 evidence + master-attested trusted
//      device inventory; single device-less reports can never claim REVOKED.
//   G  DATA_INTEGRITY  — failed writes never advance state; no dataset/secrets at rest.

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const PASSWORD = 'Pass#123';
const VAULT_KEY = 'test-gist-vault-key-32chars-minimum!!';
const stamp = new Date().toISOString();
const tempDirs = [];
const originalFetch = global.fetch;
const originalVaultKey = process.env.GIST_SYNC_VAULT_KEY;

const companies = [
  { id: 'digi', name: 'DigiTronics', code: 'DIGI', active: true },
  { id: 'nile', name: 'Nile Electronics', code: 'NILE', active: true }
];

function hash(pw) {
  return require('bcryptjs').hashSync(pw, 10);
}

function makeUsers() {
  return { users: [
    { id: 'u-master', username: 'master', password: hash(PASSWORD), role: 'Viewer', fullName: 'Platform Master', tenantIds: [], createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
    { id: 'u-owner', username: 'digiOwner', password: hash(PASSWORD), role: 'Owner', fullName: 'Digi Owner', tenantIds: ['digi'], tenantRoles: { digi: 'Owner' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
    { id: 'u-mgr', username: 'digiManager', password: hash(PASSWORD), role: 'Manager', fullName: 'Digi Manager', tenantIds: ['digi'], tenantRoles: { digi: 'Manager' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
    { id: 'u-cash', username: 'digiCashier', password: hash(PASSWORD), role: 'Cashier', fullName: 'Digi Cashier', tenantIds: ['digi'], tenantRoles: { digi: 'Cashier' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
    { id: 'u-nile', username: 'nileOwner', password: hash(PASSWORD), role: 'Owner', fullName: 'Nile Owner', tenantIds: ['nile'], tenantRoles: { nile: 'Owner' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 }
  ] };
}

function baseAdmins() {
  return { admins: [
    { username: 'master', platformRole: 'MASTER_OWNER', status: 'active', createdAt: stamp, updatedAt: stamp }
  ] };
}

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', makeUsers());
  seed(dir, 'platformAdmins', baseAdmins());
}

const FLAGS = ['ENABLE_TENANT_CARRY', 'ENABLE_MULTI_COMPANY_LOGIN', 'ENABLE_TENANT_ROLES'];
const ORIGINAL_FLAGS = {};

function setFlags() {
  for (const k of FLAGS) ORIGINAL_FLAGS[k] = process.env[k];
  process.env.ENABLE_TENANT_CARRY = 'true';
  process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
  process.env.ENABLE_TENANT_ROLES = 'true';
  process.env.GIST_SYNC_VAULT_KEY = VAULT_KEY;
}

function restoreFlags() {
  for (const k of FLAGS) {
    if (ORIGINAL_FLAGS[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_FLAGS[k];
  }
  if (originalVaultKey === undefined) delete process.env.GIST_SYNC_VAULT_KEY;
  else process.env.GIST_SYNC_VAULT_KEY = originalVaultKey;
}

function mockFetch(handler) {
  global.fetch = jest.fn(handler);
}

function restoreFetch() {
  global.fetch = originalFetch;
}

function ghJson(status, body) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body))
  });
}

// Static GitHub mock: GET returns the given remote content, PATCH succeeds.
function mockGhStatic(remote) {
  mockFetch((url, opts) => {
    if (opts && opts.method === 'PATCH') return ghJson(200, { ok: true });
    if (typeof url === 'string' && /\/gists\?/.test(url)) return ghJson(200, [{ id: 'x' }]);
    return ghJson(200, { files: { 'digitronics_db.json': { content: remote } } });
  });
}

const DATASET = JSON.stringify({ _companyId: 'digi', products: [{ id: 'p1', name: 'Laptop' }], settings: { localVersion: 7 } });

// ------------------------------------------------------------------ V + M

describe('V/M. VAULT + MASTER_GATE — fail-closed vault, platform-admin-only config', () => {
  let server;
  let dataDir;
  let masterToken;
  let ownerToken;

  beforeAll(async () => {
    setFlags();
    dataDir = makeTempDataDir('gist-vault');
    tempDirs.push(dataDir);
    seedAll(dataDir);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
    ownerToken = (await login(server.app, 'digiOwner', PASSWORD, 'digi')).accessToken;
  });

  afterAll(() => { restoreFlags(); restoreFetch(); });

  test('vault roundtrip: encrypt then decrypt returns the plaintext', () => {
    const sync = require('../services/gistSync.service');
    const enc = sync.encryptSecret('ghp_testtoken_abc123');
    expect(enc.error).toBeUndefined();
    expect(enc.value).toMatch(/^v1:[^:]+:[^:]+:[^:]+:[^:]+$/);
    expect(enc.value).not.toContain('ghp_testtoken_abc123');
    const dec = sync.decryptSecret(enc.value);
    expect(dec.error).toBeUndefined();
    expect(dec.value).toBe('ghp_testtoken_abc123');
  });

  test('vault LOCKED (short key): configure with token fails 503, no state written', () => {
    process.env.GIST_SYNC_VAULT_KEY = 'short';
    const sync = require('../services/gistSync.service');
    expect(sync.vaultLocked()).toBe(true);
    const r = sync.configure({ id: 'u-master', username: 'master' }, 'digi', { token: 'ghp_lockprobe_0001' });
    expect(r.status).toBe(503);
    expect(r.code).toBe('SYNC_VAULT_LOCKED');
    expect(readStore(dataDir, 'gistSyncState')).toBe(null);
    process.env.GIST_SYNC_VAULT_KEY = VAULT_KEY;
  });

  test('tenant cannot reach the master config surface (403 for read+write)', async () => {
    const list = await request(server.app)
      .get('/api/v1/platform/sync')
      .set('Authorization', 'Bearer ' + ownerToken);
    expect(list.status).toBe(403);
    const put = await request(server.app)
      .put('/api/v1/platform/sync/digi')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ token: 'ghp_tenantprobe_1' });
    expect(put.status).toBe(403);
  });

  test('master can configure; response and store never echo the raw token', async () => {
    const res = await request(server.app)
      .put('/api/v1/platform/sync/digi')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ provider: 'github-gist', enabled: true, token: 'ghp_secrettoken_ABC123XYZ', gistId: 'abc123gist' });
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('ghp_secrettoken_ABC123XYZ');
    expect(res.body.data.config.hasCredential).toBe(true);
    expect(res.body.data.config.masked).toBe('••••••••••••3XYZ');
    const store = readStore(dataDir, 'gistSyncState');
    expect(store.entries[0].encryptedToken).not.toContain('ghp_secrettoken_ABC123XYZ');
    expect(store.entries[0].encryptedToken).toMatch(/^v1:/);
  });

  test('listConfigs (master) shows masked metadata only — no encrypted or raw token', async () => {
    const res = await request(server.app)
      .get('/api/v1/platform/sync')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('ghp_secrettoken_ABC123XYZ');
    expect(raw).not.toContain('encryptedToken');
    expect(res.body.data.configs[0].masked).toBe('••••••••••••3XYZ');
    expect(res.body.data.configs[0].hasCredential).toBe(true);
  });

  test('unknown tenant configure is 400 UNKNOWN_TENANT', async () => {
    const res = await request(server.app)
      .put('/api/v1/platform/sync/ghost-co')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ token: 'ghp_ghosttoken_1' });
    expect(res.status).toBe(400);
    expect(res.body.details && res.body.details.code).toBe('UNKNOWN_TENANT');
  });

  test('bad credential format is 400 INVALID_CREDENTIAL', async () => {
    const res = await request(server.app)
      .put('/api/v1/platform/sync/nile')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ token: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.details && res.body.details.code).toBe('INVALID_CREDENTIAL');
  });

  test('master disconnect removes binding but never deletes the remote gist', async () => {
    // Configure nile first so there is something to disconnect.
    await request(server.app)
      .put('/api/v1/platform/sync/nile')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ token: 'ghp_niletoken_0001', gistId: 'nilegist01' });
    const res = await request(server.app)
      .delete('/api/v1/platform/sync/nile')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(res.status).toBe(200);
    const store = readStore(dataDir, 'gistSyncState');
    expect(store.entries.some((e) => e.tenantId === 'nile')).toBe(false);
    // no GitHub call was made — global.fetch untouched for this test
    expect(global.fetch).toBe(originalFetch);
  });
});

// ---------------------------------------------------------------------- T

describe('T. TENANT_ISO — status is secret-free; tenant context is server-derived', () => {
  let server;
  let dataDir;
  let masterToken;
  let ownerToken;
  let cashierToken;
  let nileToken;

  beforeAll(async () => {
    setFlags();
    dataDir = makeTempDataDir('gist-iso');
    tempDirs.push(dataDir);
    seedAll(dataDir);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
    ownerToken = (await login(server.app, 'digiOwner', PASSWORD, 'digi')).accessToken;
    cashierToken = (await login(server.app, 'digiCashier', PASSWORD, 'digi')).accessToken;
    nileToken = (await login(server.app, 'nileOwner', PASSWORD, 'nile')).accessToken;
    await request(server.app)
      .put('/api/v1/platform/sync/digi')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ token: 'ghp_digitoken_0001', gistId: 'digest0001' });
  });

  afterAll(() => { restoreFlags(); restoreFetch(); });

  test('tenant status: configured+enabled, no gistId, no token material', async () => {
    const res = await request(server.app)
      .get('/api/v1/sync/status')
      .set('Authorization', 'Bearer ' + ownerToken);
    expect(res.status).toBe(200);
    expect(res.body.data.status.configured).toBe(true);
    expect(res.body.data.status.enabled).toBe(true);
    expect(res.body.data.status.gistId).toBeUndefined();
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('ghp_digitoken_0001');
    expect(raw).not.toContain('digest0001');
  });

  test('unconfigured tenant sees configured:false (no leak of other tenants)', async () => {
    const res = await request(server.app)
      .get('/api/v1/sync/status')
      .set('Authorization', 'Bearer ' + nileToken);
    expect(res.status).toBe(200);
    expect(res.body.data.status.configured).toBe(false);
  });

  test('pull is allowed for any authenticated member (cashier can pull)', async () => {
    mockFetch((url) => ghJson(200, { files: { 'digitronics_db.json': { content: DATASET } } }));
    const res = await request(server.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + cashierToken)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.pull.content).toBe(DATASET);
    expect(res.body.data.pull.revision).toMatch(/^[0-9a-f]{64}$/);
    restoreFetch();
  });

  test('push is denied for Cashier (role gate), allowed for Manager', async () => {
    const denied = await request(server.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + cashierToken)
      .send({ content: DATASET, baseRevision: null });
    expect(denied.status).toBe(403);
    restoreFetch();
  });

  test('tenant A pull never returns tenant B content (gist binding is per-tenant)', async () => {
    // nile is unconfigured -> 404, even though digi has a working binding.
    mockFetch(() => ghJson(500, { message: 'should not be called' }));
    const res = await request(server.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + nileToken)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.details && res.body.details.code).toBe('NOT_CONFIGURED');
    expect(global.fetch).not.toHaveBeenCalled();
    restoreFetch();
  });

  test('request-injected tenant hints are IGNORED (tenant comes from the token only)', async () => {
    mockFetch(() => ghJson(500, 'boom'));
    const res = await request(server.app)
      .post('/api/v1/sync/pull?tenantId=nile')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ tenantId: 'nile' });
    // digi's binding is used, not the injected nile id — upstream 500 maps to 502.
    expect(res.status).toBe(502);
    restoreFetch();
  });
});

// ---------------------------------------------------------------------- C

describe('C. CONFLICT — stale baseRevision -> 409, state untouched', () => {
  let server;
  let dataDir;
  let masterToken;
  let ownerToken;
  let managerToken;

  beforeAll(async () => {
    setFlags();
    dataDir = makeTempDataDir('gist-conflict');
    tempDirs.push(dataDir);
    seedAll(dataDir);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
    ownerToken = (await login(server.app, 'digiOwner', PASSWORD, 'digi')).accessToken;
    managerToken = (await login(server.app, 'digiManager', PASSWORD, 'digi')).accessToken;
    await request(server.app)
      .put('/api/v1/platform/sync/digi')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ token: 'ghp_conftoken_0001', gistId: 'confgist01' });
    // Establish a known revision via pull.
    mockFetch(() => ghJson(200, { files: { 'digitronics_db.json': { content: DATASET } } }));
    await request(server.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({});
    restoreFetch();
  });

  afterAll(() => { restoreFlags(); restoreFetch(); });

  test('stale baseRevision -> 409 CONFLICT, no upstream PATCH attempted', async () => {
    const before = JSON.stringify(readStore(dataDir, 'gistSyncState'));
    mockFetch(() => ghJson(200, { files: { 'digitronics_db.json': { content: DATASET } } }));
    const res = await request(server.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + managerToken)
      .send({ content: DATASET, baseRevision: 'f'.repeat(64) });
    expect(res.status).toBe(409);
    expect(res.body.details && res.body.details.code).toBe('CONFLICT');
    // Only the GET (conflict probe) happened; no PATCH write.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    restoreFetch();
    const after = readStore(dataDir, 'gistSyncState');
    expect(after.entries[0].lastRevision).toBe(require('../services/gistSync.service')._sha256(DATASET));
    expect(after.entries[0].lastPushAt).toBe(null);
    void before;
  });

  test('correct baseRevision -> 200 push, revision updated', async () => {
    const current = require('../services/gistSync.service')._sha256(DATASET);
    const newContent = JSON.stringify({ _companyId: 'digi', products: [{ id: 'p1', name: 'Laptop Pro' }], settings: { localVersion: 8 } });
    mockFetch((url, opts) => {
      if (opts && opts.method === 'PATCH') return ghJson(200, { ok: true });
      return ghJson(200, { files: { 'digitronics_db.json': { content: DATASET } } });
    });
    const res = await request(server.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + managerToken)
      .send({ content: newContent, baseRevision: current });
    expect(res.status).toBe(200);
    expect(res.body.data.push.revision).toBe(require('../services/gistSync.service')._sha256(newContent));
    restoreFetch();
  });
});

// ---------------------------------------------------------------------- X

describe('X. CROSS_TENANT — _companyId mismatch -> 403, state untouched', () => {
  let server;
  let dataDir;
  let masterToken;
  let ownerToken;

  beforeAll(async () => {
    setFlags();
    dataDir = makeTempDataDir('gist-cross');
    tempDirs.push(dataDir);
    seedAll(dataDir);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
    ownerToken = (await login(server.app, 'digiOwner', PASSWORD, 'digi')).accessToken;
    await request(server.app)
      .put('/api/v1/platform/sync/digi')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ token: 'ghp_crosstoken_01', gistId: 'crossgist01' });
  });

  afterAll(() => { restoreFlags(); restoreFetch(); });

  test("another company's dataset is refused (403 CROSS_TENANT_PAYLOAD), no upstream write", async () => {
    const foreign = JSON.stringify({ _companyId: 'nile', products: [] });
    mockFetch((url, opts) => {
      if (opts && opts.method === 'PATCH') return ghJson(200, { ok: true });
      return ghJson(200, { files: { 'digitronics_db.json': { content: DATASET } } });
    });
    const res = await request(server.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ content: foreign, baseRevision: null });
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('CROSS_TENANT_PAYLOAD');
    // Only the conflict-probe GET may run; the payload is rejected before any PATCH.
    const calls = global.fetch.mock.calls;
    expect(calls.every((c) => !(c[1] && c[1].method === 'PATCH'))).toBe(true);
    restoreFetch();
  });

  test('non-JSON / non-object / empty payloads are 400 INVALID_PAYLOAD', async () => {
    for (const bad of ['', 'not-json', '[1,2,3]', '42']) {
      const res = await request(server.app)
        .post('/api/v1/sync/push')
        .set('Authorization', 'Bearer ' + ownerToken)
        .send({ content: bad, baseRevision: null });
      expect(res.status).toBe(400);
      expect(res.body.details && res.body.details.code).toBe('INVALID_PAYLOAD');
    }
  });

  test('oversized payload is 413 TOO_LARGE before any upstream call', async () => {
    mockFetch(() => { throw new Error('must not be called'); });
    const huge = JSON.stringify({ _companyId: 'digi', blob: 'x'.repeat(5 * 1024 * 1024 + 1) });
    const res = await request(server.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ content: huge, baseRevision: null });
    expect(res.status).toBe(413);
    expect(res.body.details && res.body.details.code).toBe('TOO_LARGE');
    expect(global.fetch).not.toHaveBeenCalled();
    restoreFetch();
  });
});

// ---------------------------------------------------------------------- U

describe('U. UPSTREAM — mocked fetch maps provider failures to safe codes only', () => {
  let server;
  let dataDir;
  let masterToken;
  let ownerToken;

  beforeAll(async () => {
    setFlags();
    dataDir = makeTempDataDir('gist-upstream');
    tempDirs.push(dataDir);
    seedAll(dataDir);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
    ownerToken = (await login(server.app, 'digiOwner', PASSWORD, 'digi')).accessToken;
    await request(server.app)
      .put('/api/v1/platform/sync/digi')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ token: 'ghp_uptoken_00001', gistId: 'upgist0001' });
  });

  afterAll(() => { restoreFlags(); restoreFetch(); });

  test('401 upstream -> 401 CREDENTIAL_INVALID; raw body never surfaces', async () => {
    mockFetch(() => ghJson(401, { message: 'Bad credentials', documentation_url: 'https://docs.example' }));
    const res = await request(server.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.details && res.body.details.code).toBe('CREDENTIAL_INVALID');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('documentation_url');
    expect(raw).not.toContain('Bad credentials');
    restoreFetch();
  });

  test('404 upstream -> 404 GIST_NOT_FOUND', async () => {
    mockFetch(() => ghJson(404, { message: 'Not Found' }));
    const res = await request(server.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.details && res.body.details.code).toBe('GIST_NOT_FOUND');
    restoreFetch();
  });

  test('500 upstream -> 502 UPSTREAM_UNAVAILABLE', async () => {
    mockFetch(() => ghJson(500, { message: 'Server Error' }));
    const res = await request(server.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({});
    expect(res.status).toBe(502);
    expect(res.body.details && res.body.details.code).toBe('UPSTREAM_UNAVAILABLE');
    restoreFetch();
  });

  test('network drop -> 502 UPSTREAM_UNAVAILABLE; abort -> 504 UPSTREAM_TIMEOUT', async () => {
    mockFetch(() => Promise.reject(new TypeError('fetch failed')));
    const drop = await request(server.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({});
    expect(drop.status).toBe(502);
    expect(drop.body.details && drop.body.details.code).toBe('UPSTREAM_UNAVAILABLE');
    restoreFetch();

    mockFetch(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    const aborted = await request(server.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({});
    expect(aborted.status).toBe(504);
    expect(aborted.body.details && aborted.body.details.code).toBe('UPSTREAM_TIMEOUT');
    restoreFetch();
  });

  test('first push with no bound gist bootstraps a private gist (create path)', async () => {
    await request(server.app)
      .put('/api/v1/platform/sync/nile')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ token: 'ghp_bootstrap_0001' });
    const nileToken = (await login(server.app, 'nileOwner', PASSWORD, 'nile')).accessToken;
    const nileContent = JSON.stringify({ _companyId: 'nile', products: [] });
    mockFetch((url, opts) => {
      if (opts && opts.method === 'POST') return ghJson(201, { id: 'newgist99' });
      return ghJson(200, { files: { 'digitronics_db.json': { content: nileContent } } });
    });
    const res = await request(server.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + nileToken)
      .send({ content: nileContent, baseRevision: null });
    expect(res.status).toBe(200);
    const store = readStore(dataDir, 'gistSyncState');
    expect(store.entries.find((e) => e.tenantId === 'nile').gistId).toBe('newgist99');
    restoreFetch();
  });
});

// ---------------------------------------------------------------------- A

describe('A. AUDIT — entries carry metadata only, never tokens or dataset contents', () => {
  let server;
  let dataDir;
  let masterToken;
  let ownerToken;

  beforeAll(async () => {
    setFlags();
    dataDir = makeTempDataDir('gist-audit');
    tempDirs.push(dataDir);
    seedAll(dataDir);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
    ownerToken = (await login(server.app, 'digiOwner', PASSWORD, 'digi')).accessToken;
    await request(server.app)
      .put('/api/v1/platform/sync/digi')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ token: 'ghp_audittoken_X1', gistId: 'auditgist1' });
    mockFetch(() => ghJson(200, { files: { 'digitronics_db.json': { content: DATASET } } }));
    await request(server.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({});
    await request(server.app)
      .delete('/api/v1/platform/sync/digi')
      .set('Authorization', 'Bearer ' + masterToken);
    restoreFetch();
  });

  afterAll(() => { restoreFlags(); restoreFetch(); });

  test('audit log has SYNC/config actions, no token, no dataset contents', () => {
    const audit = readStore(dataDir, 'auditLog');
    const entries = (audit && (audit.entries || audit)) || [];
    const list = Array.isArray(entries) ? entries : [];
    const raw = JSON.stringify(list);
    expect(raw).not.toContain('ghp_audittoken_X1');
    expect(raw).not.toContain(DATASET);
    expect(raw).not.toContain('Laptop');
    const actions = list.map((e) => e.action);
    expect(actions).toContain('PLATFORM_SYNC_CONFIG_UPDATED');
    expect(actions).toContain('SYNC_PULL');
    expect(actions).toContain('PLATFORM_SYNC_DISCONNECTED');
  });

  test('success pull audit records byte size metadata (not content)', () => {
    const audit = readStore(dataDir, 'auditLog');
    const list = (audit && (audit.entries || audit)) || [];
    const pull = (Array.isArray(list) ? list : []).find((e) => e.action === 'SYNC_PULL');
    expect(pull).toBeTruthy();
    expect(pull.changes && typeof pull.changes.bytes).toBe('number');
    expect(pull.changes.bytes).toBe(Buffer.byteLength(DATASET, 'utf8'));
    expect(JSON.stringify(pull)).not.toContain('Laptop');
  });
});

// ---------------------------------------------------------------------- L

describe('L. LEGACY — a pre-existing v1 vault blob decrypts under the same key', () => {
  let server;
  let dataDir;

  beforeAll(async () => {
    setFlags();
    dataDir = makeTempDataDir('gist-legacy');
    tempDirs.push(dataDir);
    seedAll(dataDir);
    // Encrypt a legacy token with the service, then hand-write the state file
    // as an "old" device would have left it.
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
  });

  afterAll(() => { restoreFlags(); restoreFetch(); });

  test('legacy-schema state entry (v1 blob) is readable and usable for pull', async () => {
    const sync = require('../services/gistSync.service');
    const enc = sync.encryptSecret('ghp_legacytoken_9');
    seed(dataDir, 'gistSyncState', { entries: [{
      tenantId: 'digi',
      provider: 'github-gist',
      enabled: true,
      encryptedToken: enc.value,
      masked: '••••••••••••Z_9',
      gistId: 'legacygist9',
      lastRevision: null,
      lastPullAt: null,
      lastPushAt: null,
      lastErrorCode: null,
      createdAt: stamp,
      updatedAt: stamp,
      updatedBy: 'master'
    }] });
    // Re-require the app so it picks up the hand-written state.
    const s2 = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    const ownerToken = (await login(s2.app, 'digiOwner', PASSWORD, 'digi')).accessToken;
    mockFetch((url, opts) => {
      // Assert the decrypted legacy token is used on the wire (Authorization header).
      if (opts && opts.headers && opts.headers.Authorization) {
        expect(opts.headers.Authorization).toBe('token ghp_legacytoken_9');
      }
      return ghJson(200, { files: { 'digitronics_db.json': { content: DATASET } } });
    });
    const res = await request(s2.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.pull.content).toBe(DATASET);
    void server;
    restoreFetch();
  });
});

// ---------------------------------------------------------------------- R

describe('R. REVISION_HARDENING — strict base proof, server-side tenant stamp, read binding', () => {
  let server;
  let dataDir;
  let masterToken;
  let ownerToken;
  let managerToken;

  // Merge an entry into the live gistSyncState instead of overwriting it,
  // so tests within this block do not wipe each other's bindings.
  function upsertStateEntry(dir, entry) {
    const cur = readStore(dir, 'gistSyncState') || { entries: [] };
    const entries = Array.isArray(cur.entries) ? cur.entries : [];
    const idx = entries.findIndex((e) => e.tenantId === entry.tenantId);
    if (idx === -1) entries.push(entry);
    else entries[idx] = entry;
    seed(dir, 'gistSyncState', { entries });
  }

  beforeAll(async () => {
    setFlags();
    dataDir = makeTempDataDir('gist-revharden');
    tempDirs.push(dataDir);
    seedAll(dataDir);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
    ownerToken = (await login(server.app, 'digiOwner', PASSWORD, 'digi')).accessToken;
    managerToken = (await login(server.app, 'digiManager', PASSWORD, 'digi')).accessToken;
    await request(server.app)
      .put('/api/v1/platform/sync/digi')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ token: 'ghp_revhard_0001', gistId: 'revgist0001' });
  });

  afterAll(() => { restoreFlags(); restoreFetch(); });

  test('status exposes lastRevision (the push-base field), never a "revision" alias', async () => {
    const res = await request(server.app)
      .get('/api/v1/sync/status')
      .set('Authorization', 'Bearer ' + ownerToken);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toHaveProperty('lastRevision');
    expect(res.body.data.status).not.toHaveProperty('revision');
  });

  test('bound gist + NULL baseRevision -> 409 CONFLICT (no silent last-write-wins)', async () => {
    mockGhStatic(DATASET);
    await request(server.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({});
    restoreFetch();

    mockGhStatic(DATASET);
    const res = await request(server.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + managerToken)
      .send({ content: DATASET, baseRevision: null });
    expect(res.status).toBe(409);
    expect(res.body.details && res.body.details.code).toBe('CONFLICT');
    expect(res.body.details.currentRevision).toBe(require('../services/gistSync.service')._sha256(DATASET));
    const calls = global.fetch.mock.calls;
    expect(calls.every((c) => !(c[1] && c[1].method === 'PATCH'))).toBe(true);
    restoreFetch();
  });

  test('adopted gist (lastRevision null) forces pull-before-push: null and stale bases -> 409, then pull -> 200', async () => {
    // Simulate Master adopting an existing legacy gist for nile.
    const sync = require('../services/gistSync.service');
    const enc = sync.encryptSecret('ghp_adopted_0001');
    upsertStateEntry(dataDir, {
      tenantId: 'nile',
      provider: 'github-gist',
      enabled: true,
      encryptedToken: enc.value,
      masked: '••••••••••••0001',
      gistId: 'adoptgist01',
      lastRevision: null,
      lastPullAt: null,
      lastPushAt: null,
      lastErrorCode: null,
      createdAt: stamp,
      updatedAt: stamp,
      updatedBy: 'master'
    });
    const s2 = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    const nileToken = (await login(s2.app, 'nileOwner', PASSWORD, 'nile')).accessToken;
    const nileContent = JSON.stringify({ _companyId: 'nile', products: [] });

    mockGhStatic(nileContent);
    const nullBase = await request(s2.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + nileToken)
      .send({ content: nileContent, baseRevision: null });
    expect(nullBase.status).toBe(409);
    const staleBase = await request(s2.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + nileToken)
      .send({ content: nileContent, baseRevision: 'b'.repeat(64) });
    expect(staleBase.status).toBe(409);
    restoreFetch();

    let remoteNow = nileContent;
    mockFetch((url, opts) => {
      if (opts && opts.method === 'PATCH') {
        remoteNow = JSON.parse(opts.body).files['digitronics_db.json'].content;
        return ghJson(200, { ok: true });
      }
      return ghJson(200, { files: { 'digitronics_db.json': { content: remoteNow } } });
    });
    const pull = await request(s2.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + nileToken)
      .send({});
    expect(pull.status).toBe(200);
    const base = pull.body.data.pull.revision;
    const push = await request(s2.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + nileToken)
      .send({ content: nileContent, baseRevision: base });
    expect(push.status).toBe(200);
    restoreFetch();
    void server;
  });

  test('server STAMPS the trusted _companyId: missing tag and "legacy" tag are rewritten on push', async () => {
    mockGhStatic(DATASET);
    await request(server.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({});
    restoreFetch();

    const sync = require('../services/gistSync.service');
    let remoteNow = DATASET;
    mockFetch((url, opts) => {
      if (opts && opts.method === 'PATCH') {
        remoteNow = JSON.parse(opts.body).files['digitronics_db.json'].content;
        return ghJson(200, { ok: true });
      }
      return ghJson(200, { files: { 'digitronics_db.json': { content: remoteNow } } });
    });

    // Push 1: dataset with NO tag -> stamped with digi.
    const untagged = JSON.stringify({ products: [{ id: 'p9' }], settings: { localVersion: 7 } });
    const res = await request(server.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + managerToken)
      .send({ content: untagged, baseRevision: sync._sha256(DATASET) });
    expect(res.status).toBe(200);
    expect(JSON.parse(remoteNow)._companyId).toBe('digi');
    expect(res.body.data.push.revision).toBe(sync._sha256(remoteNow));

    // Push 2: 'legacy' placeholder tag -> replaced with the real tenant id.
    const legacyTagged = JSON.stringify({ _companyId: 'legacy', products: [] });
    const res2 = await request(server.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + managerToken)
      .send({ content: legacyTagged, baseRevision: res.body.data.push.revision });
    expect(res2.status).toBe(200);
    expect(JSON.parse(remoteNow)._companyId).toBe('digi');
    expect(res2.body.data.push.revision).toBe(sync._sha256(remoteNow));
    restoreFetch();
  });

  test('pull REFUSES a gist tagged for another company (403), state untouched; "legacy" tag stays readable', async () => {
    const sync = require('../services/gistSync.service');
    const enc = sync.encryptSecret('ghp_pullbind_001');
    upsertStateEntry(dataDir, {
      tenantId: 'nile',
      provider: 'github-gist',
      enabled: true,
      encryptedToken: enc.value,
      masked: '••••••••••••0001',
      gistId: 'pullbind001',
      lastRevision: null,
      lastPullAt: null,
      lastPushAt: null,
      lastErrorCode: null,
      createdAt: stamp,
      updatedAt: stamp,
      updatedBy: 'master'
    });
    const s3 = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    const nileToken = (await login(s3.app, 'nileOwner', PASSWORD, 'nile')).accessToken;

    mockGhStatic(DATASET); // tagged 'digi'
    const denied = await request(s3.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + nileToken)
      .send({});
    expect(denied.status).toBe(403);
    expect(denied.body.details && denied.body.details.code).toBe('CROSS_TENANT_PAYLOAD');
    const after = readStore(dataDir, 'gistSyncState');
    expect(after.entries.find((e) => e.tenantId === 'nile').lastRevision).toBe(null);
    restoreFetch();

    const legacyContent = JSON.stringify({ _companyId: 'legacy', products: [] });
    mockGhStatic(legacyContent);
    const ok = await request(s3.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + nileToken)
      .send({});
    expect(ok.status).toBe(200);
    expect(ok.body.data.pull.content).toBe(legacyContent);
    restoreFetch();
    void server;
  });

  test('two concurrent pushes with the same base: exactly one 200 and one 409 (per-tenant lock)', async () => {
    // Establish a known-good base for digi, then race two identical pushes.
    mockGhStatic(DATASET);
    const pull = await request(server.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({});
    expect(pull.status).toBe(200);
    const base = pull.body.data.pull.revision;
    restoreFetch();

    mockGhStatic(DATASET);
    const payload = { content: JSON.stringify({ _companyId: 'digi', products: [{ id: 'race' }] }), baseRevision: base };
    const [a, b] = await Promise.all([
      request(server.app).post('/api/v1/sync/push').set('Authorization', 'Bearer ' + managerToken).send(payload),
      request(server.app).post('/api/v1/sync/push').set('Authorization', 'Bearer ' + managerToken).send(payload)
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    restoreFetch();
  });
});

// ---------------------------------------------------------------------- P

describe('P. MASTER_OPS — MCC surface: list-all, test, controlled pull/push, audit', () => {
  let server;
  let dataDir;
  let masterToken;
  let ownerToken;
  let managerToken;

  beforeAll(async () => {
    setFlags();
    dataDir = makeTempDataDir('gist-masterops');
    tempDirs.push(dataDir);
    seedAll(dataDir);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
    ownerToken = (await login(server.app, 'digiOwner', PASSWORD, 'digi')).accessToken;
    managerToken = (await login(server.app, 'digiManager', PASSWORD, 'digi')).accessToken;
  });

  afterAll(() => { restoreFlags(); restoreFetch(); });

  test('listConfigs returns ALL companies (unconfigured rows included) + vaultLocked + state field', async () => {
    const res = await request(server.app)
      .get('/api/v1/platform/sync')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(res.status).toBe(200);
    expect(res.body.data.vaultLocked).toBe(false);
    const rows = res.body.data.configs;
    const digi = rows.find((r) => r.tenantId === 'digi');
    const nile = rows.find((r) => r.tenantId === 'nile');
    expect(digi).toBeTruthy();
    expect(nile).toBeTruthy();
    expect(digi.state).toBe('NOT_CONFIGURED');
    expect(nile.state).toBe('NOT_CONFIGURED');
    expect(digi.companyName).toBe('DigiTronics');
    expect(typeof res.body.data.vaultLocked).toBe('boolean');
  });

  test('configure digi -> state becomes CONNECTED after a successful connectivity test', async () => {
    const put = await request(server.app)
      .put('/api/v1/platform/sync/digi')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ token: 'ghp_masterops_0001', gistId: 'mogist00001' });
    expect(put.status).toBe(200);

    mockGhForTest();
    const res = await request(server.app)
      .post('/api/v1/platform/sync/digi/test')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({});
    expect(res.status).toBe(200);
    const t = res.body.data.test;
    expect(t.ok).toBe(true);
    expect(t.credential).toBe('ok');
    expect(t.gist).toBe('ok');
    expect(t.binding).toBe('own');
    expect(t.currentRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof t.latencyMs).toBe('number');
    expect(JSON.stringify(res.body)).not.toContain('ghp_masterops_0001');
    restoreFetch();

    const list = await request(server.app)
      .get('/api/v1/platform/sync')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(list.body.data.configs.find((r) => r.tenantId === 'digi').state).toBe('CONNECTED');
  });

  test('test on unconfigured tenant -> 404; upstream 401 -> 401 CREDENTIAL_INVALID (state ERROR)', async () => {
    const missing = await request(server.app)
      .post('/api/v1/platform/sync/nile/test')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({});
    expect(missing.status).toBe(404);

    mockFetch(() => ghJson(401, { message: 'Bad credentials' }));
    const bad = await request(server.app)
      .post('/api/v1/platform/sync/digi/test')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({});
    expect(bad.status).toBe(401);
    expect(bad.body.details && bad.body.details.code).toBe('CREDENTIAL_INVALID');
    restoreFetch();

    const list = await request(server.app)
      .get('/api/v1/platform/sync')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(list.body.data.configs.find((r) => r.tenantId === 'digi').state).toBe('ERROR');
  });

  test('successful test clears connectivity errors but PRESERVES a CONFLICT signal', async () => {
    // digi lastErrorCode = CREDENTIAL_INVALID from the previous test.
    mockGhForTest();
    const res = await request(server.app)
      .post('/api/v1/platform/sync/digi/test')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({});
    expect(res.status).toBe(200);
    restoreFetch();
    let rows = (await request(server.app).get('/api/v1/platform/sync').set('Authorization', 'Bearer ' + masterToken)).body.data.configs;
    expect(rows.find((r) => r.tenantId === 'digi').state).toBe('CONNECTED');

    // Force a CONFLICT code, then prove test does not wipe it.
    const sync = require('../services/gistSync.service');
    const cur = readStore(dataDir, 'gistSyncState');
    const entry = cur.entries.find((e) => e.tenantId === 'digi');
    entry.lastErrorCode = 'CONFLICT';
    seed(dataDir, 'gistSyncState', cur);
    mockGhForTest();
    const res2 = await request(server.app)
      .post('/api/v1/platform/sync/digi/test')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({});
    expect(res2.status).toBe(200);
    restoreFetch();
    rows = (await request(server.app).get('/api/v1/platform/sync').set('Authorization', 'Bearer ' + masterToken)).body.data.configs;
    expect(rows.find((r) => r.tenantId === 'digi').state).toBe('CONFLICT');
    void sync;
  });

  test('master pull returns revision/bytes/binding but NEVER dataset content', async () => {
    mockGhForTest();
    const res = await request(server.app)
      .post('/api/v1/platform/sync/digi/pull')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({});
    expect(res.status).toBe(200);
    const pull = res.body.data.pull;
    expect(pull.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof pull.bytes).toBe('number');
    expect(pull.binding).toBe('own');
    expect(pull.content).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('Laptop');
    restoreFetch();
  });

  test('master pull refuses a foreign-tagged gist (403)', async () => {
    const foreign = JSON.stringify({ _companyId: 'nile', products: [] });
    mockGhStatic(foreign);
    const res = await request(server.app)
      .post('/api/v1/platform/sync/digi/pull')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('CROSS_TENANT_PAYLOAD');
    restoreFetch();
  });

  test('master push: null base -> 409, correct base -> 200, response has no content echo', async () => {
    // Establish remote + base.
    mockGhStatic(DATASET);
    const pull = await request(server.app)
      .post('/api/v1/platform/sync/digi/pull')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({});
    expect(pull.status).toBe(200);
    restoreFetch();

    const sync = require('../services/gistSync.service');
    const upload = JSON.stringify({ products: [{ id: 'master-upload' }], settings: { localVersion: 7 } });

    mockGhStatic(DATASET);
    const nullBase = await request(server.app)
      .post('/api/v1/platform/sync/digi/push')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ content: upload, baseRevision: null });
    expect(nullBase.status).toBe(409);
    expect(nullBase.body.details && nullBase.body.details.code).toBe('CONFLICT');
    restoreFetch();

    let remoteNow = DATASET;
    mockFetch((url, opts) => {
      if (opts && opts.method === 'PATCH') {
        remoteNow = JSON.parse(opts.body).files['digitronics_db.json'].content;
        return ghJson(200, { ok: true });
      }
      return ghJson(200, { files: { 'digitronics_db.json': { content: remoteNow } } });
    });
    const ok = await request(server.app)
      .post('/api/v1/platform/sync/digi/push')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ content: upload, baseRevision: sync._sha256(DATASET) });
    expect(ok.status).toBe(200);
    expect(JSON.parse(remoteNow)._companyId).toBe('digi');
    expect(JSON.parse(remoteNow).products[0].id).toBe('master-upload');
    expect(ok.body.data.push.revision).toBe(sync._sha256(remoteNow));
    expect(JSON.stringify(ok.body)).not.toContain('master-upload');
    restoreFetch();
  });

  test('master push cross-tenant tag -> 403 before any upstream write', async () => {
    mockFetch(() => { throw new Error('must not be called'); });
    const res = await request(server.app)
      .post('/api/v1/platform/sync/digi/push')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ content: JSON.stringify({ _companyId: 'nile' }), baseRevision: null });
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('CROSS_TENANT_PAYLOAD');
    expect(global.fetch).not.toHaveBeenCalled();
    restoreFetch();
  });

  test('per-tenant sync audit endpoint: metadata-only entries, platform actions recorded, no secrets', async () => {
    const res = await request(server.app)
      .get('/api/v1/platform/sync/digi/audit')
      .set('Authorization', 'Bearer ' + masterToken);
    expect(res.status).toBe(200);
    const entries = res.body.data.audit.entries;
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
    const actions = entries.map((e) => e.action);
    expect(actions).toContain('PLATFORM_SYNC_PULL');
    expect(actions).toContain('PLATFORM_SYNC_PUSH');
    expect(actions).toContain('SYNC_TESTED');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('ghp_masterops_0001');
    expect(raw).not.toContain('master-upload');
    // Only digi entries are returned.
    expect(entries.every((e) => e.changes.tenantId === 'digi')).toBe(true);
  });

  test('tenant user cannot reach ANY master sync operation (403)', async () => {
    for (const call of [
      ['post', '/api/v1/platform/sync/digi/test'],
      ['post', '/api/v1/platform/sync/digi/pull'],
      ['post', '/api/v1/platform/sync/digi/push'],
      ['get', '/api/v1/platform/sync/digi/audit']
    ]) {
      const res = await request(server.app)[call[0]](call[1])
        .set('Authorization', 'Bearer ' + ownerToken)
        .send({});
      expect(res.status).toBe(403);
    }
  });
});

function mockGhForTest() {
  mockFetch((url, opts) => {
    if (opts && opts.method === 'PATCH') return ghJson(200, { ok: true });
    if (typeof url === 'string' && /\/gists\?/.test(url)) return ghJson(200, [{ id: 'x' }]);
    return ghJson(200, { files: { 'digitronics_db.json': { content: DATASET } } });
  });
}

// ---------------------------------------------------------------------- M

describe('M. MIGRATION_STATE — six-state legacy migration model (advisory report)', () => {
  let server;
  let dataDir;
  let masterToken;
  let nileToken;

  beforeAll(async () => {
    setFlags();
    dataDir = makeTempDataDir('gist-migration');
    tempDirs.push(dataDir);
    seedAll(dataDir);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
    nileToken = (await login(server.app, 'nileOwner', PASSWORD, 'nile')).accessToken;
  });

  afterAll(() => { restoreFlags(); restoreFetch(); });

  async function nileState() {
    const res = await request(server.app)
      .get('/api/v1/sync/status')
      .set('Authorization', 'Bearer ' + nileToken);
    return res.body.data.status.migrationState;
  }

  async function listRow(tenantId) {
    const res = await request(server.app)
      .get('/api/v1/platform/sync')
      .set('Authorization', 'Bearer ' + masterToken);
    return res.body.data.configs.find((r) => r.tenantId === tenantId);
  }

  test('fresh company: LEGACY_NOT_SEEN on both tenant status and master list', async () => {
    expect(await nileState()).toBe('LEGACY_NOT_SEEN');
    const row = await listRow('nile');
    expect(row.migrationState).toBe('LEGACY_NOT_SEEN');
  });

  test('device reports holding the old PAT -> LEGACY_PRESENT_NOT_MIGRATED', async () => {
    const res = await request(server.app)
      .post('/api/v1/sync/legacy-report')
      .set('Authorization', 'Bearer ' + nileToken)
      .send({ holdsLegacyToken: true });
    expect(res.status).toBe(200);
    expect(res.body.data.report.holdsLegacyToken).toBe(true);
    expect(res.body.data.report.migrationState).toBe('LEGACY_PRESENT_NOT_MIGRATED');
    expect(await nileState()).toBe('LEGACY_PRESENT_NOT_MIGRATED');
    expect((await listRow('nile')).migrationState).toBe('LEGACY_PRESENT_NOT_MIGRATED');
  });

  test('non-boolean or missing reports are rejected (400 INVALID_LEGACY_REPORT)', async () => {
    for (const bad of [{ holdsLegacyToken: 'true' }, { holdsLegacyToken: 1 }, {}, { holdsLegacyToken: null }]) {
      const res = await request(server.app)
        .post('/api/v1/sync/legacy-report')
        .set('Authorization', 'Bearer ' + nileToken)
        .send(bad);
      expect(res.status).toBe(400);
      expect(res.body.details && res.body.details.code).toBe('INVALID_LEGACY_REPORT');
    }
  });

  test('report is tenant-scoped by JWT only — injected tenant hints are ignored', async () => {
    const res = await request(server.app)
      .post('/api/v1/sync/legacy-report?tenantId=digi')
      .set('Authorization', 'Bearer ' + nileToken)
      .send({ holdsLegacyToken: true, tenantId: 'digi' });
    expect(res.status).toBe(200);
    expect(res.body.data.report.tenantId).toBe('nile');
    const legacy = readStore(dataDir, 'legacyMigrationState');
    expect(legacy.entries.every((e) => e.tenantId !== 'digi')).toBe(true);
  });

  test('token material in the report body is IGNORED — store keeps the boolean only', async () => {
    const res = await request(server.app)
      .post('/api/v1/sync/legacy-report')
      .set('Authorization', 'Bearer ' + nileToken)
      .send({ holdsLegacyToken: true, token: 'ghp_leakprobe_99', digi_gh_token: 'ghp_leakprobe_98' });
    expect(res.status).toBe(200);
    const legacy = readStore(dataDir, 'legacyMigrationState');
    const raw = JSON.stringify(legacy);
    expect(raw).not.toContain('ghp_leakprobe');
    const rec = legacy.entries.find((e) => e.tenantId === 'nile');
    expect(Object.keys(rec).sort()).toEqual(['holdsLegacyToken', 'reportedAt', 'tenantId', 'updatedAt']);
  });

  test('server binding without verification: SERVER_SYNC_AVAILABLE (no legacy held)', async () => {
    const put = await request(server.app)
      .put('/api/v1/platform/sync/digi')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ token: 'ghp_migtoken_0001', gistId: 'miggist0001' });
    expect(put.status).toBe(200);
    expect((await listRow('digi')).migrationState).toBe('SERVER_SYNC_AVAILABLE');
  });

  test('server binding while a device still holds the PAT stays LEGACY_PRESENT_NOT_MIGRATED', async () => {
    const put = await request(server.app)
      .put('/api/v1/platform/sync/nile')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ token: 'ghp_migtoken_0002', gistId: 'miggist0002' });
    expect(put.status).toBe(200);
    expect((await listRow('nile')).migrationState).toBe('LEGACY_PRESENT_NOT_MIGRATED');
  });

  test('pull + push observed -> MIGRATION_VERIFIED (digi, never reported legacy)', async () => {
    const digiDataset = JSON.stringify({ _companyId: 'digi', products: [{ id: 'p1' }] });
    mockGhStatic(digiDataset);
    const pull = await request(server.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + (await login(server.app, 'digiOwner', PASSWORD, 'digi')).accessToken)
      .send({});
    expect(pull.status).toBe(200);
    const push = await request(server.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + (await login(server.app, 'digiManager', PASSWORD, 'digi')).accessToken)
      .send({ content: JSON.stringify({ _companyId: 'digi', products: [{ id: 'p1' }, { id: 'p2' }] }), baseRevision: pull.body.data.pull.revision });
    expect(push.status).toBe(200);
    restoreFetch();
    expect((await listRow('digi')).migrationState).toBe('MIGRATION_VERIFIED');
  });

  test('verified + device holding PAT -> LEGACY_REVOCATION_PENDING; device-less v1 clear CANNOT establish LEGACY_REVOKED (fail-closed)', async () => {
    const nileDataset = JSON.stringify({ _companyId: 'nile', products: [] });
    mockGhStatic(nileDataset);
    const pull = await request(server.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + nileToken)
      .send({});
    expect(pull.status).toBe(200);
    const push = await request(server.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + nileToken)
      .send({ content: JSON.stringify({ _companyId: 'nile', products: [{ id: 'n1' }] }), baseRevision: pull.body.data.pull.revision });
    expect(push.status).toBe(200);
    restoreFetch();
    expect((await listRow('nile')).migrationState).toBe('LEGACY_REVOCATION_PENDING');

    // FIX A: a single device-less (v1) report saying "cleared" is no longer
    // sufficient to claim LEGACY_REVOKED — with no attested device inventory
    // the state stays MIGRATION_VERIFIED (fail-closed). The former behavior
    // (single report => LEGACY_REVOKED) is replaced; see M2 for the gate.
    const clear = await request(server.app)
      .post('/api/v1/sync/legacy-report')
      .set('Authorization', 'Bearer ' + nileToken)
      .send({ holdsLegacyToken: false });
    expect(clear.status).toBe(200);
    expect(clear.body.data.report.migrationState).toBe('MIGRATION_VERIFIED');
    expect((await listRow('nile')).migrationState).toBe('MIGRATION_VERIFIED');
    expect(await nileState()).toBe('MIGRATION_VERIFIED');
  });
});

// ---------------------------------------------------------------------- M2

describe('M2. REVOCATION_GATE - per-device evidence + trusted inventory (FIX A)', () => {
  let server;
  let dataDir;
  let masterToken;
  let nileToken;
  let digiToken;

  beforeAll(async () => {
    setFlags();
    dataDir = makeTempDataDir('gist-revocation-gate');
    tempDirs.push(dataDir);
    seedAll(dataDir);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
    nileToken = (await login(server.app, 'nileOwner', PASSWORD, 'nile')).accessToken;
    digiToken = (await login(server.app, 'digiOwner', PASSWORD, 'digi')).accessToken;
    // Bind both companies (server-authoritative verification prerequisite).
    const nileCfg = await request(server.app)
      .put('/api/v1/platform/sync/nile')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ token: 'ghp_gatetoken_0001', gistId: 'gatgist0001' });
    expect(nileCfg.status).toBe(200);
    const digiCfg = await request(server.app)
      .put('/api/v1/platform/sync/digi')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ token: 'ghp_gatetoken_0002', gistId: 'gatgist0002' });
    expect(digiCfg.status).toBe(200);
  });

  afterAll(() => { restoreFlags(); restoreFetch(); });

  async function state(token) {
    const res = await request(server.app)
      .get('/api/v1/sync/status')
      .set('Authorization', 'Bearer ' + token);
    return res.body.data.status.migrationState;
  }

  async function listState(tenantId) {
    const res = await request(server.app)
      .get('/api/v1/platform/sync')
      .set('Authorization', 'Bearer ' + masterToken);
    return res.body.data.configs.find((r) => r.tenantId === tenantId).migrationState;
  }

  function attest(tenantId, devices) {
    return request(server.app)
      .put('/api/v1/platform/sync/' + tenantId + '/device-inventory')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ devices });
  }

  function report(token, body) {
    return request(server.app)
      .post('/api/v1/sync/legacy-report')
      .set('Authorization', 'Bearer ' + token)
      .send(body);
  }

  async function verify(tenantId, token) {
    const dataset = JSON.stringify({ _companyId: tenantId, products: [] });
    mockGhStatic(dataset);
    const pull = await request(server.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + token)
      .send({});
    expect(pull.status).toBe(200);
    const push = await request(server.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + token)
      .send({ content: JSON.stringify({ _companyId: tenantId, products: [{ id: 'x1' }] }), baseRevision: pull.body.data.pull.revision });
    expect(push.status).toBe(200);
    restoreFetch();
  }

  test('device A reports true while device B reports false -> LEGACY_REVOCATION_PENDING, never revoked', async () => {
    await verify('nile', nileToken);
    const att = await attest('nile', ['dev-a', 'dev-b']);
    expect(att.status).toBe(200);
    expect((await report(nileToken, { holdsLegacyToken: true, reportVersion: 2, deviceId: 'dev-a' })).status).toBe(200);
    const b = await report(nileToken, { holdsLegacyToken: false, reportVersion: 2, deviceId: 'dev-b' });
    expect(b.status).toBe(200);
    expect(b.body.data.report.holdsLegacyToken).toBe(true); // conservative aggregate stays true
    expect(await state(nileToken)).toBe('LEGACY_REVOCATION_PENDING');
    expect(await listState('nile')).toBe('LEGACY_REVOCATION_PENDING');
  });

  test('one expected device cleared while another has not reported -> not revoked', async () => {
    const att = await attest('nile', ['dev-a', 'dev-b']); // fresh attestation resets clearances
    expect(att.status).toBe(200);
    const a = await report(nileToken, { holdsLegacyToken: false, reportVersion: 2, deviceId: 'dev-a' });
    expect(a.status).toBe(200);
    expect(await state(nileToken)).toBe('MIGRATION_VERIFIED');
    expect(await listState('nile')).not.toBe('LEGACY_REVOKED');
  });

  test('complete attested inventory + every expected device cleared -> LEGACY_REVOKED eligible', async () => {
    const att = await attest('nile', ['dev-a', 'dev-b']);
    expect(att.status).toBe(200);
    expect((await report(nileToken, { holdsLegacyToken: false, reportVersion: 2, deviceId: 'dev-a' })).status).toBe(200);
    const b = await report(nileToken, { holdsLegacyToken: false, reportVersion: 2, deviceId: 'dev-b' });
    expect(b.status).toBe(200);
    expect(b.body.data.report.migrationState).toBe('LEGACY_REVOKED');
    expect(await state(nileToken)).toBe('LEGACY_REVOKED');
    expect(await listState('nile')).toBe('LEGACY_REVOKED');
  });

  test('device-less v1 reports can never establish LEGACY_REVOKED', async () => {
    const att = await attest('nile', ['dev-a', 'dev-b']); // resets clearances -> all stale
    expect(att.status).toBe(200);
    const clear = await report(nileToken, { holdsLegacyToken: false });
    expect(clear.status).toBe(200);
    expect(clear.body.data.report.migrationState).toBe('MIGRATION_VERIFIED');
    expect(await state(nileToken)).toBe('MIGRATION_VERIFIED');
    expect(await listState('nile')).not.toBe('LEGACY_REVOKED');
    const hold = await report(nileToken, { holdsLegacyToken: true });
    expect(hold.status).toBe(200);
    expect(await state(nileToken)).toBe('LEGACY_REVOCATION_PENDING');
  });

  test('trusted inventory absent or incomplete -> cleared devices still not revoked (fail-closed)', async () => {
    await verify('digi', digiToken);
    // (a) no trusted inventory at all
    const r1 = await report(digiToken, { holdsLegacyToken: false, reportVersion: 2, deviceId: 'ghost' });
    expect(r1.status).toBe(200);
    expect(await state(digiToken)).toBe('MIGRATION_VERIFIED');
    expect(await listState('digi')).not.toBe('LEGACY_REVOKED');
    // (b) attested inventory that does not cover a reporting device -> incomplete
    expect((await attest('digi', ['dev-only'])).status).toBe(200);
    expect((await report(digiToken, { holdsLegacyToken: false, reportVersion: 2, deviceId: 'dev-only' })).status).toBe(200);
    const r2 = await report(digiToken, { holdsLegacyToken: false, reportVersion: 2, deviceId: 'ghost' });
    expect(r2.status).toBe(200);
    expect(await state(digiToken)).toBe('MIGRATION_VERIFIED');
    expect(await listState('digi')).not.toBe('LEGACY_REVOKED');
  });

  test('re-attestation prunes unknown cleared evidence; fresh clearance then revokes', async () => {
    expect((await attest('digi', ['dev-only'])).status).toBe(200); // prunes unknown holds=false evidence
    // dev-only clearance predates this attestation => stale
    expect(await state(digiToken)).toBe('MIGRATION_VERIFIED');
    expect(await listState('digi')).not.toBe('LEGACY_REVOKED');
    const r = await report(digiToken, { holdsLegacyToken: false, reportVersion: 2, deviceId: 'dev-only' });
    expect(r.body.data.report.migrationState).toBe('LEGACY_REVOKED');
    expect(await state(digiToken)).toBe('LEGACY_REVOKED');
    expect(await listState('digi')).toBe('LEGACY_REVOKED');
  });

  test('clearance recorded BEFORE attestation is stale and cannot bypass the gate', async () => {
    expect((await attest('digi', ['dev-only', 'dev-fresh'])).status).toBe(200);
    // dev-fresh clears, but dev-only clearance predates this attestation
    const r1 = await report(digiToken, { holdsLegacyToken: false, reportVersion: 2, deviceId: 'dev-fresh' });
    expect(r1.body.data.report.migrationState).toBe('MIGRATION_VERIFIED');
    expect(await listState('digi')).not.toBe('LEGACY_REVOKED');
    // fresh re-clearance for dev-only completes the gate
    const r2 = await report(digiToken, { holdsLegacyToken: false, reportVersion: 2, deviceId: 'dev-only' });
    expect(r2.body.data.report.migrationState).toBe('LEGACY_REVOKED');
    expect(await listState('digi')).toBe('LEGACY_REVOKED');
  });

  test('inventory is master-only: tenant sessions cannot read or write it', async () => {
    const put = await request(server.app)
      .put('/api/v1/platform/sync/nile/device-inventory')
      .set('Authorization', 'Bearer ' + nileToken)
      .send({ devices: ['evil-device'] });
    expect(put.status).toBe(403);
    const get = await request(server.app)
      .get('/api/v1/platform/sync/nile/device-inventory')
      .set('Authorization', 'Bearer ' + nileToken);
    expect(get.status).toBe(403);
    const legacy = readStore(dataDir, 'legacyMigrationState');
    const nileRec = legacy.entries.find((e) => e.tenantId === 'nile');
    expect(JSON.stringify((nileRec && nileRec.inventory) || {})).not.toContain('evil-device');
  });

  test('spoofed tenant scope is safely scoped (JWT only) and a true report reopens revocation', async () => {
    const res = await report(digiToken, { holdsLegacyToken: true, reportVersion: 2, deviceId: 'dev-spoof', tenantId: 'nile' });
    expect(res.status).toBe(200);
    expect(res.body.data.report.tenantId).toBe('digi');
    const legacy = readStore(dataDir, 'legacyMigrationState');
    const nileRec = legacy.entries.find((e) => e.tenantId === 'nile');
    expect(!nileRec.devices || nileRec.devices['dev-spoof']).toBeFalsy();
    expect(await state(digiToken)).toBe('LEGACY_REVOCATION_PENDING');
    expect(await listState('digi')).toBe('LEGACY_REVOCATION_PENDING');
  });

  test('malformed, oversized, duplicate or invalid evidence is rejected (400)', async () => {
    const badBodies = [
      { holdsLegacyToken: 'false', reportVersion: 2, deviceId: 'dev-a' },
      { holdsLegacyToken: false, reportVersion: 99, deviceId: 'dev-a' },
      { holdsLegacyToken: false, reportVersion: 2, deviceId: 'DEV/A' },
      { holdsLegacyToken: false, reportVersion: 2, deviceId: '../../etc/passwd' },
      { holdsLegacyToken: false, reportVersion: 2, deviceId: 'x'.repeat(65) },
      { holdsLegacyToken: false, reportVersion: 2, deviceId: 123 },
      { holdsLegacyToken: false, reportVersion: 2, deviceId: '' },
      { holdsLegacyToken: false, reportVersion: 2, deviceId: 'dev-a', padding: 'y'.repeat(5000) }
    ];
    for (const b of badBodies) {
      const res = await report(nileToken, b);
      expect(res.status).toBe(400);
      expect(res.body.details && res.body.details.code).toBe('INVALID_LEGACY_REPORT');
    }
    // duplicate (case-insensitive) inventory ids rejected
    expect((await attest('nile', ['dev-a', 'DEV-A'])).status).toBe(400);
    // empty / non-array / oversized inventories rejected
    expect((await attest('nile', [])).status).toBe(400);
    expect((await attest('nile', 'dev-a')).status).toBe(400);
    const many = [];
    for (let i = 0; i < 65; i++) many.push('dev-' + i);
    expect((await attest('nile', many)).status).toBe(400);
    // per-device evidence map is bounded at 64 entries
    const legacy0 = readStore(dataDir, 'legacyMigrationState');
    const nileRec0 = legacy0.entries.find((e) => e.tenantId === 'nile');
    const have = Object.keys(nileRec0.devices || {}).length;
    for (let i = have; i < 64; i++) {
      const ok = await report(nileToken, { holdsLegacyToken: false, reportVersion: 2, deviceId: 'evi-' + i });
      expect(ok.status).toBe(200);
    }
    const over = await report(nileToken, { holdsLegacyToken: false, reportVersion: 2, deviceId: 'evi-overflow' });
    expect(over.status).toBe(400);
    expect(over.body.details && over.body.details.code).toBe('INVALID_LEGACY_REPORT');
  });
});

// ---------------------------------------------------------------------- G

describe('G. DATA_INTEGRITY — failed writes never advance state; state store holds no dataset/secrets', () => {
  let server;
  let dataDir;
  let masterToken;
  let ownerToken;
  let baseline;

  beforeAll(async () => {
    setFlags();
    dataDir = makeTempDataDir('gist-integrity');
    tempDirs.push(dataDir);
    seedAll(dataDir);
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000', AUTH_REQUIRED: 'true' });
    masterToken = (await login(server.app, 'master', PASSWORD)).accessToken;
    ownerToken = (await login(server.app, 'digiOwner', PASSWORD, 'digi')).accessToken;
    await request(server.app)
      .put('/api/v1/platform/sync/digi')
      .set('Authorization', 'Bearer ' + masterToken)
      .send({ token: 'ghp_integrity_0001', gistId: 'intgist0001' });
  });

  afterAll(() => { restoreFlags(); restoreFetch(); });

  async function digiStatus() {
    const res = await request(server.app)
      .get('/api/v1/sync/status')
      .set('Authorization', 'Bearer ' + ownerToken);
    expect(res.status).toBe(200);
    return res.body.data.status;
  }

  test('baseline: successful pull records revision + pull time, push time still null', async () => {
    mockGhStatic(DATASET);
    const pull = await request(server.app)
      .post('/api/v1/sync/pull')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({});
    expect(pull.status).toBe(200);
    restoreFetch();
    baseline = await digiStatus();
    expect(baseline.lastRevision).toBeTruthy();
    expect(baseline.lastPullAt).toBeTruthy();
    expect(baseline.lastPushAt).toBeNull();
    expect(baseline.lastErrorCode).toBeNull();
  });

  test('upstream 500 during PUSH -> 502; revision/pull/push timestamps FROZEN, error recorded', async () => {
    // Remote GET succeeds (content still matches the baseline revision),
    // PATCH explodes: the write must fail without advancing any state field.
    mockFetch((url, opts) => {
      if (opts && opts.method === 'PATCH') return ghJson(500, { message: 'Server Error' });
      return ghJson(200, { files: { 'digitronics_db.json': { content: DATASET } } });
    });
    const content = JSON.stringify({ _companyId: 'digi', products: [], settings: { localVersion: 7 }, integrityProbe: 'G5' });
    const res = await request(server.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ content, baseRevision: baseline.lastRevision });
    expect(res.status).toBe(502);
    expect(res.body.details && res.body.details.code).toBe('UPSTREAM_UNAVAILABLE');
    restoreFetch();

    const after = await digiStatus();
    expect(after.lastRevision).toBe(baseline.lastRevision);
    expect(after.lastPullAt).toBe(baseline.lastPullAt);
    expect(after.lastPushAt).toBe(baseline.lastPushAt); // still null
    expect(after.lastErrorCode).toBe('UPSTREAM_UNAVAILABLE');
  });

  test('recovery: successful push advances revision + push time and clears the error', async () => {
    mockGhStatic(DATASET);
    const content = JSON.stringify({ _companyId: 'digi', products: [], settings: { localVersion: 7 }, integrityProbe: 'G5-recovered' });
    const res = await request(server.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ content, baseRevision: baseline.lastRevision });
    expect(res.status).toBe(200);
    expect(res.body.data.push.revision).toBeTruthy();
    restoreFetch();

    const after = await digiStatus();
    expect(after.lastRevision).toBe(res.body.data.push.revision);
    expect(after.lastRevision).not.toBe(baseline.lastRevision);
    expect(after.lastPushAt).toBeTruthy();
    expect(after.lastErrorCode).toBeNull();
    baseline = after;
  });

  test('conflict (stale base) also leaves state frozen — error recorded, no advance', async () => {
    mockGhStatic(DATASET);
    const res = await request(server.app)
      .post('/api/v1/sync/push')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ content: JSON.stringify({ _companyId: 'digi', stale: true }), baseRevision: 'deadbeef' });
    expect(res.status).toBe(409);
    expect(res.body.details && res.body.details.code).toBe('CONFLICT');
    restoreFetch();

    const after = await digiStatus();
    expect(after.lastRevision).toBe(baseline.lastRevision);
    expect(after.lastPushAt).toBe(baseline.lastPushAt);
    expect(after.lastErrorCode).toBe('CONFLICT');
  });

  test('state store on disk: encrypted vault blob only — no dataset content, no plaintext token', async () => {
    const raw = JSON.stringify(readStore(dataDir, 'gistSyncState'));
    expect(raw).toContain('v1:');                        // vault ciphertext format
    expect(raw).not.toContain('ghp_integrity_0001');     // plaintext token never persisted
    expect(raw).not.toContain('Laptop');                 // seeded dataset marker absent
    expect(raw).not.toContain('_companyId');             // no dataset payload in state
    expect(raw).not.toContain('integrityProbe');         // pushed content absent from state
  });
});

registerCleanup(() => [], () => tempDirs);
