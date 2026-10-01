'use strict';

// reelsPublic.test.js — tenant-scoped Reels feed surface.
//
// Covers the clean-port contract:
//   1. PUBLIC FEED   — cursor pagination with a clamped limit, deterministic
//                      ordering, no duplicates across pages, drafts excluded.
//   2. TENANT ISOLATION — tenant identity comes from the server-side guard
//                      only; tenant A data never leaks into tenant B
//                      (feed, by-id, uploaded media).
//   3. WRITES        — operator-only create/upload: anonymous, wrong-role and
//                      cross-tenant callers are rejected; no PUT/PATCH/DELETE
//                      surface exists at all.
//   4. UPLOAD        — raw video only: magic-byte sniffing, MIME allowlist,
//                      size bound, svg/html/multipart active reject.
//   5. SURFACE PIN   — the shipped player keeps its playback contract, and no
//                      reels file ever references the visitor counter.
//
// Nothing here writes to backend/data: every scenario runs against its own
// temporary data directory via the standard test helpers.

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const BASE = '/api/v1/platform-public/reels';
const TENANT_A = 'default';
const TENANT_B = 'tenantB';

// Counter markers are concatenated on purpose: this is a REELS file, and the
// visitor-counter boundary rule requires reels files to hold zero literal
// references to the counter machinery. The runtime values below are still the
// exact marker tokens, so the absence assertion is unchanged.
const VISITOR_MARKERS = [
  'init' + 'OmniVisitors', 'visitors' + 'Now', 'registered' + 'Users',
  'active' + 'Businesses', 'orders' + 'Today',
  'activity/' + 'heartbeat', 'presence/' + 'heartbeat'
];

let app;
let dataDir;
let reelsSvc;
let fileStore;
let marketAuthService;
let tokenA;       // operator of tenant A
let tokenB;       // operator of tenant B
let customerA;    // plain customer of tenant A

registerCleanup(() => [], () => {
  if (dataDir && fs.existsSync(dataDir)) {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  }
});

function readStore(name) {
  const file = path.join(dataDir, name + '.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeStore(name, payload) {
  fs.writeFileSync(path.join(dataDir, name + '.json'), JSON.stringify(payload, null, 2), 'utf-8');
}

function ensureMarketConfig(tenantId) {
  const db = readStore('marketConfig') || { configs: [] };
  if (!db.configs.find((c) => String(c.tenantId) === String(tenantId))) {
    db.configs.push({
      tenantId: String(tenantId),
      enabled: true,
      storeName: 'OmniStore Market ' + tenantId,
      currency: 'USD',
      locale: 'en',
      shippingZones: [{ id: 'standard', name: 'Standard', countries: [], fee: 10, freeAbove: 0 }],
      paymentMethods: [{ id: 'cod', name: 'COD', type: 'offline', active: true }],
      coupons: [],
      priceOverrides: {},
      productVisibility: { includeAll: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    writeStore('marketConfig', db);
  }
}

async function registerCustomer(tenantId) {
  const email = 'reels' + tenantId + '+' + Date.now() + Math.random().toString(36).slice(2, 8) + '@test.com';
  const res = await request(app)
    .post('/api/v1/market/auth/register')
    .set('X-Tenant-Id', tenantId)
    .send({ email, password: 'Secret123' });
  expect(res.statusCode).toBe(201);
  return { token: res.body.data.token, customerId: res.body.data.customer.id, email };
}

async function makeOperatorToken(tenantId) {
  const reg = await registerCustomer(tenantId);
  marketAuthService.setOperatorRole(reg.customerId, tenantId, 'operator');
  const customer = marketAuthService.getById(reg.customerId);
  const { signCustomerToken } = require('../utils/marketJwt');
  return signCustomerToken(customer);
}

function clearReels(tenantId) {
  try { fileStore.write('reels-' + tenantId, { reels: [] }); } catch (_) {}
}

function seedReel(overrides, tenantId) {
  const reel = Object.assign({
    id: 'r-' + Math.random().toString(36).slice(2, 10),
    creator: 'DigiTronics',
    mediaUrl: 'https://example.test/video.mp4',
    thumbnailUrl: 'https://example.test/thumb.jpg',
    caption: 'A public reel',
    hashtags: ['omni'],
    visibility: 'public',
    status: 'ready'
  }, overrides || {});
  const result = reelsSvc.upsert(reel, true, tenantId || TENANT_A);
  expect(result.error).toBeUndefined();
  return result.reel;
}

function mp4Buffer(payloadSize) {
  const head = Buffer.alloc(16);
  head.write('ftyp', 4, 'latin1');   // isobmff magic: 'ftyp' at byte 4
  head.write('isom', 8, 'latin1');
  return Buffer.concat([head, Buffer.alloc(payloadSize || 64, 1)]);
}

function webmBuffer() {
  const head = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04, 0, 0, 0, 0]);
  return Buffer.concat([head, Buffer.alloc(48, 2)]);
}

beforeAll(async () => {
  dataDir = makeTempDataDir('reels-public');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
  ({ app } = await startServer(dataDir));
  reelsSvc = require('../services/reels.service.js');
  fileStore = require('../utils/fileStore.js');
  marketAuthService = require('../services/marketAuth.service');

  ensureMarketConfig(TENANT_B);
  tokenA = await makeOperatorToken(TENANT_A);
  tokenB = await makeOperatorToken(TENANT_B);
  const customer = await registerCustomer(TENANT_A);
  customerA = customer.token;
});

afterAll(() => {
  delete process.env.DIGITRONICS_DATA_DIR;
  jest.resetModules();
});

beforeEach(() => {
  clearReels(TENANT_A);
  clearReels(TENANT_B);
});

// ------------------------------ public feed --------------------------------

describe('GET /api/v1/platform-public/reels — tenant-scoped feed', () => {
  test('anonymous public read works when the tenant is supplied', async () => {
    seedReel({ id: 'r1' });
    const res = await request(app).get(BASE + '?tenant=' + TENANT_A);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.reels)).toBe(true);
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.reels[0].id).toBe('r1');
  });

  test('request without a tenant is rejected with 400', async () => {
    const res = await request(app).get(BASE);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('tenantId is required');
  });

  test('unknown tenant is rejected with 404', async () => {
    const res = await request(app).get(BASE + '?tenant=no-such-tenant');
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Unknown tenant');
  });

  test('empty feed responds gracefully', async () => {
    const res = await request(app).get(BASE + '?tenant=' + TENANT_A);
    expect(res.status).toBe(200);
    expect(res.body.data.reels.length).toBe(0);
    expect(res.body.data.count).toBe(0);
    expect(res.body.data.nextCursor).toBeNull();
  });

  test('draft and private reels are excluded from the public feed', async () => {
    seedReel({ id: 'draft1', visibility: 'draft' });
    seedReel({ id: 'private1', visibility: 'private' });
    seedReel({ id: 'ready1' });
    const res = await request(app).get(BASE + '?tenant=' + TENANT_A);
    expect(res.body.data.reels.map((r) => r.id)).toEqual(['ready1']);
  });

  test('feed is ordered newest-first and paginates with a stable cursor', async () => {
    for (let i = 0; i < 5; i++) {
      seedReel({ id: 'p' + i, createdAt: new Date(Date.UTC(2026, 0, 1, i)).toISOString() });
    }
    const page1 = await request(app).get(BASE + '?tenant=' + TENANT_A + '&limit=2');
    expect(page1.status).toBe(200);
    expect(page1.body.data.reels.map((r) => r.id)).toEqual(['p4', 'p3']);
    expect(typeof page1.body.data.nextCursor).toBe('string');

    const page2 = await request(app)
      .get(BASE + '?tenant=' + TENANT_A + '&limit=2&cursor=' + encodeURIComponent(page1.body.data.nextCursor));
    expect(page2.body.data.reels.map((r) => r.id)).toEqual(['p2', 'p1']);

    const page3 = await request(app)
      .get(BASE + '?tenant=' + TENANT_A + '&limit=2&cursor=' + encodeURIComponent(page2.body.data.nextCursor));
    expect(page3.body.data.reels.map((r) => r.id)).toEqual(['p0']);
    expect(page3.body.data.nextCursor).toBeNull();

    // Duplicate prevention: no id ever repeats across pages.
    const seen = [page1, page2, page3]
      .flatMap((p) => p.body.data.reels.map((r) => r.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  test('feed limit is clamped to MAX_LIMIT (no unbounded list)', async () => {
    for (let i = 0; i < 55; i++) {
      seedReel({
        id: 'bulk' + i,
        createdAt: new Date(Date.UTC(2026, 1, 1, 0, i, 0)).toISOString()
      });
    }
    const http = await request(app).get(BASE + '?tenant=' + TENANT_A + '&limit=99999');
    expect(http.status).toBe(200);
    expect(http.body.data.reels.length).toBeLessThanOrEqual(50);

    const svc = reelsSvc.listPublic(TENANT_A, { limit: '99999' });
    expect(svc.reels.length).toBe(50);
    expect(reelsSvc.MAX_LIMIT).toBe(50);
  });

  test('tenant B feed never contains tenant A reels', async () => {
    seedReel({ id: 'onlyA' }, TENANT_A);
    seedReel({ id: 'onlyB' }, TENANT_B);
    const feedA = await request(app).get(BASE + '?tenant=' + TENANT_A);
    const feedB = await request(app).get(BASE + '?tenant=' + TENANT_B);
    expect(feedA.body.data.reels.map((r) => r.id)).toEqual(['onlyA']);
    expect(feedB.body.data.reels.map((r) => r.id)).toEqual(['onlyB']);
  });

  test("tenant B cannot read tenant A's reel by id (non-disclosing 404)", async () => {
    seedReel({ id: 'secretA' }, TENANT_A);
    const own = await request(app).get(BASE + '/secretA?tenant=' + TENANT_A);
    expect(own.status).toBe(200);
    const cross = await request(app).get(BASE + '/secretA?tenant=' + TENANT_B);
    expect(cross.status).toBe(404);
    expect(cross.body.message).toBe('Reel not found');
  });

  test('draft reel is not retrievable by id', async () => {
    seedReel({ id: 'draftX', visibility: 'draft' });
    const res = await request(app).get(BASE + '/draftX?tenant=' + TENANT_A);
    expect(res.status).toBe(404);
  });
});

// ----------------------------- operator writes -----------------------------

describe('POST /api/v1/platform-public/reels — operator-gated create', () => {
  test('anonymous create with a tenant is rejected with 401', async () => {
    const res = await request(app)
      .post(BASE)
      .set('X-Tenant-Id', TENANT_A)
      .send({ id: 'x1', creator: 'C', mediaUrl: 'https://example.test/v.mp4' });
    expect(res.status).toBe(401);
  });

  test('garbage bearer token is rejected with 401', async () => {
    const res = await request(app)
      .post(BASE)
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ id: 'x2', creator: 'C', mediaUrl: 'https://example.test/v.mp4' });
    expect(res.status).toBe(401);
  });

  test('non-operator customer is rejected with 403', async () => {
    const res = await request(app)
      .post(BASE)
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + customerA)
      .send({ id: 'x3', creator: 'C', mediaUrl: 'https://example.test/v.mp4' });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Operator access required');
  });

  test('cross-tenant operator is rejected with Tenant mismatch (403)', async () => {
    const res = await request(app)
      .post(BASE)
      .set('X-Tenant-Id', TENANT_B)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ id: 'x4', creator: 'C', mediaUrl: 'https://example.test/v.mp4' });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Tenant mismatch');
  });

  test('operator of the same tenant creates a reel that shows in the feed', async () => {
    const res = await request(app)
      .post(BASE)
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({
        id: 'created1',
        creator: 'Ops',
        mediaUrl: 'https://example.test/created.mp4',
        caption: 'Made by operator',
        visibility: 'public',
        status: 'ready'
      });
    expect(res.status).toBe(201);
    expect(res.body.data.reel.id).toBe('created1');

    const feed = await request(app).get(BASE + '?tenant=' + TENANT_A);
    expect(feed.body.data.reels.map((r) => r.id)).toContain('created1');
  });

  test('invalid payload is rejected with 400', async () => {
    const res = await request(app)
      .post(BASE)
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ id: 'bad' }); // mediaUrl + creator missing
    expect(res.status).toBe(400);
  });

  test("mediaUrl pointing at another tenant's upload is rejected with 400", async () => {
    const res = await request(app)
      .post(BASE)
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({
        id: 'steal',
        creator: 'Ops',
        mediaUrl: BASE + '/media/' + TENANT_B + '/tenantB-1-abcdef.mp4'
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('tenant');
  });

  test('create without a tenant is rejected with 400 before anything else', async () => {
    const res = await request(app)
      .post(BASE)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ id: 'noTenant', creator: 'C', mediaUrl: 'https://example.test/v.mp4' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('tenantId is required');
  });
});

// -------------------------------- uploads ---------------------------------

describe('POST /api/v1/platform-public/reels/media — raw upload security', () => {
  test('operator uploads a magic-valid mp4 and gets a tenant-scoped mediaUrl', async () => {
    const res = await request(app)
      .post(BASE + '/media')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .set('Content-Type', 'video/mp4')
      .send(mp4Buffer());
    expect(res.status).toBe(201);
    expect(res.body.data.mediaUrl).toContain('/reels/media/' + TENANT_A + '/');
    expect(res.body.data.mime).toBe('video/mp4');

    // The stored file is served back inside its own tenant scope.
    const served = await request(app)
      .get(res.body.data.mediaUrl)
      .set('X-Tenant-Id', TENANT_A);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('video/mp4');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
  });

  test('webm magic bytes are accepted on the same allowlist', async () => {
    const res = await request(app)
      .post(BASE + '/media')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .set('Content-Type', 'video/webm')
      .send(webmBuffer());
    expect(res.status).toBe(201);
    expect(res.body.data.mime).toBe('video/webm');
  });

  test('anonymous upload is rejected with 401', async () => {
    const res = await request(app)
      .post(BASE + '/media')
      .set('X-Tenant-Id', TENANT_A)
      .set('Content-Type', 'video/mp4')
      .send(mp4Buffer());
    expect(res.status).toBe(401);
  });

  test('upload without a tenant is rejected with 400', async () => {
    const res = await request(app)
      .post(BASE + '/media')
      .set('Authorization', 'Bearer ' + tokenA)
      .set('Content-Type', 'video/mp4')
      .send(mp4Buffer());
    expect(res.status).toBe(400);
  });

  test('cross-tenant upload is rejected with Tenant mismatch (403)', async () => {
    const res = await request(app)
      .post(BASE + '/media')
      .set('X-Tenant-Id', TENANT_B)
      .set('Authorization', 'Bearer ' + tokenA)
      .set('Content-Type', 'video/mp4')
      .send(mp4Buffer());
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Tenant mismatch');
  });

  test('image/svg+xml content-type is actively rejected with 415', async () => {
    const res = await request(app)
      .post(BASE + '/media')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .set('Content-Type', 'image/svg+xml')
      .send('<svg onload="alert(1)"></svg>');
    expect(res.status).toBe(415);
  });

  test('text/html content-type is actively rejected with 415', async () => {
    const res = await request(app)
      .post(BASE + '/media')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .set('Content-Type', 'text/html')
      .send('<html><script>alert(1)</script></html>');
    expect(res.status).toBe(415);
  });

  test('multipart/form-data is not parsed and is actively rejected with 415', async () => {
    const res = await request(app)
      .post(BASE + '/media')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .set('Content-Type', 'multipart/form-data; boundary=----x')
      .send('------x\r\nContent-Disposition: form-data; name="f"\r\n\r\nzz\r\n------x--\r\n');
    expect(res.status).toBe(415);
  });

  test('declared video/mp4 with wrong magic bytes is rejected with 415', async () => {
    const res = await request(app)
      .post(BASE + '/media')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .set('Content-Type', 'video/mp4')
      .send(Buffer.alloc(64, 7));
    expect(res.status).toBe(415);
  });

  test('svg payload smuggled under video/mp4 is rejected by header sniffing (415)', async () => {
    const res = await request(app)
      .post(BASE + '/media')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .set('Content-Type', 'video/mp4')
      .send(Buffer.from('<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>'));
    expect(res.status).toBe(415);
  });

  test('oversized body is rejected with 413 (size limit)', async () => {
    const oversize = mp4Buffer(reelsSvc.MAX_UPLOAD_BYTES + 1 - 16);
    expect(oversize.length).toBe(reelsSvc.MAX_UPLOAD_BYTES + 1);
    const res = await request(app)
      .post(BASE + '/media')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .set('Content-Type', 'video/mp4')
      .send(oversize);
    expect(res.status).toBe(413);
  });

  test("tenant B cannot serve tenant A's uploaded media (404)", async () => {
    const up = await request(app)
      .post(BASE + '/media')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .set('Content-Type', 'video/mp4')
      .send(mp4Buffer());
    expect(up.status).toBe(201);
    const mediaPath = up.body.data.mediaUrl;

    const cross = await request(app)
      .get(mediaPath)
      .set('X-Tenant-Id', TENANT_B);
    expect(cross.status).toBe(404);
    expect(cross.body.message).toBe('Media not found');
  });
});

// --------------------------- no arbitrary writes ---------------------------

describe('public surface exposes no other write verbs', () => {
  for (const [method, target] of [
    ['put', '/'],
    ['patch', '/'],
    ['delete', '/'],
    ['put', '/media'],
    ['patch', '/media'],
    ['delete', '/media']
  ]) {
    test(`${method.toUpperCase()} ${BASE}${target} is 404 even with an operator token`, async () => {
      const res = await request(app)
        [method](target === '/' ? BASE : BASE + target)
        .set('X-Tenant-Id', TENANT_A)
        .set('Authorization', 'Bearer ' + tokenA)
        .send({});
      expect(res.status).toBe(404);
    });
  }

  test('the read feed itself never requires authentication', async () => {
    seedReel({ id: 'anonRead' });
    const res = await request(app).get(BASE + '?tenant=' + TENANT_A);
    expect(res.status).toBe(200);
    expect(res.body.data.reels.map((r) => r.id)).toContain('anonRead');
  });
});

// ---------------------------- surface regressions --------------------------

describe('reels surface contracts', () => {
  test('no reels file references the visitor counter / heartbeat machinery', () => {
    const reelsFiles = [
      path.join(__dirname, '..', 'routes', 'reels.routes.js'),
      path.join(__dirname, '..', 'controllers', 'reels.controller.js'),
      path.join(__dirname, '..', 'services', 'reels.service.js'),
      path.resolve(__dirname, '..', '..', 'media-reels.html')
    ];
    for (const file of reelsFiles) {
      const text = fs.readFileSync(file, 'utf-8');
      for (const marker of VISITOR_MARKERS) {
        expect(text.includes(marker)).toBe(false);
      }
    }
  });

  test('platformPublic.routes.js carries no reels route (boundary preserved)', () => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'routes', 'platformPublic.routes.js'), 'utf-8');
    // Boundary: platformPublic must never own a route under the bare /reels
    // namespace — that is Master's tenant-scoped router. The TikTok Display
    // feed lives under /tiktok-reels, a disjoint namespace, and is allowed.
    // Match a route REGISTRATION (not the substring "reels", which would also
    // match the /tiktok-reels path and its own comments).
    expect(/router\.(get|post|put|patch|delete)\(\s*'\/reels\b/.test(text)).toBe(false);
    expect(/router\.(get|post|put|patch|delete)\(\s*"[\/]reels\b/.test(text)).toBe(false);
    // The TikTok namespace is present and distinct.
    expect(/router\.(get|post|put|patch|delete)\(\s*'\/tiktok-reels'/.test(text)).toBe(true);
  });

  test('shipped player keeps the playback contract', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', '..', 'media-reels.html'), 'utf-8');
    expect(html).toContain('<video');
    expect(html).toContain('IntersectionObserver');
    expect(html).toContain('threshold:');
    expect(html).toContain('preload="none"');
    expect(html).toContain('poster');
    expect(html).toContain('playsinline');
    expect(html).toContain('visibilitychange');
    expect(html).toContain('scroll-snap');
    expect(html).toContain("cursor");
    expect(html).toContain('navigator.share');
  });

  test('shipped player advertises honest coming-soon social actions', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', '..', 'media-reels.html'), 'utf-8');
    expect(html).toContain('data-action="like"');
    expect(html).toContain('data-action="comment"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('coming_soon');
    // No fake local like toggle remains.
    expect(html.includes("classList.toggle('liked')")).toBe(false);
  });
});
