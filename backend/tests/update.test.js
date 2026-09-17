'use strict';

// In-app update rail tests (Phase C):
//   - semver comparison unit tests
//   - GET /api/v1/update/manifest: no-update shape, newer-version shape
//   - POST /api/v1/update/apply: auth gating (401 / 403 / disabled → 500)
// The 202 happy path is not exercised here to avoid spawning the real updater
// process; it is covered by the ops flow in GO_LIVE.md.

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');

const ORIGINAL_ENV = {
  MANIFEST: process.env.UPDATE_MANIFEST_PATH,
  ENABLED: process.env.UPDATE_ENABLED,
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

describe('update.service — version comparison', () => {
  let updateService;
  beforeAll(() => {
    jest.resetModules();
    updateService = require('../services/update.service');
  });

  test('compareVersions orders versions correctly', () => {
    expect(updateService.compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(updateService.compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(updateService.compareVersions('1.0.1', '1.0.0')).toBe(1);
    expect(updateService.compareVersions('1.2.3', '1.10.0')).toBe(-1);
    expect(updateService.compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(updateService.compareVersions('1.0.0', '1.0')).toBe(0);
  });

  test('currentVersion comes from package.json', () => {
    expect(updateService.currentVersion()).toBe(require('../package.json').version);
  });
});

describe('update rail — HTTP', () => {
  let app;
  let dir;
  let adminToken;
  let cashierToken;

  beforeAll(async () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.UPDATE_ENABLED = 'true';
    dir = makeTempDataDir('update-rail');
    // Write a NEWER manifest (1.0.1 vs current 1.0.0) into the temp dir.
    const manifest = {
      version: '99.0.0',
      releaseDate: '2026-08-16',
      downloadUrl: 'https://updates.example.com/omnistore-99.0.0.zip',
      sha256: 'a'.repeat(64),
      mandatory: false,
      releaseNotes: 'Test release',
      minimumSupportedVersion: '1.0.0'
    };
    fs.writeFileSync(path.join(dir, 'updateManifest.json'), JSON.stringify(manifest));
    process.env.UPDATE_MANIFEST_PATH = path.join(dir, 'updateManifest.json');

    seed(dir, 'companies', [{ id: 'corp-a', name: 'Corp A', code: 'CA', active: true }]);
    const stamp = new Date().toISOString();
    seed(dir, 'users', { users: [
      { id: 'u-admin', username: 'boss', password: bcrypt.hashSync('Pass#123', 10), role: 'Owner', fullName: 'Boss', tenantIds: ['corp-a'], tenantRoles: { 'corp-a': 'Owner' }, createdAt: stamp, updatedAt: stamp },
      { id: 'u-cash', username: 'cashier', password: bcrypt.hashSync('Pass#123', 10), role: 'Cashier', fullName: 'Cashier', tenantIds: ['corp-a'], tenantRoles: { 'corp-a': 'Cashier' }, createdAt: stamp, updatedAt: stamp }
    ]});

    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    app = s.app;

    async function loginAs(username) {
      const res = await request(app).post('/api/v1/auth/login').send({ username, password: 'Pass#123', company: 'corp-a' });
      return res.body && res.body.data ? res.body.data.accessToken : undefined;
    }
    adminToken = await loginAs('boss');
    cashierToken = await loginAs('cashier');
  });

  afterAll(() => {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
    for (const [envKey, origKey] of [['UPDATE_MANIFEST_PATH', 'MANIFEST'], ['UPDATE_ENABLED', 'ENABLED'], ['AUTH_REQUIRED', 'AUTH'], ['DIGITRONICS_DATA_DIR', 'DATA']]) {
      const orig = ORIGINAL_ENV[envKey];
      if (orig === undefined) delete process.env[envKey];
      else process.env[envKey] = orig;
    }
  });

  test('GET /api/v1/update/manifest reports an available newer version', async () => {
    const res = await request(app).get('/api/v1/update/manifest');
    expect(res.statusCode).toBe(200);
    const d = res.body.data;
    expect(d.updateAvailable).toBe(true);
    expect(d.currentVersion).toBe('1.0.0');
    expect(d.latestVersion).toBe('99.0.0');
    expect(d.sha256).toBe('a'.repeat(64));
    expect(d.downloadUrl).toMatch(/^https:\/\//);
    expect(d.mandatory).toBe(false);
  });

  test('POST /api/v1/update/apply without a token is 401', async () => {
    const res = await request(app).post('/api/v1/update/apply');
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/v1/update/apply with a non-admin role is 403', async () => {
    const res = await request(app).post('/api/v1/update/apply').set('Authorization', `Bearer ${cashierToken}`);
    expect(res.statusCode).toBe(403);
  });
});

describe('update rail — apply gated when updates disabled', () => {
  let app;
  let dir;
  let adminToken;

  beforeAll(async () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.UPDATE_ENABLED = 'false';
    dir = makeTempDataDir('update-disabled');
    const stamp = new Date().toISOString();
    seed(dir, 'companies', [{ id: 'corp-a', name: 'Corp A', code: 'CA', active: true }]);
    seed(dir, 'users', { users: [
      { id: 'u-admin', username: 'boss', password: bcrypt.hashSync('Pass#123', 10), role: 'Owner', fullName: 'Boss', tenantIds: ['corp-a'], tenantRoles: { 'corp-a': 'Owner' }, createdAt: stamp, updatedAt: stamp }
    ]});
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    app = s.app;
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'boss', password: 'Pass#123', company: 'corp-a' });
    adminToken = res.body && res.body.data ? res.body.data.accessToken : undefined;
  });

  afterAll(() => {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
    const map = [['UPDATE_ENABLED', 'ENABLED'], ['AUTH_REQUIRED', 'AUTH'], ['DIGITRONICS_DATA_DIR', 'DATA']];
    for (const [envKey, origKey] of map) {
      const orig = ORIGINAL_ENV[envKey];
      if (orig === undefined) delete process.env[envKey];
      else process.env[envKey] = orig;
    }
  });

  test('manifest reports updateAvailable=false when updates are disabled', async () => {
    const res = await request(app).get('/api/v1/update/manifest');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.updateAvailable).toBe(false);
  });

  test('admin apply with updates disabled returns 500 without launching anything', async () => {
    const res = await request(app).post('/api/v1/update/apply').set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(500);
  });
});
