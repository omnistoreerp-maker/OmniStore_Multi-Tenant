'use strict';

// TikTok Display API integration: OAuth, token handling, video discovery,
// the public Reels feed, and the security invariants around credentials.
//
// No test touches the network: global.fetch is replaced per case, the data
// directory is a temp dir, and no real credential is used anywhere.

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const CONFIG_ENV = [
  'TIKTOK_CLIENT_KEY',
  'TIKTOK_CLIENT_SECRET',
  'TIKTOK_REDIRECT_URI',
  'TIKTOK_REELS_SCOPES',
  'TIKTOK_USERNAME'
];

let realFetch;
let dataDir;
let app;
let savedEnv = {};

function setEnv(values) {
  Object.keys(values).forEach((key) => {
    if (values[key] === undefined || values[key] === '') delete process.env[key];
    else process.env[key] = values[key];
  });
}

function bootServer(env) {
  setEnv(env || {});
  jest.resetModules();
  dataDir = makeTempDataDir('tiktok');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  process.env.NODE_ENV = 'test';
  const started = startServer(dataDir, env);
  app = started.app;
  return app;
}

const ADMIN_USER = { username: 'tiktokadmin', password: 'TikTokAdmin#1', fullName: 'TikTok Admin', role: 'Admin' };

// Boots the server and returns an Authorization header for a real user that is
// also in the server-side platform-admin store, i.e. a genuine operator for the
// global TikTok connection. Required because every connection-mutating
// endpoint is platform-admin gated.
async function bootAdminSession(env) {
  bootServer(env);
  // Required AFTER bootServer so it is the same module instance the app uses.
  const platformAdmin = require('../services/platformAdmin.service');
  platformAdmin.grant(ADMIN_USER.username, 'PLATFORM_ADMIN');
  const { createUser, login, authHeader } = require('./helpers/authHelper');
  await createUser(app, ADMIN_USER);
  const session = await login(app, ADMIN_USER.username, ADMIN_USER.password);
  return authHeader(session.accessToken);
}

function jsonResponse(body, status) {  return {
    ok: status === undefined || (status >= 200 && status < 300),
    status: status || 200,
    text: async () => JSON.stringify(body)
  };
}

beforeEach(() => {
  realFetch = global.fetch;
  savedEnv = {};
  CONFIG_ENV.forEach((key) => { savedEnv[key] = process.env[key]; });
});

afterEach(() => {
  global.fetch = realFetch;
  setEnv(savedEnv);
  jest.resetModules();
});

registerCleanup(() => [], () => [dataDir]);

const CONFIGURED = {
  TIKTOK_CLIENT_KEY: 'test-client-key',
  TIKTOK_CLIENT_SECRET: 'test-client-secret',
  TIKTOK_REDIRECT_URI: 'https://omnistore.example.com/api/v1/platform-public/tiktok/callback'
};

// ---------------------------------------------------------------------------
// Configuration validation
// ---------------------------------------------------------------------------
describe('TikTok configuration', () => {
  test('reports not-configured when credentials are absent', () => {
    const config = require('../config/tiktok');
    expect(config.isEnabled()).toBe(false);
    expect(config.isFullyConfigured()).toBe(false);
    expect(config.getPublicConfig().configured).toBe(false);
  });

  test.each([
    ['a relative url', '/callback', 'absolute https'],
    ['a non-https url', 'http://example.com/cb', 'absolute https'],
    ['a url with a fragment', 'https://example.com/cb#x', 'fragment'],
    ['a url with a query string', 'https://example.com/cb?a=1', 'query string']
  ])('rejects %s redirect uri', (_label, uri, expectedFragment) => {
    const config = require('../config/tiktok');
    const result = config.validateRedirectUri(uri);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(expectedFragment);
  });

  test('accepts a static https redirect uri', () => {
    const config = require('../config/tiktok');
    const result = config.validateRedirectUri('https://omnistore.example.com/api/v1/platform-public/tiktok/callback');
    expect(result.valid).toBe(true);
  });

  test('always keeps video.list in the requested scopes', () => {
    process.env.TIKTOK_REELS_SCOPES = 'user.info.basic';
    jest.resetModules();
    const config = require('../config/tiktok');
    expect(config.getScopes()).toContain('video.list');
  });

  test('getPublicConfig never exposes a secret or the client key', () => {
    setEnv(CONFIGURED);
    jest.resetModules();
    const config = require('../config/tiktok');
    const serialized = JSON.stringify(config.getPublicConfig());
    expect(serialized).not.toContain('test-client-key');
    expect(serialized).not.toContain('test-client-secret');
    expect(serialized).not.toContain('clientSecret');
  });
});

// ---------------------------------------------------------------------------
// OAuth flow
// ---------------------------------------------------------------------------
describe('TikTok OAuth flow', () => {
  test('connect redirects to TikTok with client_key, scopes and state', async () => {
    const auth = await bootAdminSession(CONFIGURED);
    const res = await request(app).get('/api/v1/platform-public/tiktok/connect').set(auth);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://www.tiktok.com/v2/auth/authorize/');
    expect(res.headers.location).toContain('client_key=test-client-key');
    expect(res.headers.location).toContain('response_type=code');
    expect(res.headers.location).toContain('video.list');
    expect(res.headers.location).toMatch(/state=[0-9a-f]{16,}/);
  });

  test('connect fails closed with 503 when unconfigured', async () => {
    const auth = await bootAdminSession({});
    const res = await request(app).get('/api/v1/platform-public/tiktok/connect').set(auth);
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  test('callback rejects a missing, unknown or replayed state without exchanging', async () => {
    const auth = await bootAdminSession(CONFIGURED);
    global.fetch = jest.fn();

    const missing = await request(app).get('/api/v1/platform-public/tiktok/callback?code=abc').set(auth);
    expect(missing.status).toBe(400);

    const unknown = await request(app).get('/api/v1/platform-public/tiktok/callback?code=abc&state=deadbeef').set(auth);
    expect(unknown.status).toBe(400);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('callback rejects an authorization error response', async () => {
    const auth = await bootAdminSession(CONFIGURED);
    const res = await request(app).get('/api/v1/platform-public/tiktok/callback?error=access_denied&state=x').set(auth);
    expect(res.status).toBe(400);
  });

  test('callback rejects a missing code', async () => {
    const auth = await bootAdminSession(CONFIGURED);
    const res = await request(app).get('/api/v1/platform-public/tiktok/callback?state=x').set(auth);
    expect(res.status).toBe(400);
  });

  test('a state minted by one admin cannot be completed by another', async () => {
    bootServer(CONFIGURED);
    const platformAdmin = require('../services/platformAdmin.service');
    const { createUser, login, authHeader } = require('./helpers/authHelper');
    platformAdmin.grant('tiktokadmin', 'PLATFORM_ADMIN');
    platformAdmin.grant('tiktokadmin2', 'PLATFORM_ADMIN');
    await createUser(app, ADMIN_USER);
    await createUser(app, { username: 'tiktokadmin2', password: 'OtherAdmin#1', fullName: 'Other Admin', role: 'Admin' });
    const ownerAuth = authHeader((await login(app, ADMIN_USER.username, ADMIN_USER.password)).accessToken);
    const otherAuth = authHeader((await login(app, 'tiktokadmin2', 'OtherAdmin#1')).accessToken);
    global.fetch = jest.fn();

    const start = await request(app).get('/api/v1/platform-public/tiktok/connect').set(ownerAuth);
    expect(start.status).toBe(302);
    const state = new URL(start.headers.location, 'https://x').searchParams.get('state');
    expect(state).toBeTruthy();

    // A DIFFERENT platform admin holding the intercepted state must not be
    // able to complete the exchange.
    const res = await request(app)
      .get('/api/v1/platform-public/tiktok/callback?code=abc&state=' + encodeURIComponent(state))
      .set(otherAuth);
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Authorization: the global TikTok account must not be hijackable by visitors
// ---------------------------------------------------------------------------
describe('TikTok connection authorization', () => {
  const MUTATIONS = [
    ['get', '/api/v1/platform-public/tiktok/connect'],
    ['get', '/api/v1/platform-public/tiktok/callback?code=abc&state=zz'],
    ['get', '/api/v1/platform-public/tiktok/status'],
    ['get', '/api/v1/platform-public/tiktok/reels-status'],
    ['post', '/api/v1/platform-public/tiktok/sync'],
    ['post', '/api/v1/platform-public/tiktok/disconnect']
  ];

  test('anonymous visitors cannot reach any connection-mutating endpoint', async () => {
    bootServer(CONFIGURED);
    for (const [method, path] of MUTATIONS) {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    }
  });

  test('an authenticated non-admin is refused with 403', async () => {
    bootServer(CONFIGURED);
    const { createUser, login, authHeader } = require('./helpers/authHelper');
    await createUser(app, { username: 'plainuser', password: 'PlainUser#1', fullName: 'Plain User', role: 'Admin' });
    const auth = authHeader((await login(app, 'plainuser', 'PlainUser#1')).accessToken);
    for (const [method, path] of MUTATIONS) {
      const res = await request(app)[method](path).set(auth);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    }
  });

  test('a forged Authorization header is rejected', async () => {
    bootServer(CONFIGURED);
    const res = await request(app)
      .post('/api/v1/platform-public/tiktok/disconnect')
      .set({ Authorization: 'Bearer not.a.real.token' });
    expect(res.status).toBe(401);
  });

  test('the public feed itself stays readable without authentication', async () => {
    bootServer(CONFIGURED);
    const res = await request(app).get('/api/v1/platform-public/tiktok-reels');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Token handling
// ---------------------------------------------------------------------------
describe('Token storage', () => {
  test('saves tokens and reports a secret-free status', () => {
    setEnv(CONFIGURED);
    dataDir = makeTempDataDir('tiktok-tokens');
    process.env.DIGITRONICS_DATA_DIR = dataDir;
    jest.resetModules();
    const connection = require('../services/tiktokConnection.service');

    connection.saveConnection({
      access_token: 'act.SECRETVALUE',
      refresh_token: 'rft.SECRETVALUE',
      expires_in: 86400,
      refresh_expires_in: 31536000,
      scope: 'user.info.basic,video.list'
    }, { open_id: 'open-123', display_name: 'Test', username: 'testuser' });

    const status = connection.getStatus();
    expect(status.connected).toBe(true);
    expect(status.tokenState).toBe('active');
    expect(status.username).toBe('testuser');
    expect(status.openId).toBe('open-123');

    // The public status shape must never contain token material.
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain('act.SECRETVALUE');
    expect(serialized).not.toContain('rft.SECRETVALUE');
  });

  test('rotating refresh token replaces the stored value', () => {
    setEnv(CONFIGURED);
    dataDir = makeTempDataDir('tiktok-rotate');
    process.env.DIGITRONICS_DATA_DIR = dataDir;
    jest.resetModules();
    const connection = require('../services/tiktokConnection.service');

    connection.saveConnection({ access_token: 'a1', refresh_token: 'r1', expires_in: 86400 }, null);
    // A response without refresh_token keeps the current one.
    connection.saveConnection({ access_token: 'a2', expires_in: 86400 }, null);
    expect(connection.getRefreshToken()).toBe('r1');
    // An explicit new refresh token wins.
    connection.saveConnection({ access_token: 'a3', refresh_token: 'r2', expires_in: 86400 }, null);
    expect(connection.getRefreshToken()).toBe('r2');
  });

  test('a token inside the refresh skew is not handed out, but is not yet expired', () => {
    setEnv(CONFIGURED);
    dataDir = makeTempDataDir('tiktok-exp');
    process.env.DIGITRONICS_DATA_DIR = dataDir;
    jest.resetModules();
    const connection = require('../services/tiktokConnection.service');
    // expires_in=1s: still technically valid, but inside the refresh skew, so
    // getAccessToken() refuses it to avoid a sync racing an expiring token.
    connection.saveConnection({ access_token: 'a1', refresh_token: 'r1', expires_in: 1 }, null);
    expect(connection.getAccessToken()).toBeNull();
    expect(connection.getStatus().tokenState).toBe('active');
  });

  test('a genuinely expired token is reported as expired', () => {
    setEnv(CONFIGURED);
    dataDir = makeTempDataDir('tiktok-exp2');
    process.env.DIGITRONICS_DATA_DIR = dataDir;
    jest.resetModules();
    const connection = require('../services/tiktokConnection.service');
    connection.saveConnection({ access_token: 'a1', refresh_token: 'r1', expires_in: 86400 }, null);
    // Age the record past its own expiry.
    const fs = require('fs');
    const path = require('path');
    const file = path.join(dataDir, 'tiktokConnection.json');
    const record = JSON.parse(fs.readFileSync(file, 'utf-8'));
    record.accessTokenExpiresAt = Date.now() - 60000;
    record.refreshTokenExpiresAt = Date.now() - 60000;
    fs.writeFileSync(file, JSON.stringify(record), 'utf-8');
    expect(connection.getStatus().tokenState).toBe('expired');
    expect(connection.getAccessToken()).toBeNull();
  });

  test('clearConnection removes the account', () => {
    setEnv(CONFIGURED);
    dataDir = makeTempDataDir('tiktok-clear');
    process.env.DIGITRONICS_DATA_DIR = dataDir;
    jest.resetModules();
    const connection = require('../services/tiktokConnection.service');
    connection.saveConnection({ access_token: 'a1', refresh_token: 'r1', expires_in: 86400 }, null);
    expect(connection.isConnected()).toBe(true);
    connection.clearConnection();
    expect(connection.isConnected()).toBe(false);
    expect(connection.getStatus().connected).toBe(false);
  });

  test('state is single-use', () => {
    setEnv(CONFIGURED);
    dataDir = makeTempDataDir('tiktok-state');
    process.env.DIGITRONICS_DATA_DIR = dataDir;
    jest.resetModules();
    const connection = require('../services/tiktokConnection.service');
    const state = connection.createState();
    expect(connection.consumeState(state)).toBe(true);
    // A replay of the same state must fail.
    expect(connection.consumeState(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Video normalization
// ---------------------------------------------------------------------------
describe('Video metadata normalization', () => {
  function normalize(video) {
    dataDir = makeTempDataDir('tiktok-norm');
    process.env.DIGITRONICS_DATA_DIR = dataDir;
    jest.resetModules();
    return require('../services/tiktokDisplayApi.service').normalizeVideo(video);
  }

  test('maps the display fields and converts create_time to ISO', () => {
    const item = normalize({
      id: '7080213458555737986',
      create_time: 1657851434,
      title: 'video 1',
      video_description: 'Test video 1',
      duration: 12,
      cover_image_url: 'https://p16-sign.tiktokcdn.com/cover.jpeg',
      share_url: 'https://www.tiktok.com/@user/video/7080213458555737986',
      embed_link: 'https://www.tiktok.com/static/profile-video?id=7080213458555737986'
    });
    expect(item.id).toBe('7080213458555737986');
    expect(item.title).toBe('video 1');
    expect(item.description).toBe('Test video 1');
    expect(item.duration).toBe(12);
    expect(item.coverImage).toContain('tiktokcdn.com');
    expect(item.createdAt).toBe(new Date(1657851434 * 1000).toISOString());
    expect(item.embedUrl).toContain('profile-video');
  });

  test('builds a documented Embed Player url when embed_link is absent', () => {
    const item = normalize({ id: '6718335390845095173' });
    expect(item.embedUrl).toBe('https://www.tiktok.com/player/v1/6718335390845095173');
    expect(item.shareUrl).toBe('https://www.tiktok.com/@i/video/6718335390845095173');
  });

  test('drops embed_html so remote markup never reaches a client', () => {
    const item = normalize({ id: '123', embed_html: '<blockquote>remote</blockquote><script src="x"></script>' });
    expect(item.embedHtml).toBeUndefined();
    expect(Object.keys(item)).not.toContain('embed_html');
    expect(JSON.stringify(item)).not.toContain('blockquote');
  });

  test('never claims a media file url', () => {
    const item = normalize({ id: '123', download_addr: 'https://cdn.tiktok.com/x.mp4', play_addr: 'https://cdn.tiktok.com/y.mp4' });
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain('.mp4');
    expect(serialized).not.toContain('download_addr');
    expect(serialized).not.toContain('play_addr');
  });

  test('rejects a video without an id', () => {
    expect(normalize({ title: 'no id' })).toBeNull();
    expect(normalize(null)).toBeNull();
  });

  // The CSP img-src allowlist is only sound if the server itself guarantees the
  // cover URL is on a TikTok CDN host. These cases prove a hostile or malformed
  // upstream value can never introduce a third-party image origin into the page.
  test('keeps a documented TikTok CDN cover image', () => {
    const url = 'https://p16-sign.tiktokcdn-us.com/tos-useast5-p-0068-tx/abc~tplv-noop.image?x-expires=1&x-signature=Z';
    expect(normalize({ id: '1', cover_image_url: url }).coverImage).toBe(url);
    const other = 'https://p16-sign-va.tiktokcdn.com/obj/tos-maliva-p-0068/def~tplv-noop.image';
    expect(normalize({ id: '1', cover_image_url: other }).coverImage).toBe(other);
  });

  test('drops a cover image that is not on a TikTok CDN host', () => {
    expect(normalize({ id: '1', cover_image_url: 'https://evil.example.com/track.png' }).coverImage).toBe('');
    expect(normalize({ id: '1', cover_image_url: 'https://tiktokcdn.com.evil.com/x.png' }).coverImage).toBe('');
    expect(normalize({ id: '1', cover_image_url: 'https://not-tiktokcdn.com/x.png' }).coverImage).toBe('');
    expect(normalize({ id: '1', cover_image_url: 'https://evil.com/?u=tiktokcdn.com' }).coverImage).toBe('');
  });

  test('drops an insecure or malformed cover image', () => {
    // Plain http is refused: the CSP allowlist is https-only.
    expect(normalize({ id: '1', cover_image_url: 'http://p16-sign.tiktokcdn.com/x.png' }).coverImage).toBe('');
    expect(normalize({ id: '1', cover_image_url: 'javascript:alert(1)' }).coverImage).toBe('');
    expect(normalize({ id: '1', cover_image_url: 'data:image/svg+xml,<svg/>' }).coverImage).toBe('');
    expect(normalize({ id: '1', cover_image_url: 'not a url' }).coverImage).toBe('');
  });
});

// ---------------------------------------------------------------------------
// List Videos: success, empty, pagination, upstream failure, rate limit
// ---------------------------------------------------------------------------
describe('List Videos discovery', () => {
  function connect() {
    setEnv(CONFIGURED);
    dataDir = makeTempDataDir('tiktok-list');
    process.env.DIGITRONICS_DATA_DIR = dataDir;
    jest.resetModules();
    const connection = require('../services/tiktokConnection.service');
    const api = require('../services/tiktokDisplayApi.service');
    api._resetRateBudget();
    connection.saveConnection({
      access_token: 'act.TEST', refresh_token: 'rft.TEST', expires_in: 86400, refresh_expires_in: 31536000
    }, { open_id: 'open-1' });
    return api;
  }

  test('returns normalized items, cursor and has_more', async () => {
    const api = connect();
    global.fetch = jest.fn(async () => jsonResponse({
      data: { videos: [{ id: '2', create_time: 200, title: 'b' }, { id: '1', create_time: 100, title: 'a' }], cursor: 1643332803000, has_more: true },
      error: { code: 'ok', message: '' }
    }));
    const res = await api.listVideos({ maxCount: 20 });
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(2);
    expect(res.cursor).toBe(1643332803000);
    expect(res.hasMore).toBe(true);
    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer act.TEST');
    expect(init.method).toBe('POST');
  });

  test('returns an empty item list for an account with no public videos', async () => {
    const api = connect();
    global.fetch = jest.fn(async () => jsonResponse({ data: { videos: [], cursor: 0, has_more: false }, error: { code: 'ok' } }));
    const res = await api.listVideos();
    expect(res.ok).toBe(true);
    expect(res.items).toEqual([]);
    expect(res.hasMore).toBe(false);
  });

  test('clamps max_count to the documented maximum of 20', async () => {
    const api = connect();
    global.fetch = jest.fn(async () => jsonResponse({ data: { videos: [] }, error: { code: 'ok' } }));
    await api.listVideos({ maxCount: 500 });
    const [url, init] = global.fetch.mock.calls[0];
    expect(JSON.parse(init.body).max_count).toBe(20);
    expect(url).toContain('fields=');
  });

  test('forwards a cursor for incremental sync', async () => {
    const api = connect();
    global.fetch = jest.fn(async () => jsonResponse({ data: { videos: [] }, error: { code: 'ok' } }));
    await api.listVideos({ cursor: 1643332803000 });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).cursor).toBe('1643332803000');
  });

  test('surfaces a rate-limited upstream response', async () => {
    const api = connect();
    global.fetch = jest.fn(async () => jsonResponse({ error: { code: 'rate_limit_exceeded', message: 'slow down' } }, 429));
    const res = await api.listVideos();
    expect(res.ok).toBe(false);
    expect(res.rateLimited).toBe(true);
    expect(res.code).toBe('rate_limit_exceeded');
  });

  test('surfaces a malformed upstream body without throwing', async () => {
    const api = connect();
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => 'not json' }));
    const res = await api.listVideos();
    expect(res.ok).toBe(false);
  });

  test('surfaces a network failure without throwing', async () => {
    const api = connect();
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    const res = await api.listVideos();
    expect(res.ok).toBe(false);
    expect(res.code).toBe('network_error');
  });

  test('reports not_connected when no account is authorized', async () => {
    setEnv(CONFIGURED);
    dataDir = makeTempDataDir('tiktok-none');
    process.env.DIGITRONICS_DATA_DIR = dataDir;
    jest.resetModules();
    const api = require('../services/tiktokDisplayApi.service');
    global.fetch = jest.fn();
    const res = await api.listVideos();
    expect(res.ok).toBe(false);
    expect(res.code).toBe('not_connected');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Reels cache and public API
// ---------------------------------------------------------------------------
describe('Reels public API', () => {
  test('returns an empty feed when no account is connected', async () => {
    bootServer(CONFIGURED);
    const res = await request(app).get('/api/v1/platform-public/tiktok-reels');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.connected).toBe(false);
  });

  test('serves cached items without calling TikTok on a page load', async () => {
    bootServer(CONFIGURED);
    const connection = require('../services/tiktokConnection.service');
    const cache = require('../services/reelsCache.service');
    cache._resetRateBudget();
    connection.saveConnection({ access_token: 'act.TEST', refresh_token: 'rft.TEST', expires_in: 86400 }, { username: 'tester' });
    cache.syncNow = null;
    // Seed the store directly so the feed has content and is NOT stale.
    require('fs').writeFileSync(
      require('path').join(dataDir, 'reelsCache.json'),
      JSON.stringify({
        items: [{ id: '1', title: 't', description: '', duration: 5, coverImage: '', shareUrl: 'https://tiktok.com/@i/video/1', embedUrl: 'https://tiktok.com/player/v1/1', createdAt: new Date().toISOString() }],
        cursor: null, hasMore: false, syncedAt: new Date().toISOString(), lastError: null
      }),
      'utf-8'
    );
    global.fetch = jest.fn();

    const res = await request(app).get('/api/v1/platform-public/tiktok-reels');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.account).toBe('tester');
    // A page load must not hit TikTok.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('never returns any credential in the feed response', async () => {
    bootServer(CONFIGURED);
    const connection = require('../services/tiktokConnection.service');
    connection.saveConnection({ access_token: 'act.TOKENSECRET', refresh_token: 'rft.TOKENSECRET', expires_in: 86400 }, { username: 'tester' });
    const res = await request(app).get('/api/v1/platform-public/tiktok-reels');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('TOKENSECRET');
    expect(body).not.toContain('access_token');
    expect(body).not.toContain('refresh_token');
    expect(body).not.toContain('client_secret');
  });

  test('status endpoint reports cache and connection without secrets', async () => {
    const auth = await bootAdminSession(CONFIGURED);
    const connection = require('../services/tiktokConnection.service');
    connection.saveConnection({ access_token: 'act.SECRET1', refresh_token: 'rft.SECRET2', expires_in: 86400 }, { username: 'tester' });
    const res = await request(app).get('/api/v1/platform-public/tiktok/reels-status').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.account.connected).toBe(true);
    expect(res.body.data.account.username).toBe('tester');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('SECRET1');
    expect(body).not.toContain('SECRET2');
    expect(body).not.toContain('test-client-secret');
  });

  test('reels feed carries no tenant or company identifier', async () => {
    bootServer(CONFIGURED);
    const res = await request(app).get('/api/v1/platform-public/tiktok-reels');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('companyId');
    expect(body).not.toContain('tenantId');
  });

  test('tiktok status endpoint never returns credentials', async () => {
    const auth = await bootAdminSession(CONFIGURED);
    const connection = require('../services/tiktokConnection.service');
    connection.saveConnection({ access_token: 'act.XYZ', refresh_token: 'rft.XYZ', expires_in: 86400 }, { username: 'tester' });
    const res = await request(app).get('/api/v1/platform-public/tiktok/status').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('act.XYZ');
    expect(JSON.stringify(res.body)).not.toContain('rft.XYZ');
  });

  test('sync reports failure when no account is connected', async () => {
    const auth = await bootAdminSession(CONFIGURED);
    const res = await request(app).post('/api/v1/platform-public/tiktok/sync').set(auth);
    expect(res.status).toBe(502);
  });

  test('disconnect clears the connection and returns no token', async () => {
    const auth = await bootAdminSession(CONFIGURED);
    const connection = require('../services/tiktokConnection.service');
    connection.saveConnection({ access_token: 'act.GONE', refresh_token: 'rft.GONE', expires_in: 86400 }, null);
    const res = await request(app).post('/api/v1/platform-public/tiktok/disconnect').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.connected).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('GONE');
    expect(connection.isConnected()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Namespace separation from Master's tenant-scoped Reels product.
//
// Master owns GET /api/v1/platform-public/reels (backend/routes/reels.routes.js
// mounted in backend/server.js, page media-reels.html, schema data.reels/count).
// This integration owns GET /api/v1/platform-public/tiktok-reels (page
// reels.html, schema data.items/hasMore).
//
// The regression that matters: backend/routes/platformPublic.routes.js is
// mounted BEFORE Master's reelsRoutes in backend/server.js, so ANY /reels
// match registered in this router would answer the request first and silently
// replace Master's tenant feed with a global, unauthenticated TikTok feed.
// media-reels.html would then render empty (it reads data.reels) with no error,
// because the TikTok response is still a 200 with success:true.
//
// These assertions hold both before and after the merge into Master: before it,
// /reels is simply unmatched by this router; after it, /reels is served by
// Master's router. In both cases it must never be the TikTok controller.
// ---------------------------------------------------------------------------
describe('Namespace separation from Master tenant Reels', () => {
  const TIKTOK_PATH = '/api/v1/platform-public/tiktok-reels';
  const MASTER_PATH = '/api/v1/platform-public/reels';

  test('the TikTok feed serves the TikTok schema on its own path', async () => {
    bootServer(CONFIGURED);
    const res = await request(app).get(TIKTOK_PATH);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data).toHaveProperty('hasMore');
    expect(res.body.data).toHaveProperty('nextCursor');
    // Master\'s schema must never appear here, and vice versa.
    expect(res.body.data).not.toHaveProperty('reels');
    expect(res.body.data).not.toHaveProperty('count');
  });

  test('GET /reels is never answered by the TikTok controller', async () => {
    bootServer(CONFIGURED);
    const res = await request(app).get(MASTER_PATH);
    const body = res.body || {};
    // Whatever /reels returns (404 before the merge, Master\'s tenant feed
    // after it), it must NOT be the TikTok payload.
    const data = body.data || {};
    expect(Array.isArray(data.items)).toBe(false);
    expect(data).not.toHaveProperty('hasMore');
    if (res.status === 200 && body.success === true) {
      // Post-merge: Master\'s own schema is what answers.
      expect(Array.isArray(data.reels)).toBe(true);
      expect(data).toHaveProperty('count');
    }
  });

  test('the TikTok public router registers no /reels route at all', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'routes', 'platformPublic.routes.js'),
      'utf-8'
    );
    // A bare /reels GET would shadow Master\'s router outright.
    expect(src).not.toMatch(/router\.get\('\/reels'/);
    // And no /reels/* sub-path either: /reels/status used to live here.
    expect(src).not.toMatch(/router\.(get|post|put|patch|delete)\('\/reels\//);
    expect(src).toMatch(/router\.get\('\/tiktok-reels'/);
    // The controller is the renamed TikTok one, not Master\'s.
    expect(src).toContain("require('../controllers/tiktokReels.controller')");
  });

  test('no TikTok admin route lives under the /reels namespace', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'routes', 'platformPublic.routes.js'),
      'utf-8'
    );
    for (const route of ['/tiktok/connect', '/tiktok/callback', '/tiktok/status', '/tiktok/reels-status', '/tiktok/sync', '/tiktok/disconnect']) {
      expect(src).toContain("router." + (/sync|disconnect/.test(route) ? 'post' : 'get') + "('" + route + "'");
    }
    expect(src).not.toContain("router.get('/reels/status'");
  });
});
