'use strict';

// tiktokFeed.test.js — public TikTok feed endpoint (Media/Reels surface).
//
// The service is RC-parity on main and mounted at
// GET /api/v1/platform-public/social-feed/tiktok, but had zero coverage.
// These tests pin the shipped contract without network access:
//   - the endpoint always answers 200 (never 500) with an { embeds, cache }
//     payload, even when the upstream is offline or returns garbage/HTML
//   - when no embeds can be extracted the service degrades to a single
//     fallback embed pointing at the configured profile URL
//   - responses within the 1h TTL are served from cache (one upstream hit)
//
// Known shipped limitation (pinned here, not changed silently): the profile
// fetch runs every response through JSON.parse and then stringifies the
// PARSED OBJECT (String(result.data) → "[object Object]"/"null"), never the
// raw text, so _extractVideoUrls can never match a video URL from any
// upstream shape. The scrape path therefore always degrades to the fallback
// embed. Callers must tolerate the fallback shape.
//
// Determinism: the service memoizes in module state with a 1h TTL, so every
// test drives an explicit fake clock (jest.spyOn(Date, 'now')) and advances
// past the TTL before asserting fresh-fetch behavior. global.fetch is
// replaced so tests never touch tiktok.com.

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const TTL_MS = 60 * 60 * 1000;
const BASE = 1_000_000_000_000;

let server;
let dataDir;
let realFetch;
let nowValue = BASE;

registerCleanup(() => [server], () => [dataDir]);

function advancePastTtl() {
  nowValue += TTL_MS + 60 * 1000;
}

beforeAll(async () => {
  dataDir = makeTempDataDir('tiktok-feed');
  server = await startServer(dataDir);
  realFetch = global.fetch;
  jest.spyOn(Date, 'now').mockImplementation(() => nowValue);
});

beforeEach(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => nowValue);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(Date, 'now').mockImplementation(() => nowValue);
});

afterAll(() => {
  global.fetch = realFetch;
});

const getFeed = () => request(server.app).get('/api/v1/platform-public/social-feed/tiktok');

describe('GET /api/v1/platform-public/social-feed/tiktok', () => {
  test('degrades to the fallback embed when the profile page is not JSON', async () => {
    advancePastTtl();
    let calls = 0;
    global.fetch = async () => { calls += 1; return { ok: true, status: 200, text: async () => '<html>profile page</html>' }; };
    const res = await getFeed();
    expect(res.statusCode).toBe(200);
    const embeds = res.body.data.embeds;
    expect(Array.isArray(embeds)).toBe(true);
    expect(embeds.length).toBe(1);
    expect(embeds[0].fallback).toBe(true);
    expect(embeds[0].url).toContain('https://www.tiktok.com/@');
    expect(calls).toBe(1);
    expect(res.body.data.cache.ttlMs).toBe(TTL_MS);
    expect(res.body.data.cache.cachedAt).toBe(new Date(nowValue).toISOString());
    expect(res.body.data.cache.stale).toBe(false);
  });

  test('serves within-TTL calls from cache (single upstream hit)', async () => {
    advancePastTtl();
    let calls = 0;
    global.fetch = async () => { calls += 1; return { ok: true, status: 200, text: async () => 'garbage' }; };
    const fresh = await getFeed();
    expect(fresh.statusCode).toBe(200);
    expect(calls).toBe(1);

    nowValue += 5 * 60 * 1000; // still inside the TTL
    const cached = await getFeed();
    expect(cached.statusCode).toBe(200);
    expect(calls).toBe(1);
    expect(cached.body.data.embeds).toEqual(fresh.body.data.embeds);
    expect(cached.body.data.cache.ageMs).toBe(5 * 60 * 1000);
  });

  test('returns 200 with the fallback embed when the upstream is unreachable', async () => {
    advancePastTtl();
    global.fetch = async () => { throw new Error('network disabled in tests'); };
    const res = await getFeed();
    expect(res.statusCode).toBe(200);
    expect(res.body.data.embeds.length).toBe(1);
    expect(res.body.data.embeds[0].fallback).toBe(true);
    expect(typeof res.body.data.cache.stale).toBe('boolean');
  });

  test('any upstream response shape degrades to the fallback embed (JSON profile included)', async () => {
    advancePastTtl();
    const videoUrl = 'https://www.tiktok.com/@digitronics/video/1234567890';
    global.fetch = async (url) => {
      if (String(url).startsWith('https://www.tiktok.com/oembed')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({
          author_name: 'DigiTronics', title: 'New reel', html: '<blockquote></blockquote>'
        }) };
      }
      // Even a JSON profile body containing a real video URL degrades: the
      // extractor receives the stringified parsed object, not raw text.
      return { ok: true, status: 200, text: async () => JSON.stringify({ html: '<a href="' + videoUrl + '">v</a>' }) };
    };
    const res = await getFeed();
    expect(res.statusCode).toBe(200);
    const embeds = res.body.data.embeds;
    expect(embeds.length).toBe(1);
    expect(embeds[0].fallback).toBe(true);
    expect(embeds[0].url).toContain('https://www.tiktok.com/@');
  });
});
