// Health, readiness and liveness endpoint tests.
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

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
