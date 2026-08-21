// P0-1 CORS Hardening regression tests.
// Verifies: allowed origin, disallowed origin, no-origin, preflight,
// credentials, empty configuration (fail-closed), dev defaults.
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

let openServer;    // AUTH_REQUIRED=false, no CORS_ORIGINS (dev defaults)
let hardServer;    // AUTH_REQUIRED=true, no CORS_ORIGINS (fail-closed)
let allowServer;   // AUTH_REQUIRED=true, CORS_ORIGINS set explicitly
let openDataDir, hardDataDir, allowDataDir;

registerCleanup(
  () => [openServer, hardServer, allowServer],
  () => [openDataDir, hardDataDir, allowDataDir]
);

beforeAll(async () => {
  openDataDir = makeTempDataDir('cors-open');
  openServer = await startServer(openDataDir, { AUTH_REQUIRED: 'false' });

  hardDataDir = makeTempDataDir('cors-hard');
  hardServer = await startServer(hardDataDir, { AUTH_REQUIRED: 'true' });

  allowDataDir = makeTempDataDir('cors-allow');
  allowServer = await startServer(allowDataDir, {
    AUTH_REQUIRED: 'true',
    CORS_ORIGINS: 'https://app.example.com,https://admin.example.com'
  });
});

describe('P0-1 CORS Hardening', () => {
  describe('fail-closed when AUTH_REQUIRED=true and CORS_ORIGINS empty', () => {
    test('cross-origin request has no Access-Control-Allow-Origin header', async () => {
      const res = await request(hardServer.app)
        .get('/api/v1/health')
        .set('Origin', 'https://evil.com');
      // When origin is not allowed, cors middleware omits the ACAO header
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    test('preflight from disallowed origin has no CORS headers', async () => {
      const res = await request(hardServer.app)
        .options('/api/v1/health')
        .set('Origin', 'https://evil.com')
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('dev defaults when AUTH_REQUIRED=false and CORS_ORIGINS empty', () => {
    test('localhost:3000 is allowed', async () => {
      const res = await request(openServer.app)
        .get('/api/v1/health')
        .set('Origin', 'http://localhost:3000');
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    });

    test('localhost:5173 is allowed', async () => {
      const res = await request(openServer.app)
        .get('/api/v1/health')
        .set('Origin', 'http://localhost:5173');
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });

    test('localhost:57647 is allowed (staging port)', async () => {
      const res = await request(openServer.app)
        .get('/api/v1/health')
        .set('Origin', 'http://localhost:57647');
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:57647');
    });

    test('arbitrary origin is rejected even in dev mode', async () => {
      const res = await request(openServer.app)
        .get('/api/v1/health')
        .set('Origin', 'https://evil.com');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('explicit CORS_ORIGINS allowlist', () => {
    test('allowed origin gets ACAO header', async () => {
      const res = await request(allowServer.app)
        .get('/api/v1/health')
        .set('Origin', 'https://app.example.com');
      expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    test('second allowed origin works', async () => {
      const res = await request(allowServer.app)
        .get('/api/v1/health')
        .set('Origin', 'https://admin.example.com');
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.example.com');
    });

    test('disallowed origin gets no ACAO header', async () => {
      const res = await request(allowServer.app)
        .get('/api/v1/health')
        .set('Origin', 'https://evil.com');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    test('credentials header is sent with allowed origin', async () => {
      const res = await request(allowServer.app)
        .get('/api/v1/health')
        .set('Origin', 'https://app.example.com');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('preflight (OPTIONS)', () => {
    test('preflight from allowed origin returns CORS headers', async () => {
      const res = await request(allowServer.app)
        .options('/api/v1/health')
        .set('Origin', 'https://app.example.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type,Authorization');
      expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
      expect(res.headers['access-control-allow-methods']).toContain('POST');
      expect(res.headers['access-control-allow-headers']).toContain('Content-Type');
      expect(res.headers['access-control-allow-headers']).toContain('Authorization');
    });

    test('preflight from disallowed origin gets no CORS headers', async () => {
      const res = await request(allowServer.app)
        .options('/api/v1/health')
        .set('Origin', 'https://evil.com')
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('no Origin header (same-origin or server-to-server)', () => {
    test('request without Origin header proceeds normally', async () => {
      const res = await request(allowServer.app)
        .get('/api/v1/health');
      // No CORS headers needed for same-origin
      expect(res.status).toBe(200);
    });
  });

  describe('allowed methods and headers', () => {
    test('allowed methods include GET, POST, PUT, PATCH, DELETE, OPTIONS', async () => {
      const res = await request(allowServer.app)
        .options('/api/v1/health')
        .set('Origin', 'https://app.example.com')
        .set('Access-Control-Request-Method', 'DELETE');
      expect(res.headers['access-control-allow-methods']).toContain('DELETE');
      expect(res.headers['access-control-allow-methods']).toContain('PUT');
      expect(res.headers['access-control-allow-methods']).toContain('PATCH');
    });

    test('allowed headers include Authorization, X-Tenant-Id, X-Branch-Id', async () => {
      const res = await request(allowServer.app)
        .options('/api/v1/health')
        .set('Origin', 'https://app.example.com')
        .set('Access-Control-Request-Headers', 'Authorization,X-Tenant-Id,X-Branch-Id');
      expect(res.headers['access-control-allow-headers']).toContain('Authorization');
      expect(res.headers['access-control-allow-headers']).toContain('X-Tenant-Id');
      expect(res.headers['access-control-allow-headers']).toContain('X-Branch-Id');
    });
  });
});
