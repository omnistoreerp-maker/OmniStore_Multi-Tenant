// Regression test: Master login must establish a REAL cookie-backed session
// (not just in-memory/localStorage tokens). Pins the cookie attributes and the
// cookie-based session-read path that the Platform Master Google linking and
// control-center surfaces depend on.
// Covers: valid credentials -> session; invalid -> rejected; session survives
// next authenticated request; cookie attributes correct;
// /api/v1/platform/control-center/access succeeds after cookie login.
'use strict';

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');

const PASSWORD = 'Pass#123';
const tempDirs = [];

function seedAll(dir) {
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const stamp = new Date().toISOString();
  seed(dir, 'users', {
    users: [{
      id: 'u-master', username: 'omnistore', password: hash,
      fullName: 'Platform Master', role: 'Viewer', tokenVersion: 0,
      createdAt: stamp, updatedAt: stamp
    }]
  });
  seed(dir, 'platformAdmins', {
    admins: [{
      username: 'omnistore', platformRole: 'MASTER_OWNER', status: 'active',
      createdAt: stamp, updatedAt: stamp
    }]
  });
}

function cookieJar() {
  const jar = new Map();
  return {
    store(res) {
      for (const c of (res.headers['set-cookie'] || [])) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        if (i > -1) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
    header() { return [...jar.entries()].map(([k, v]) => k + '=' + v).join('; '); },
    has(name) { return jar.has(name); }
  };
}

describe('Master login cookie session (regression)', () => {
  let server, dir, jar;

  beforeAll(async () => {
    jest.resetModules();
    process.env.AUTH_REQUIRED = 'true';
    dir = makeTempDataDir('mlogin');
    tempDirs.push(dir);
    seedAll(dir);
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    server = s.app;
    jar = cookieJar();
  });

  afterAll(() => {
    tempDirs.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} });
  });

  async function login(username, password) {
    const res = await request(server).post('/api/v1/auth/login')
      .send({ username, password });
    jar.store(res);
    return res;
  }

  it('valid Master credentials create an authenticated cookie session', async () => {
    const res = await login('omnistore', PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(jar.has('access_token')).toBe(true);
    expect(jar.has('refresh_token')).toBe(true);
    const accessCookie = (res.headers['set-cookie'] || []).find(c => c.startsWith('access_token='));
    expect(accessCookie).toMatch(/Path=\/\s*(;|$)/);
    expect(accessCookie).toMatch(/HttpOnly/);
    expect(accessCookie).toMatch(/SameSite=Lax/);
  });

  it('invalid credentials are rejected', async () => {
    const res = await login('omnistore', 'wrong-password');
    expect(res.status).toBe(401);
  });

  it('session survives the next authenticated request via cookie', async () => {
    await login('omnistore', PASSWORD);
    const me = await request(server).get('/api/v1/platform/me').set('Cookie', jar.header());
    expect(me.status).toBe(200);
    expect(me.body.success).toBe(true);
    expect(me.body.data.platformRole).toBe('MASTER_OWNER');
  });

  it('/api/v1/platform/control-center/access succeeds after cookie login', async () => {
    await login('omnistore', PASSWORD);
    const cc = await request(server).get('/api/v1/platform/control-center/access').set('Cookie', jar.header());
    expect(cc.status).toBe(200);
    expect(cc.body.success).toBe(true);
    expect(cc.body.data.platformRole).toBe('MASTER_OWNER');
    expect(Array.isArray(cc.body.data.permissions)).toBe(true);
  });

  it('a request without the cookie is not authenticated', async () => {
    await login('omnistore', PASSWORD);
    const me = await request(server).get('/api/v1/platform/me'); // no Cookie
    expect(me.status).toBe(401); // platform.me: authentication required without session
  });
});
