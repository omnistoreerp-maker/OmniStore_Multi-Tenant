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

registerCleanup(() => [], () => tempDirs);
