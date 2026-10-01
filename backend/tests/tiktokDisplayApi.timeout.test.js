'use strict';

// tiktokDisplayApi.timeout.test.js — Outbound request hardening.
//
// The TikTok Display API client must never pin a request indefinitely. A hung
// upstream, a black-hole edge, or a DNS stall must surface as a bounded
// network_error instead of leaking into the caller or blocking the sync path.
//
// This suite replaces global.fetch with controlled stubs and exercises the
// service directly. No real network is touched; the data directory is a temp
// dir and no credential is used.

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');

let config;
let connection;
let displayApi;

function jsonResponse(body, status) {
  return {
    ok: status === undefined || (status >= 200 && status < 300),
    status: status || 200,
    text: async () => JSON.stringify(body)
  };
}

describe('TikTok Display API — outbound request hardening', () => {
  let realFetch;
  let dataDir;
  let app;

  beforeEach(() => {
    realFetch = global.fetch;
    jest.resetModules();
    dataDir = makeTempDataDir('tiktok-timeout');
    process.env.DIGITRONICS_DATA_DIR = dataDir;
    process.env.NODE_ENV = 'test';
    process.env.TIKTOK_CLIENT_KEY = 'test-key';
    process.env.TIKTOK_CLIENT_SECRET = 'test-secret';
    process.env.TIKTOK_REDIRECT_URI = 'https://app.omnistoreerp.com/tiktok/callback';
    const started = startServer(dataDir, {});
    app = started.app;
    // Re-require after resetModules so the service sees the same app modules.
    config = require('../config/tiktok');
    connection = require('../services/tiktokConnection.service');
    displayApi = require('../services/tiktokDisplayApi.service');
    connection.saveConnection({ access_token: 'a1', refresh_token: 'r1', expires_in: 86400 }, null);
    displayApi._resetRateBudget();
  });

  afterEach(() => {
    global.fetch = realFetch;
    try { require('fs').rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('every outbound call carries an AbortSignal timeout', async () => {
    global.fetch = jest.fn(async (url, init) => {
      expect(init && init.signal).toBeInstanceOf(AbortSignal);
      expect(typeof init.signal.throwIfAborted).toBe('function');
      return jsonResponse({ data: { videos: [], cursor: 0, has_more: false }, error: { code: 'ok' } });
    });

    await displayApi.listVideos({ maxCount: 5 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);

    global.fetch.mockClear();
    await displayApi.getAuthorizedAccount();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  test('a network failure on /v2/user/info/ returns a bounded network_error', async () => {
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    const result = await displayApi.getAuthorizedAccount();
    expect(result.ok).toBe(false);
    expect(result.code).toBe('network_error');
    expect(result.message).toBe('Could not reach TikTok');
  });

  test('a network failure on /v2/video/list/ returns a bounded network_error', async () => {
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    const result = await displayApi.listVideos({ maxCount: 5 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('network_error');
    expect(result.items).toEqual([]);
    expect(result.cursor).toBeNull();
    expect(result.hasMore).toBe(false);
  });

  test('a non-JSON upstream body is handled without throwing', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => 'not json' }));
    const result = await displayApi.listVideos({ maxCount: 5 });
    // The service fails closed on a non-JSON body rather than throwing, so the
    // caller gets a bounded failure instead of an unhandled exception.
    expect(result.ok).toBe(false);
    expect(result.code).toBe('http_200');
    expect(result.items).toBeUndefined();
  });

  test('an HTTP 429 is surfaced as rateLimited, not as a thrown exception', async () => {
    global.fetch = jest.fn(async () => jsonResponse(
      { error: { code: 'rate_limit_exceeded', message: 'slow down' } }, 429
    ));
    const result = await displayApi.listVideos({ maxCount: 5 });
    expect(result.ok).toBe(false);
    expect(result.rateLimited).toBe(true);
  });

  test('the configured timeout constant is a bounded positive number', () => {
    expect(Number.isFinite(config.REQUEST_TIMEOUT_MS)).toBe(true);
    expect(config.REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(config.REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(60000);
  });

  test('the feed endpoint is not reachable when the client is unconfigured', async () => {
    const offDir = makeTempDataDir('tiktok-off');
    try {
      delete process.env.TIKTOK_CLIENT_KEY;
      jest.resetModules();
      const unconfiguredApp = startServer(offDir, {}).app;
      const res = await request(unconfiguredApp).get('/api/v1/platform-public/tiktok-reels');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toEqual([]);
    } finally {
      try { require('fs').rmSync(offDir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});