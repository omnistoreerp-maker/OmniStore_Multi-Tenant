'use strict';

// API-level proof that the Education routes are really mounted under
// /api/v1/tenant/education and that they fail CLOSED for anonymous traffic.
//
// The mounted routers guard every surface with the strict `requirePermission`
// gate (backend/middleware/authorize.js), which answers 401 whenever no signed
// user is present — regardless of AUTH_REQUIRED. The tenant itself is resolved
// server-side from the signed token claim / reconstructed tenant context and is
// never accepted from a query, body or header vector.
const request = require('supertest');
const { startServer } = require('./helpers/testServer');

const BASE = '/api/v1/tenant/education';

describe('education API routing', () => {
  let app;

  beforeAll(() => {
    app = startServer(undefined, { AUTH_REQUIRED: 'false' }).app;
  });

  test('anonymous reads are refused with 401 on every mounted collection', async () => {
    const paths = ['/centers', '/teachers', '/students', '/courses', '/classes', '/enrollments', '/pack', '/capabilities'];
    for (const path of paths) {
      const res = await request(app).get(BASE + path);
      expect(res.status).toBe(401);
      expect(String(res.body.message || '')).toMatch(/Authentication required/i);
    }
  });

  test('anonymous writes are refused with 401 (no silent success)', async () => {
    const res = await request(app).post(BASE + '/centers').send({ name: 'X' });
    expect(res.status).toBe(401);
    expect(String(res.body.message || '')).toMatch(/Authentication required/i);
  });

  test('a client-supplied tenantId in the body never authenticates the request', async () => {
    const res = await request(app)
      .post(BASE + '/centers')
      .send({ name: 'X', tenantId: 'sneaky' });
    expect(res.status).toBe(401);
    expect(String(res.body.message || '')).toMatch(/Authentication required/i);
  });

  test('a client-supplied tenantId in a header never authenticates the request', async () => {
    const res = await request(app)
      .get(BASE + '/centers')
      .set('X-Tenant-Id', 'sneaky');
    expect(res.status).toBe(401);
    expect(String(res.body.message || '')).toMatch(/Authentication required/i);
  });

  test('unknown education sub-routes return 404', async () => {
    const res = await request(app).get(BASE + '/does-not-exist');
    expect(res.status).toBe(404);
  });
});
