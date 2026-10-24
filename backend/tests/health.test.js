// Health, readiness and liveness endpoint tests.
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;
let strictServer;
let strictDataDir;

registerCleanup(() => [server, strictServer], () => [dataDir, strictDataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('health');
  server = await startServer(dataDir);
});

describe('GET /api/v1/health', () => {
  test('returns the healthy envelope with uptime (existing fields preserved)', async () => {
    const res = await request(server.app).get('/api/v1/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.version).toBe('1.0');
    expect(res.body.data.status).toBe('ok');
    expect(typeof res.body.data.uptimeSeconds).toBe('number');
  });
});

describe('GET /api/v1/ready', () => {
  test('reports ready when persistence is writable', async () => {
    const res = await request(server.app).get('/api/v1/ready');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe('ready');
    expect(res.body.data.persistence).toBe('writable');
  });
});

describe('GET /api/v1/liveness', () => {
  test('reports process diagnostics without secrets', async () => {
    const res = await request(server.app).get('/api/v1/liveness');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe('alive');
    expect(typeof res.body.data.pid).toBe('number');
    expect(typeof res.body.data.node).toBe('string');
    expect(typeof res.body.data.memory.rssMb).toBe('number');
    expect(typeof res.body.data.memory.heapUsedMb).toBe('number');
  });

  test('diagnostics never leak secrets or environment values', async () => {
    const res = await request(server.app).get('/api/v1/liveness');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('JWT');
    expect(body).not.toContain('secret');
    expect(body).not.toContain('test-jwt-secret');
    expect(body).not.toContain('SUPABASE');
  });
});

// The production deploy gate (omni_deploy_20260920.sh) curls /health with no
// credentials while the service runs with AUTH_REQUIRED=true, and reports the
// whole deploy as FAILED on anything but a 200. So the probe is proven under
// that exact posture, not only against the open test server above — with a
// control that proves authentication really is on, otherwise a 200 here would
// prove nothing.
describe('GET /health (root liveness probe used by the deploy gate)', () => {
  beforeAll(() => {
    strictDataDir = makeTempDataDir('health-root');
    strictServer = startServer(strictDataDir, { AUTH_REQUIRED: 'true' });
  });

  test('answers 200 without credentials while AUTH_REQUIRED=true', async () => {
    const res = await request(strictServer.app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('control: the same hardened server still rejects protected routes', async () => {
    const res = await request(strictServer.app).get('/api/v1/health/deep');
    expect(res.statusCode).toBe(401);
  });

  test('leaks no internals on the root probe', async () => {
    const res = await request(strictServer.app).get('/health');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('JWT');
    expect(body).not.toContain('secret');
    expect(body).not.toContain('version');
    expect(body).not.toContain('uptime');
    expect(body).not.toContain('pid');
    expect(body).not.toContain('data');
  });
});
