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
// Known shipped limitation that IS fixed here: the profile fetch used to run
// every response through JSON.parse and then stringify the PARSED OBJECT
// (String(result.data) → "[object Object]"/"null"), never the raw text, so
// _extractVideoUrls could never match a video URL from any upstream shape and
// the scrape path always degraded to the fallback embed. The service now
// extracts from the raw response text (the TikTok profile page embeds the
// video URLs inline), while the fallback path is preserved unchanged for
// genuinely unreachable/empty profiles. Callers still see { embeds, cache }.
//
// The TikTok handle comes from process.env.TIKTOK_USERNAME with the original
// placeholder default (operator sets the env; no config schema change).
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
let realUsername;
let nowValue = BASE;

registerCleanup(() => [server], () => [dataDir]);

function advancePastTtl() {
  nowValue += TTL_MS + 60 * 1000;
}

beforeAll(async () => {
  realUsername = process.env.TIKTOK_USERNAME;
  process.env.TIKTOK_USERNAME = 'digitronics';
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
  if (realUsername === undefined) delete process.env.TIKTOK_USERNAME; else process.env.TIKTOK_USERNAME = realUsername;
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

  test('a real HTML profile page with inline video URLs yields normalized embeds', async () => {
    advancePastTtl();
    const makeVideoUrl = (id) => 'https://www.tiktok.com/@digitronics/video/' + id;
    let oembedCalls = 0;
    global.fetch = async (url) => {
      if (String(url).startsWith('https://www.tiktok.com/oembed')) {
        oembedCalls += 1;
        const vid = decodeURIComponent(String(url)).match(/video\/(\d+)/)[1];
        return { ok: true, status: 200, text: async () => JSON.stringify({
          author_name: 'DigiTronics', title: 'Reel ' + vid, thumbnail_url: 'https://img.example/' + vid + '.jpg',
          html: '<blockquote data-video="' + vid + '"></blockquote>', width: 325, height: 580
        }) };
      }
      // Realistic TikTok profile HTML: video URLs embedded inline in the page.
      const html = [111, 222, 333, 444, 555, 666, 777].map((id) => '<a href="' + makeVideoUrl(id) + '">v</a>').join('');
      return { ok: true, status: 200, text: async () => html };
    };
    const res = await getFeed();
    expect(res.statusCode).toBe(200);
    const embeds = res.body.data.embeds;
    expect(embeds.length).toBe(6); // MAX_EMBEDS cap
    expect(embeds[0].url).toBe(makeVideoUrl(111));
    expect(embeds[0].author_name).toBe('DigiTronics');
    expect(embeds[0].title).toBe('Reel 111');
    expect(embeds[0].thumbnail).toBe('https://img.example/111.jpg');
    expect(embeds[0].embed_html).toBe('<blockquote data-video="111"></blockquote>');
    expect(embeds[0].fallback).toBeUndefined();
    expect(oembedCalls).toBe(6);
  });

  test('any unparseable upstream shape still degrades to the fallback embed', async () => {
    advancePastTtl();
    global.fetch = async () => ({ ok: true, status: 200, text: async () => '<html>no videos here</html>' });
    const res = await getFeed();
    expect(res.statusCode).toBe(200);
    const embeds = res.body.data.embeds;
    expect(embeds.length).toBe(1);
    expect(embeds[0].fallback).toBe(true);
    expect(embeds[0].url).toContain('https://www.tiktok.com/@digitronics');
  });
});
