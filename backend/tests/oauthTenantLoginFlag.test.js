jest.mock('../services/googleAuthCode.service', () => {
  const original = jest.requireActual('../services/googleAuthCode.service');
  return {
    ...original,
    createLoginStart: jest.fn(() => ({ url: 'https://accounts.google.com/o/oauth2/v2/auth?mock=1' }))
  };
});

const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const BASE = {
  RATE_LIMIT_MAX: '100000',
  OAUTH_ENABLED: 'true',
  GOOGLE_CLIENT_ID: 'flag-client-id',
  GOOGLE_CLIENT_SECRET: 'flag-client-secret',
  GOOGLE_CALLBACK_URL: 'http://127.0.0.1/auth/google/callback',
  GOOGLE_AUTHCODE_CALLBACK_URL: 'http://127.0.0.1/auth/google-login-code/callback',
  GOOGLE_MASTER_CALLBACK_URL: 'http://127.0.0.1/auth/google/master/callback'
};

const dirs = [];
registerCleanup(() => [], () => dirs);

function boot(extra, users) {
  const dir = makeTempDataDir('tenant-flag');
  dirs.push(dir);
  seed(dir, 'users', {
    users: users || [{
      id: 'u-password', username: 'password-user',
      password: bcrypt.hashSync('Password#123', 10),
      fullName: 'Password User', role: 'Viewer', status: 'active',
      tokenVersion: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }]
  });
  const app = startServer(dir, { ...BASE, ...extra }).app;
  return app;
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

const GIS_PATHS = [
  ['get', '/api/v1/auth/google-login/config', null],
  ['post', '/api/v1/auth/google-login', {}],
  ['post', '/api/v1/auth/google-login/mfa-verify', {}],
  ['post', '/api/v1/auth/google-login/select-tenant', {}]
];

describe('OAUTH_TENANT_LOGIN_ENABLED — server-side gate', () => {
  test('OAUTH_ENABLED=true and flag absent: all AuthCode routes are closed', async () => {
    const app = boot({});
    const checks = [
      request(app).get('/auth/google-login-code'),
      request(app).get('/auth/google-login-code/challenge'),
      request(app).get('/auth/google-login-code/callback?code=x&state=y'),
      request(app).post('/auth/google-login-code/mfa-verify').send({ mfaToken: '123456' }),
      request(app).post('/auth/google-login-code/select-tenant').send({ tenantId: 't1' })
    ];
    for (const res of await Promise.all(checks)) {
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/disabled/i);
    }
  });

  test('OAUTH_ENABLED=true and flag=false: both AuthCode route prefixes are closed', async () => {
    const app = boot({ OAUTH_TENANT_LOGIN_ENABLED: 'false' });
    const prefixes = ['/auth/google-login-code', '/api/v1/auth/google-login-code'];
    for (const prefix of prefixes) {
      const checks = [
        request(app).get(prefix),
        request(app).get(prefix + '/challenge'),
        request(app).post(prefix + '/mfa-verify').send({ mfaToken: '123456' }),
        request(app).post(prefix + '/select-tenant').send({ tenantId: 't1' })
      ];
      if (prefix === '/auth/google-login-code') {
        checks.push(request(app).get(prefix + '/callback?code=x&state=y'));
      }
      for (const res of await Promise.all(checks)) {
        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
      }
    }
  });

  test('both flags enabled with complete settings: AuthCode flow is available', async () => {
    const app = boot({ OAUTH_TENANT_LOGIN_ENABLED: 'true' });
    const res = await request(app).get('/auth/google-login-code?returnTo=/dashboard').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/accounts\.google\.com/);
  });

  test('Master OAuth remains independent of the tenant flag', async () => {
    const app = boot({ OAUTH_TENANT_LOGIN_ENABLED: 'false' });
    const res = await request(app).get('/auth/google/master').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/accounts\.google\.com/);
    expect(decodeURIComponent(res.headers.location)).toMatch(/google\/master\/callback/);
  });

  test('password login is unaffected by the tenant flag', async () => {
    const app = boot({ OAUTH_TENANT_LOGIN_ENABLED: 'false' });
    const res = await request(app).post('/api/v1/auth/login')
      .send({ username: 'password-user', password: 'Password#123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
  });
});

describe('OAUTH_TENANT_LOGIN_ENABLED — GIS ID-token routes', () => {
  test.each([undefined, 'false', 'TRUE', '1', 'yes'])(
    'flag=%p with GOOGLE_CLIENT_ID present: all GIS paths are closed',
    async (value) => {
      const app = boot(value === undefined ? {} : { OAUTH_TENANT_LOGIN_ENABLED: value });
      for (const [method, path, body] of GIS_PATHS) {
        const req = request(app)[method](path);
        const res = body ? await req.send(body) : await req;
        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
      }
    }
  );

  test('controller reports enabled=false for absent, false and invalid values', () => {
    const cases = [undefined, 'false', 'TRUE', '1'];
    for (const value of cases) {
      const app = boot(value === undefined ? {} : { OAUTH_TENANT_LOGIN_ENABLED: value });
      const ctrl = require('../controllers/auth.controller');
      const res = fakeRes();
      ctrl.googleLoginConfig({}, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.enabled).toBe(false);
      expect(res.body.data.clientId).toBe('flag-client-id');
      expect(app).toBeTruthy();
    }
  });

  test('flag=true with client id present: GIS config reports enabled and handlers are reached', async () => {
    const app = boot({ OAUTH_TENANT_LOGIN_ENABLED: 'true' });
    const cfg = await request(app).get('/api/v1/auth/google-login/config');
    expect(cfg.status).toBe(200);
    expect(cfg.body.data.enabled).toBe(true);

    const login = await request(app).post('/api/v1/auth/google-login').send({});
    expect(login.status).toBe(400);
    expect(login.body.message).toMatch(/ID token/i);

    const mfa = await request(app).post('/api/v1/auth/google-login/mfa-verify').send({});
    expect(mfa.status).not.toBe(403);
    const tenant = await request(app).post('/api/v1/auth/google-login/select-tenant').send({});
    expect(tenant.status).not.toBe(403);
  });

  test('unknown Google sub with a matching email does not create or link an account', async () => {
    const linked = [{
      id: 'u-linked', username: 'linked-user',
      password: bcrypt.hashSync('Password#123', 10),
      fullName: 'Linked User', role: 'Cashier', status: 'active',
      email: 'linked@example.com', oauth: { google: 'linked-sub' },
      tokenVersion: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }];
    const app = boot({ OAUTH_TENANT_LOGIN_ENABLED: 'true' }, linked);
    const googleIdentity = require('../utils/googleIdentity');
    const spy = jest.spyOn(googleIdentity, 'verifyIdToken').mockResolvedValue({
      sub: 'unknown-sub', email: 'linked@example.com', emailVerified: true
    });
    const res = await request(app).post('/api/v1/auth/google-login').send({ idToken: 'fake-id-token' });
    expect(res.status).toBe(401);
    const users = readStore(dirs[dirs.length - 1], 'users').users;
    expect(users).toHaveLength(1);
    expect(users[0].oauth.google).toBe('linked-sub');
    expect(users[0].role).toBe('Cashier');
    spy.mockRestore();
  });

  test('flag does not leak between in-process server instances', async () => {
    const on = boot({ OAUTH_TENANT_LOGIN_ENABLED: 'true' });
    expect((await request(on).get('/api/v1/auth/google-login/config')).status).toBe(200);
    const off = boot({});
    expect((await request(off).get('/api/v1/auth/google-login/config')).status).toBe(403);
  });

  test('AuthCode routes remain protected after GIS fix', async () => {
    const app = boot({ OAUTH_TENANT_LOGIN_ENABLED: 'false' });
    const checks = [
      request(app).get('/auth/google-login-code'),
      request(app).get('/api/v1/auth/google-login-code'),
      request(app).get('/auth/google-login-code/challenge'),
      request(app).post('/api/v1/auth/google-login-code/mfa-verify').send({})
    ];
    for (const res of await Promise.all(checks)) expect(res.status).toBe(403);
  });

  test('Master OAuth and password login remain independent', async () => {
    const app = boot({ OAUTH_TENANT_LOGIN_ENABLED: 'false' });
    const master = await request(app).get('/auth/google/master').redirects(0);
    expect(master.status).toBe(302);
    expect(master.headers.location).toMatch(/accounts\.google\.com/);
    const login = await request(app).post('/api/v1/auth/login')
      .send({ username: 'password-user', password: 'Password#123' });
    expect(login.status).toBe(200);
  });
});
