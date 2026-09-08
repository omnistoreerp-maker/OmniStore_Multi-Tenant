'use strict';

const request = require('supertest');
const fs = require('fs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');

const tempDirs = [];

function seedProfile(dir) {
  seed(dir, 'companyProfile', {
    profiles: [
      {
        companyId: 'digi',
        identity: {
          displayName: 'DigiTronics',
          legalName: 'DigiTronics LLC',
          slug: 'digitronics',
          logo: { url: '', alt: '' },
          coverImage: { url: '', alt: '' },
          shortDescription: 'Electronics retail',
          fullDescription: 'A full electronics retailer.',
          category: 'Electronics',
          status: 'ACTIVE'
        },
        contact: {
          phone: '+1234567890',
          email: 'info@digi.test',
          website: 'https://digi.test',
          address: '123 Main St',
          city: 'Cairo',
          region: 'Cairo',
          workingHours: '9-5'
        },
        products: [],
        services: [],
        offers: [],
        media: [],
        socialChannels: [],
        lastUpdated: new Date().toISOString()
      }
    ],
    lastUpdated: new Date().toISOString()
  });
}

describe('GET /api/v1/companies-public', () => {
  let server;
  let dir;

  beforeAll(async () => {
    jest.resetModules();
    process.env.AUTH_REQUIRED = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';
    dir = makeTempDataDir('companyProfile');
    tempDirs.push(dir);
    seedProfile(dir);
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    server = s.app;
  });

  afterAll(() => {
    tempDirs.forEach(d => {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
    });
  });

  // ---------- happy path ----------
  test('1: GET /digi/profile returns 200 with expected shape', async () => {
    const res = await request(server).get('/api/v1/companies-public/digi/profile');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.companyId).toBe('digi');
    expect(res.body.data.identity.displayName).toBe('DigiTronics');
    expect(res.body.data).toHaveProperty('contact');
    expect(res.body.data).toHaveProperty('products');
    expect(res.body.data).toHaveProperty('services');
    expect(res.body.data).toHaveProperty('offers');
    expect(res.body.data).toHaveProperty('media');
    expect(res.body.data).toHaveProperty('socialChannels');
  });

  test('2: GET section returns only that section', async () => {
    const res = await request(server).get('/api/v1/companies-public/digi/profile/contact');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('contact');
    expect(res.body.data.contact.phone).toBe('+1234567890');
  });

  // ---------- 404 / error cases ----------
  test('3: GET /nonexistent/profile returns 404', async () => {
    const res = await request(server).get('/api/v1/companies-public/nonexistent/profile');
    expect(res.status).toBe(404);
  });

  test('4: GET invalid section returns 404', async () => {
    const res = await request(server).get('/api/v1/companies-public/digi/profile/secret');
    expect([404, 400]).toContain(res.status);
  });

  // ---------- method restrictions ----------
  test('5: POST /digi/profile returns 404', async () => {
    const res = await request(server).post('/api/v1/companies-public/digi/profile').send({});
    expect(res.status).toBe(404);
  });

  test('6: PUT /digi/profile returns 404', async () => {
    const res = await request(server).put('/api/v1/companies-public/digi/profile').send({});
    expect(res.status).toBe(404);
  });

  test('7: DELETE /digi/profile returns 404', async () => {
    const res = await request(server).delete('/api/v1/companies-public/digi/profile');
    expect(res.status).toBe(404);
  });

  test('8: PATCH /digi/profile returns 404', async () => {
    const res = await request(server).patch('/api/v1/companies-public/digi/profile').send({});
    expect(res.status).toBe(404);
  });

  test('9: POST section returns 404', async () => {
    const res = await request(server).post('/api/v1/companies-public/digi/profile/contact').send({});
    expect(res.status).toBe(404);
  });

  test('10: DELETE section returns 404', async () => {
    const res = await request(server).delete('/api/v1/companies-public/digi/profile/contact');
    expect(res.status).toBe(404);
  });

  // ---------- no secret leakage ----------
  test('11: response contains no secret keywords', async () => {
    const res = await request(server).get('/api/v1/companies-public/digi/profile');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('JWT');
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('password');
    expect(raw).not.toContain('token');
  });

  // ---------- client-controlled tenant identity is ignored ----------
  test('12: X-Tenant-Id header does not affect response', async () => {
    const res = await request(server)
      .get('/api/v1/companies-public/digi/profile')
      .set('X-Tenant-Id', 'evil-tenant');
    expect(res.status).toBe(200);
    expect(res.body.data.companyId).toBe('digi');
  });

  test('13: X-Company-Id header does not override URL companyId', async () => {
    const res = await request(server)
      .get('/api/v1/companies-public/digi/profile')
      .set('X-Company-Id', 'evil');
    expect(res.status).toBe(200);
    expect(res.body.data.companyId).toBe('digi');
  });

  test('14: query param tenant does not affect response', async () => {
    const res = await request(server).get('/api/v1/companies-public/digi/profile?tenant=evil');
    expect(res.status).toBe(200);
    expect(res.body.data.companyId).toBe('digi');
  });

  test('15: body tenant does not affect GET response', async () => {
    const res = await request(server)
      .get('/api/v1/companies-public/digi/profile')
      .send({ tenantId: 'evil' });
    expect(res.status).toBe(200);
    expect(res.body.data.companyId).toBe('digi');
  });

  // ---------- prototype pollution / malicious payloads ----------
  test('16: prototype pollution in URL does not crash server', async () => {
    const res = await request(server).get('/api/v1/companies-public/__proto__/profile');
    expect([404, 400]).toContain(res.status);
  });

  test('17: constructor in URL does not crash server', async () => {
    const res = await request(server).get('/api/v1/companies-public/constructor/profile');
    expect([404, 400]).toContain(res.status);
  });

  test('18: very long companyId does not crash server', async () => {
    const longId = 'a'.repeat(2000);
    const res = await request(server).get('/api/v1/companies-public/' + longId + '/profile');
    expect(res.status).toBe(404);
  });

  // ---------- empty / missing data ----------
  test('19: profile has empty arrays for products/services/offers/media/socialChannels', async () => {
    const res = await request(server).get('/api/v1/companies-public/digi/profile');
    expect(Array.isArray(res.body.data.products)).toBe(true);
    expect(Array.isArray(res.body.data.services)).toBe(true);
    expect(Array.isArray(res.body.data.offers)).toBe(true);
    expect(Array.isArray(res.body.data.media)).toBe(true);
    expect(Array.isArray(res.body.data.socialChannels)).toBe(true);
  });

  // ---------- response envelope ----------
  test('20: response envelope has standard shape', async () => {
    const res = await request(server).get('/api/v1/companies-public/digi/profile');
    expect(res.body).toHaveProperty('success');
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('time');
    expect(typeof res.body.time).toBe('string');
  });

  // ---------- rate limiter headers ----------
  test('21: rate limiter headers present', async () => {
    const res = await request(server).get('/api/v1/companies-public/digi/profile');
    const hasLimit = res.headers['ratelimit-limit'] || res.headers['X-RateLimit-Limit'];
    expect(hasLimit).toBeTruthy();
  });

  // ---------- no auth required ----------
  test('22: anonymous access works (no token)', async () => {
    const res = await request(server).get('/api/v1/companies-public/digi/profile');
    expect(res.status).toBe(200);
  });

  // ---------- companyId with special chars ----------
  test('23: companyId with dots is handled', async () => {
    const res = await request(server).get('/api/v1/companies-public/digi.test/profile');
    expect([404, 400]).toContain(res.status);
  });

  // ---------- no private ERP fields exposed ----------
  test('24: response does not include password, hash, or token fields', async () => {
    const res = await request(server).get('/api/v1/companies-public/digi/profile');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('$2');
    expect(raw).not.toContain('bcrypt');
    expect(raw).not.toContain('hash');
    expect(raw).not.toContain('accessToken');
    expect(raw).not.toContain('refreshToken');
  });
});
