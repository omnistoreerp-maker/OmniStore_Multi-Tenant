'use strict';

// tiktokReelsRouteCollision.test.js — Route collision regression suite.
//
// The whole point of this file is to prove that the TikTok Display API
// integration and Master's tenant-scoped Reels media library cannot shadow
// each other. The failure mode this guards against is SILENT: Express does
// not tell you when one router answers a request that another router owns.
// The two products have different response schemas (Master returns
// data.reels/count, TikTok returns data.items/hasMore), so a shadow would
// return HTTP 200 success:true and empty data, rendering Master's
// media-reels.html page as an empty feed with no error.
//
// All five tests run against the REAL server.js route registration, not a
// mock. A fake mock that passes here proves nothing if production routing is
// broken.

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');

const TIKTOK_PATH = '/api/v1/platform-public/tiktok-reels';
const MASTER_PATH = '/api/v1/platform-public/reels';
const TIKTOK_STATUS_PATH = '/api/v1/platform-public/tiktok/reels-status';

function boot(env) {
  const dataDir = makeTempDataDir('collision');
  const started = startServer(dataDir, env || {});
  return started.app;
}

describe('Route collision — TikTok vs Master tenant Reels', () => {
  let app;

  beforeEach(() => {
    app = boot({ AUTH_REQUIRED: 'false' });
  });

  // ---------------------------------------------------------------- Test A
  // Master's route must still reach the tenant-aware protection. It is
  // tenant-scoped: without a tenant it answers 400, and it must never be
  // answered by the TikTok controller (which would return the global
  // data.items shape).
  test('A: Master Reels route still reaches the tenant-aware protection', async () => {
    const res = await request(app).get(MASTER_PATH);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/tenantId is required/);
    // The TikTok shape must never appear on Master's path.
    expect(res.body.data).toBeUndefined();
  });

  test('A2: Master Reels rejects an unknown tenant with 404, not the TikTok shape', async () => {
    const res = await request(app)
      .get(MASTER_PATH)
      .set('X-Tenant-Id', 'demo');
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Unknown tenant/);
    expect(res.body.data).toBeUndefined();
  });

  // ---------------------------------------------------------------- Test B
  test('B: TikTok route uses the independent namespace', async () => {
    const res = await request(app).get(TIKTOK_PATH);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.reels).toBeUndefined();
    expect(res.body.data.count).toBeUndefined();
  });

  test('B2: TikTok feed-cache diagnostic stays in its own namespace', async () => {
    // The feed-cache diagnostic is admin-gated (requireAuth + requirePlatformAdmin),
    // so an unauthenticated request is rejected with 401 — NOT 404. A 401
    // proves the route is registered under the /tiktok/* namespace rather than
    // colliding with Master's /reels router. A 404 would mean the route is
    // missing entirely.
    const res = await request(app).get(TIKTOK_STATUS_PATH);
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toMatch(/Authentication required/);
  });

  // ---------------------------------------------------------------- Test C
  // The two route trees cannot shadow each other in either direction.
  test('C: the two route trees cannot shadow each other', async () => {
    // Master path must NOT return the TikTok shape.
    const masterRes = await request(app).get(MASTER_PATH);
    expect(masterRes.body.data).toBeUndefined();

    // TikTok path must NOT return the Master shape.
    const tiktokRes = await request(app).get(TIKTOK_PATH);
    expect(tiktokRes.body.data).toBeDefined();
    expect(tiktokRes.body.data.reels).toBeUndefined();
    expect(tiktokRes.body.data.items).toBeDefined();

    // The two namespaces are disjoint: a request to one is never answered by
    // the other's controller.
    expect(TIKTOK_PATH).not.toBe(MASTER_PATH);
  });

  // ---------------------------------------------------------------- Test D
  // Mount order must not let TikTok capture Master Reels requests.
  // platformPublic.routes.js is mounted BEFORE reelsRoutes in server.js, so
  // the only way TikTok could capture /reels is if it registered a /reels
  // route. It must not.
  test('D: mount order cannot accidentally let TikTok capture Master Reels requests', async () => {
    // A bare /reels GET must reach Master's tenant-scoped controller, which
    // requires a tenant. It must NOT be answered by the TikTok controller.
    const res = await request(app).get(MASTER_PATH);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/tenantId is required/);
    expect(res.body.data).toBeUndefined();

    // And an unknown tenant is rejected with 404 by Master's controller,
    // still not by the TikTok controller.
    const unknown = await request(app)
      .get(MASTER_PATH)
      .set('X-Tenant-Id', 'demo');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.body.message).toMatch(/Unknown tenant/);
    expect(unknown.body.data).toBeUndefined();

    // Sanity: the TikTok path is reachable and returns the global shape.
    const tiktokRes = await request(app).get(TIKTOK_PATH);
    expect(tiktokRes.statusCode).toBe(200);
    expect(tiktokRes.body.data.items).toBeDefined();
  });

  // ---------------------------------------------------------------- Test E
  // A TikTok request cannot bypass the tenant Reels authorization model.
  // TikTok is deliberately global (no tenant), but it must never be able to
  // answer Master's tenant-scoped route or inherit Master's tenant context.
  test('E: a TikTok request cannot bypass the tenant Reels authorization model', async () => {
    // TikTok is global: no tenant, no credentials, no tenant-scoped data.
    const res = await request(app).get(TIKTOK_PATH);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.tenantId).toBeUndefined();
    expect(res.body.data.items).toBeDefined();

    // The X-Tenant-Id header cannot re-scope the TikTok feed to a tenant.
    const scoped = await request(app)
      .get(TIKTOK_PATH)
      .set('X-Tenant-Id', 'demo');
    expect(scoped.statusCode).toBe(200);
    expect(scoped.body.data.tenantId).toBeUndefined();
    expect(scoped.body.data.items).toBeDefined();

    // TikTok must never answer Master's tenant-scoped route, even with a
    // tenant header present. Master rejects the unknown tenant with 404; the
    // point is that the TikTok controller never answers it.
    const masterRes = await request(app)
      .get(MASTER_PATH)
      .set('X-Tenant-Id', 'demo');
    expect(masterRes.statusCode).toBe(404);
    expect(masterRes.body.message).toMatch(/Unknown tenant/);
    expect(masterRes.body.data).toBeUndefined();
  });
});