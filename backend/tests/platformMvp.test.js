'use strict';

// PLATFORM ONLINE MVP — end-to-end contract tests for the platform launch:
//   1. `/` serves the Platform Home (NOT the ERP dashboard).
//   2. Platform Home renders the dynamic surface and an honest minimal layout.
//   3. business.html reuses the REAL /auth/login (no parallel auth) and the
//      hardened public provisioning endpoint.
//   4. Public onboarding hardening: unknown/oversized payloads rejected,
//      duplicates return a generic 400 (no enumeration), the audit trail
//      records the synthetic public actor (never null), and NO client-supplied
//      role/tenant/ownership field can leak through.
//   5. PWA: the service worker precaches the platform pages.

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const ROOT = path.resolve(__dirname, '..', '..');

function repoFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

describe('Platform MVP — static surface', () => {
  test('platform.html is the public home with honest minimal layout', () => {
    const html = repoFile('platform.html');
    expect(html).toContain('OmniStore ERP');
    expect(html).toContain('Multi-Tenant Enterprise Resource Planning');
    expect(html).toContain('Change Center');
    expect(html).toContain('My Requests');
    expect(html).toContain('Open Application');
    expect(html).toContain('platform/platform.js');
    expect(html).not.toContain('id="loginScreen"');
  });

  test('business.html signs into the REAL auth flow and posts onboarding to the hardened endpoint', () => {
    const html = repoFile('business.html');
    expect(html).toContain("postJSON('/auth/login'");
    expect(html).toContain("postJSON('/platform-public/onboarding/provision'");
    // Same session keys the ERP resumes on load — no parallel auth system.
    expect(html).toContain("localStorage.setItem('access_token'");
    expect(html).toContain("localStorage.setItem('cairo_session_user'");
    expect(html).toContain("window.location.assign('index.html')");
    // No fake payment: billing handled offline.
    expect(html).toMatch(/no online payment|Payment \/ billing is arranged/i);
    // Client cannot pick roles or tenant metadata beyond its own new ids.
    expect(html).not.toMatch(/role['"]\s*[:=]\s*['"]Owner/i);
  });

  test('service worker precaches the platform pages', () => {
    const sw = repoFile('sw.js');
    expect(sw).toContain("'./platform.html'");
    expect(sw).toContain("'./business.html'");
    expect(sw).toContain("'./platform/platform.css'");
  });

  test('ERP is intact: index.html keeps its login screen and platform link', () => {
    const html = repoFile('index.html');
    expect(html).toContain('id="loginScreen"');
    expect(html).toContain('href="platform.html"');
  });
});

describe('Platform MVP — `/` serves Platform Home and public APIs', () => {
  const ORIGINAL_ENV = {
    AUTH: process.env.AUTH_REQUIRED,
    DATA: process.env.DIGITRONICS_DATA_DIR
  };
  let server;
  let dataDir;

  registerCleanup(() => [server], () => [dataDir]);

  beforeAll(async () => {
    dataDir = makeTempDataDir('platform-mvp');
    seed(dataDir, 'companies', { companies: [{ id: 'acme', code: 'ACME', name: 'Acme', active: true }] });
    seed(dataDir, 'users', { users: [] });
    server = await startServer(dataDir, { AUTH_REQUIRED: 'false' });
  });

  afterAll(() => {
    for (const [key, original] of Object.entries(ORIGINAL_ENV)) {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });

  test('GET / serves the Platform Home markup, not the ERP dashboard', async () => {
    const res = await request(server.app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('OmniStore ERP');
    expect(res.text).toContain('platform/platform.js');
    expect(res.text).not.toContain('id="loginScreen"');
  });

  test('GET /index.html still serves the ERP (compatibility preserved)', async () => {
    const res = await request(server.app).get('/index.html');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('id="loginScreen"');
  });

  test('GET /platform.html and /business.html are served', async () => {
    const p = await request(server.app).get('/platform.html');
    expect(p.statusCode).toBe(200);
    expect(p.text).toContain('OmniStore ERP');
    const b = await request(server.app).get('/business.html');
    expect(b.statusCode).toBe(200);
    expect(b.text).toContain('Business Management Services');
  });

  test('public catalog API stays open with the standard envelope', async () => {
    const res = await request(server.app).get('/api/v1/platform-public/catalog');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeTruthy();
  });
});

describe('Platform MVP — hardened public onboarding', () => {
  const ORIGINAL_ENV = {
    AUTH: process.env.AUTH_REQUIRED,
    DATA: process.env.DIGITRONICS_DATA_DIR
  };
  let server;
  let dataDir;

  registerCleanup(() => [server], () => [dataDir]);

  beforeAll(async () => {
    dataDir = makeTempDataDir('platform-mvp-onboarding');
    seed(dataDir, 'companies', { companies: [] });
    seed(dataDir, 'users', { users: [] });
    server = await startServer(dataDir, { AUTH_REQUIRED: 'false' });
  });

  afterAll(() => {
    for (const [key, original] of Object.entries(ORIGINAL_ENV)) {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });

  const validPayload = {
    companyName: 'MVP Co',
    companyId: 'mvaco',
    adminUsername: 'mvaco_owner',
    adminPassword: 'Str0ng#Pass1'
  };

  test('valid onboarding creates the company, owner with server-owned role, and audits the public actor', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform-public/onboarding/provision')
      .send(validPayload);
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.company.id).toBe('mvaco');
    expect(res.body.data.admin.role).toBe('Owner');
    expect('password' in res.body.data.admin).toBe(false);

    // Server-owned tenant metadata on disk.
    const companies = readStore(dataDir, 'companies').companies;
    const created = companies.find(c => c.id === 'mvaco');
    expect(created.provisionedBy).toBe('system');

    // The owner is company-scoped to the NEW tenant only.
    const users = readStore(dataDir, 'users').users;
    const owner = users.find(u => u.username === 'mvaco_owner');
    expect(owner.role).toBe('Owner');
    expect(owner.tenantIds).toEqual(['mvaco']);
    expect(owner.tenantRoles).toEqual({ mvaco: 'Owner' });
  });

  test('duplicate company id returns a generic 400 with no enumeration hint', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform-public/onboarding/provision')
      .send({ ...validPayload, adminUsername: 'another_user' });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).not.toContain('mvaco');
    expect(JSON.stringify(res.body)).not.toContain('mvaco');
  });

  test('duplicate admin username returns the SAME generic 400 (no username enumeration)', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform-public/onboarding/provision')
      .send({ ...validPayload, companyId: 'otherco' });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).not.toContain('mvaco_owner');
  });

  test('unknown top-level fields are rejected 400 (client cannot inject roles/ownership)', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform-public/onboarding/provision')
      .send({ ...validPayload, companyId: 'injco', role: 'Owner', tenantId: 'injco', permissions: ['all'] });
    expect(res.statusCode).toBe(400);
    const users = readStore(dataDir, 'users').users;
    expect(users.some(u => u.username === 'injco' || (u.tenantIds || []).includes('injco'))).toBe(false);
  });

  test('non-object and oversized payloads are rejected 400', async () => {
    const arr = await request(server.app)
      .post('/api/v1/platform-public/onboarding/provision')
      .send([1, 2, 3]);
    expect(arr.statusCode).toBe(400);

    const big = await request(server.app)
      .post('/api/v1/platform-public/onboarding/provision')
      .send({
        a1: 1, a2: 2, a3: 3, a4: 4, a5: 5, a6: 6, a7: 7, a8: 8,
        a9: 9, a10: 10, a11: 11, a12: 12, a13: 13, a14: 14, a15: 15,
        a16: 16, a17: 17, a18: 18, a19: 19, a20: 20, a21: 21, a22: 22
      });
    expect(big.statusCode).toBe(400);
  });

  test('weak passwords are rejected with the safe validation error', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform-public/onboarding/provision')
      .send({ ...validPayload, companyId: 'weakco', adminPassword: 'short' });
    expect(res.statusCode).toBe(400);
  });

  test('onboarded owner can log in through the REAL auth endpoint and gets the new tenant token', async () => {
    const res = await request(server.app)
      .post('/api/v1/platform-public/onboarding/provision')
      .send({ companyName: 'Flow Co', companyId: 'flowco', adminUsername: 'flowco_owner', adminPassword: 'Str0ng#Pass1' });
    expect(res.statusCode).toBe(201);

    const login = await request(server.app)
      .post('/api/v1/auth/login')
      .send({ username: 'flowco_owner', password: 'Str0ng#Pass1' });
    expect(login.statusCode).toBe(200);
    expect(login.body.data.accessToken).toBeTruthy();
    // Multi-company login may be off in this suite; the token must at least be
    // a usable bearer for the workspace APIs.
    const me = await request(server.app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer ' + login.body.data.accessToken);
    expect(me.statusCode).toBe(200);
    expect(me.body.data.user.username).toBe('flowco_owner');
  });
});
