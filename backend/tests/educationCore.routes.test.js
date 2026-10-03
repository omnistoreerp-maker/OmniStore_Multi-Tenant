'use strict';

// API-level proof that the Education Core routes are really mounted under
// /api/v1/tenant/education and that they refuse to operate without a
// server-side tenant context (the tenant is never supplied by the client).
const request = require('supertest');
const { startServer } = require('./helpers/testServer');

describe('education API routing', () => {
  let app;

  beforeAll(() => {
    app = startServer(undefined, { AUTH_REQUIRED: 'false' }).app;
  });

  test('dashboard is mounted and requires a tenant context', async () => {
    const res = await request(app).get('/api/v1/tenant/education/dashboard');
    expect(res.status).toBe(400);
    expect(String(res.body.message || '')).toMatch(/Tenant context is required/i);
  });

  test('reads are mounted for every core collection', async () => {
    for (const path of ['/centers', '/teachers', '/students', '/courses', '/enrollments']) {
      const res = await request(app).get('/api/v1/tenant/education' + path);
      expect(res.status).toBe(400);
      expect(String(res.body.message || '')).toMatch(/Tenant context is required/i);
    }
  });

  test('writes without a tenant context are rejected (no silent success)', async () => {
    const res = await request(app).post('/api/v1/tenant/education/centers').send({ name: 'X' });
    expect(res.status).toBe(400);
    expect(String(res.body.message || '')).toMatch(/Tenant context is required/i);
  });

  test('client-supplied tenantId is rejected even when present in the body', async () => {
    const res = await request(app)
      .post('/api/v1/tenant/education/centers')
      .send({ name: 'X', tenantId: 'sneaky' });
    expect(res.status).toBe(400);
    expect(String(res.body.message || '')).toMatch(/Tenant context is required/i);
  });

  test('unknown education sub-routes return 404', async () => {
    const res = await request(app).get('/api/v1/tenant/education/does-not-exist');
    expect(res.status).toBe(404);
  });
});
