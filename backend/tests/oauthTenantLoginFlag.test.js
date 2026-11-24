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
const { makeTempDataDir, seed } = require('./helpers/testData');
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

function boot(extra) {
  const dir = makeTempDataDir('tenant-flag');
  dirs.push(dir);
  seed(dir, 'users', {
    users: [{
      id: 'u-password', username: 'password-user',
      password: bcrypt.hashSync('Password#123', 10),
      fullName: 'Password User', role: 'Viewer', status: 'active',
      tokenVersion: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }]
  });
  const app = startServer(dir, { ...BASE, ...extra }).app;
  return app;
}

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

  test('OAUTH_ENABLED=true and flag=false: AuthCode initiation is closed', async () => {
    const app = boot({ OAUTH_TENANT_LOGIN_ENABLED: 'false' });
    const res = await request(app).get('/auth/google-login-code');
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
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
