'use strict';

// Public Google login configuration endpoint (P6.71).
//
// The browser needs the OAuth CLIENT ID to obtain a Google ID token. This
// test pins that the endpoint exposes the public identifier ONLY — never the
// client secret — and that it fails closed when ID-token sign-in is not
// configured. No real Google request is involved.

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
// Deliberately labelled sentinel: proves the endpoint never serializes the
// client secret. NOT a credential and never a real value.
const SECRET_SENTINEL = 'test-sentinel-not-a-credential';

const dirs = [];
let enabled;
let disabled;

registerCleanup(() => [], () => dirs);

beforeAll(() => {
  dirs.push(makeTempDataDir('google-login-config-enabled'));
  enabled = startServer(dirs[0], {
    OAUTH_TENANT_LOGIN_ENABLED: 'true',
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: SECRET_SENTINEL
  });
});

describe('GET /api/v1/auth/google-login/config', () => {
  test('exposes the public client id and nothing secret', async () => {
    const res = await request(enabled.app).get('/api/v1/auth/google-login/config');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ enabled: true, clientId: CLIENT_ID });
    expect(JSON.stringify(res.body)).not.toContain(SECRET_SENTINEL);
    expect(JSON.stringify(res.body)).not.toMatch(/secret/i);
  });

  test('requires no authentication', async () => {
    const res = await request(enabled.app).get('/api/v1/auth/google-login/config');
    expect(res.status).toBe(200);
  });

  test('fails closed when Google login is not configured', async () => {
    // Started LAST on purpose: startServer() owns the process env, so the
    // unconfigured instance must not precede the configured assertions.
    dirs.push(makeTempDataDir('google-login-config-disabled'));
    disabled = startServer(dirs[1], { OAUTH_TENANT_LOGIN_ENABLED: 'true' });
    const res = await request(disabled.app).get('/api/v1/auth/google-login/config');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ enabled: false, clientId: '' });
  });
});
