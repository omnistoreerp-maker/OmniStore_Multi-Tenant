'use strict';

// platformActivity.test.js — Platform Activity (Phase 3) heartbeat hardening.
//
// The public heartbeat endpoint accepts anonymous visitor tokens, so the
// service must:
//   - reject visitor ids that are too short/long or carry unexpected content
//     (emails, URLs, control chars) — no PII ever persisted;
//   - cap the visitor table so flooding unique ids cannot grow the store
//     unboundedly within the 24h TTL;
//   - keep stats aggregate-only (no visitor identifiers in responses).

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const tempDirs = [];

function loadService(dataDir) {
  jest.resetModules();
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  process.env.JWT_SECRET = 'test-jwt-secret-for-jest-suites';
  return require('../services/platformActivity.service');
}

describe('platformActivity service — visitorId validation', () => {
  let dataDir;
  let service;

  beforeEach(() => {
    dataDir = makeTempDataDir('platform-activity');
    tempDirs.push(dataDir);
    service = loadService(dataDir);
  });

  const valid = ['v_test_001', 'visitor-abc123', 'ABCDEF01', 'a'.repeat(64), 'v_1234-AB_cd56'];
  test.each(valid)('accepts well-formed anonymous id %j', (id) => {
    expect(service.heartbeat(id)).toEqual({ ok: true });
  });

  test.each([
    ['', 'empty'],
    [null, 'null'],
    [undefined, 'undefined'],
    ['abc', 'too short'],
    ['a'.repeat(65), 'too long'],
    ['user@mail.com', 'email as id'],
    ['https://evil.example/x', 'url as id'],
    ['has space', 'whitespace inside'],
    ['<script>1a</script>', 'html injection'],
    ['{}json{}1', 'braces'],
    ['١٢٣٤٥٦٧٨', 'non-ascii digits']
  ])('rejects %s (%s)', (id) => {
    const result = service.heartbeat(id);
    expect(result.error).toMatch(/visitorId/);
  });

  test('rejected ids are never persisted to the store', () => {
    service.heartbeat('bad id with spaces!');
    const store = readStore(dataDir, 'platformActivity');
    const visitors = (store && store.visitors) || [];
    expect(visitors).toHaveLength(0);
  });

  test('same visitor id is deduplicated (update, not append)', () => {
    service.heartbeat('visitor-dedupe');
    service.heartbeat('visitor-dedupe');
    const store = readStore(dataDir, 'platformActivity');
    expect((store.visitors || []).filter((v) => v.id === 'visitor-dedupe')).toHaveLength(1);
  });

  test('visitor table is capped: new ids are rejected once the cap is hit', () => {
    const svc = loadService(dataDir);
    // Fill the store file directly to the documented cap, then confirm the
    // service refuses NEW ids (existing ids keep refreshing their heartbeat).
    const storePath = path.join(dataDir, 'platformActivity.json');
    const visitors = [];
    for (let i = 0; i < svc.MAX_VISITORS; i++) {
      visitors.push({ id: 'v' + String(i).padStart(8, '0'), lastSeenAt: new Date().toISOString() });
    }
    fs.writeFileSync(storePath, JSON.stringify({ visitors }, null, 2), 'utf-8');

    // An id already in the capped store keeps refreshing its heartbeat…
    expect(svc.heartbeat('v00000000')).toEqual({ ok: true });
    // …while brand-new ids are rejected until the TTL frees space.
    const blocked = svc.heartbeat('brand-new-visitor-1');
    expect(blocked.error).toMatch(/visitor limit/);
  });
});

describe('platformActivity HTTP — public heartbeat stays usable and clean', () => {
  let server;
  let dataDir;

  beforeAll(async () => {
    dataDir = makeTempDataDir('platform-activity-http');
    tempDirs.push(dataDir);
    seed(dataDir, 'companies', { companies: [{ id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true, status: 'ACTIVE', branches: [] }] });
    server = await startServer(dataDir, { RATE_LIMIT_MAX: '10000' });
  });

  test('valid heartbeat accepted, malformed rejected with 400', async () => {
    const good = await request(server.app)
      .post('/api/v1/platform-public/activity/heartbeat')
      .send({ visitorId: 'v_http_valid_1' });
    expect(good.status).toBe(200);

    const bad = await request(server.app)
      .post('/api/v1/platform-public/activity/heartbeat')
      .send({ visitorId: 'not a valid id!' });
    expect(bad.status).toBe(400);

    const email = await request(server.app)
      .post('/api/v1/platform-public/activity/heartbeat')
      .send({ visitorId: 'someone@example.com' });
    expect(email.status).toBe(400);
  });

  test('stats stay aggregate-only after heartbeats (no PII, ordersToday honest null)', async () => {
    await request(server.app)
      .post('/api/v1/platform-public/activity/heartbeat')
      .send({ visitorId: 'v_stats_clean_1' });

    const res = await request(server.app).get('/api/v1/platform-public/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.visitorsNow).toBeGreaterThanOrEqual(1);
    const raw = JSON.stringify(res.body.data);
    expect(raw).not.toContain('v_stats_clean_1');
    expect(raw).not.toContain('visitorId');
    expect(res.body.data.ordersToday).toBeNull();
  });
});

registerCleanup(() => [], () => tempDirs);
