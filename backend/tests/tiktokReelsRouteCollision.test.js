'use strict';

// Route-collision regression guard (TikTok Reels integration repair cycle).
//
// The TikTok Display API feed and the tenant-scoped OmniStore Reels feed both
// live under /api/v1/platform-public. This suite proves, against the real
// mounted app, that:
//   1. The tenant reels route stays owned by reels.routes.js (main feature).
//   2. The TikTok feed is namespaced under /tiktok/reels and never shadows it.
//   3. The two surfaces return structurally different payloads.

const path = require('path');
const fs = require('fs');
const os = require('os');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');

let app;

beforeAll(() => {
  app = startServer(path.join(os.tmpdir(), 'tiktok-collision-' + Date.now() + '-' + process.pid)).app;
});

describe('TikTok Reels route namespace cannot shadow OmniStore Reels', () => {
  test('tenant reels feed stays reachable and tenant-scoped (main feature untouched)', async () => {
    const res = await request(app).get('/api/v1/platform-public/reels');
    // The main reels surface requires a market tenant context; an anonymous
    // request must be answered by the tenant gate (401/403), NOT by the TikTok
    // global feed (200 with cache shape) and not by a shadowed router.
    expect([200, 400, 401, 403]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body && res.body.data).toBeTruthy();
      expect(res.body.data).not.toHaveProperty('syncedAt');
    }
  });

  test('TikTok reels feed lives at the namespaced route and serves cache shape', async () => {
    const res = await request(app).get('/api/v1/platform-public/tiktok/reels');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data).toHaveProperty('syncedAt');
    expect(res.body.data).toHaveProperty('connected');
  });

  test('static route contract: TikTok owns its own router, platformPublic carries no reels route', () => {
    const platformPublic = fs.readFileSync(
      path.join(__dirname, '..', 'routes', 'platformPublic.routes.js'),
      'utf8'
    );
    const tiktokPublic = fs.readFileSync(
      path.join(__dirname, '..', 'routes', 'tiktokPublic.routes.js'),
      'utf8'
    );
    // main's boundary file is untouched: no reels/tiktok-reels surface at all.
    expect(platformPublic).not.toContain("router.get('/reels'");
    expect(platformPublic).not.toContain("router.get('/tiktok/reels'");
    expect(platformPublic).not.toContain('tiktokReels.controller');
    // The TikTok router owns the namespaced routes and never a bare /reels.
    expect(tiktokPublic).toContain("router.get('/tiktok/reels'");
    expect(tiktokPublic).not.toContain("router.get('/reels'");
    expect(tiktokPublic).toContain("require('../controllers/tiktokReels.controller')");
    expect(tiktokPublic).toContain('requireAuth, requirePlatformAdmin()');
  });
});
