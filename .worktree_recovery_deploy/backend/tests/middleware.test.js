// Middleware and infrastructure tests: authorize gates, error handlers,
// logger utility, fileStore corruption recovery, startup guards.
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('middleware');
  server = await startServer(dataDir);
});

// Builds a small real Express app wiring the actual middleware under test.
function miniApp() {
  jest.resetModules();
  const { requireRole, requirePermission, writeRoleGuard } = require('../middleware/authorize');
  const { serverError, requestPerfLogger } = require('../middleware/errorHandler');
  const app = express();
  app.use(requestPerfLogger(0)); // threshold 0: every request exercises the perf path
  app.use((req, res, next) => {
    req.user = req.headers['x-test-user'] ? JSON.parse(req.headers['x-test-user']) : null;
    next();
  });
  app.get('/role', requireRole('Owner', 'Admin'), (req, res) => res.json({ ok: true }));
  app.get('/perm', requirePermission('sales.read'), (req, res) => res.json({ ok: true }));
  app.get('/write', writeRoleGuard('Owner', 'Admin', 'Manager'), (req, res) => res.json({ ok: true }));
  app.post('/write', writeRoleGuard('Owner', 'Admin', 'Manager'), (req, res) => res.json({ ok: true }));
  app.get('/boom', () => { throw new Error('kaboom'); });
  app.use(serverError);
  return app;
}

describe('authorize middleware', () => {
  test('requireRole rejects unauthenticated requests with 401', async () => {
    const res = await request(miniApp()).get('/role');
    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('requireRole rejects a disallowed role with 403', async () => {
    const res = await request(miniApp()).get('/role').set('x-test-user', JSON.stringify({ role: 'Cashier' }));
    expect(res.statusCode).toBe(403);
  });

  test('requireRole allows a listed role', async () => {
    const res = await request(miniApp()).get('/role').set('x-test-user', JSON.stringify({ role: 'Admin' }));
    expect(res.statusCode).toBe(200);
  });

  test('requirePermission rejects unauthenticated requests with 401', async () => {
    const res = await request(miniApp()).get('/perm');
    expect(res.statusCode).toBe(401);
  });

  test('requirePermission lets Owner bypass the permission check', async () => {
    const res = await request(miniApp()).get('/perm').set('x-test-user', JSON.stringify({ role: 'Owner', permissions: [] }));
    expect(res.statusCode).toBe(200);
  });

  test('requirePermission accepts a user carrying the permission', async () => {
    const res = await request(miniApp()).get('/perm').set('x-test-user', JSON.stringify({ role: 'Cashier', permissions: ['sales.read'] }));
    expect(res.statusCode).toBe(200);
  });

  test('requirePermission accepts the wildcard permission', async () => {
    const res = await request(miniApp()).get('/perm').set('x-test-user', JSON.stringify({ role: 'Cashier', permissions: ['all'] }));
    expect(res.statusCode).toBe(200);
  });

  test('requirePermission rejects users without the permission with 403', async () => {
    const res = await request(miniApp()).get('/perm').set('x-test-user', JSON.stringify({ role: 'Cashier', permissions: [] }));
    expect(res.statusCode).toBe(403);
  });

  test('writeRoleGuard passes GET requests through without a user', async () => {
    const res = await request(miniApp()).get('/write');
    expect(res.statusCode).toBe(200);
  });

  test('writeRoleGuard enforces roles on writes', async () => {
    const forbidden = await request(miniApp()).post('/write').set('x-test-user', JSON.stringify({ role: 'Cashier' }));
    expect(forbidden.statusCode).toBe(403);
    const allowed = await request(miniApp()).post('/write').set('x-test-user', JSON.stringify({ role: 'Manager' }));
    expect(allowed.statusCode).toBe(200);
  });
});

describe('error handlers', () => {
  test('notFound returns the standard 404 envelope', async () => {
    const res = await request(server.app).get('/api/v1/definitely-not-a-route');
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('not found');
  });

  test('serverError converts thrown errors into the 500 envelope', async () => {
    const res = await request(miniApp()).get('/boom');
    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

describe('malformed cookie handling', () => {
  test('a malformed percent-encoded cookie must not crash the request', async () => {
    const res = await request(server.app)
      .get('/api/v1/customers')
      .set('Cookie', 'access_token=%');
    expect(res.statusCode).not.toBe(500);
    expect(res.statusCode).toBe(200);
  });

  test('parseCookies falls back to the raw value on bad encoding', async () => {
    jest.resetModules();
    const { parseCookies } = require('../middleware/auth');
    const out = parseCookies({ headers: { cookie: 'access_token=%; other=ok%20value' } });
    expect(out.access_token).toBe('%');
    expect(out.other).toBe('ok value');
  });
});

describe('logger utility', () => {
  test('writes structured lines to LOG_FILE when configured', async () => {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digitronics-log-'));
    const logFile = path.join(logDir, 'test.log');
    process.env.LOG_FILE = logFile;
    jest.resetModules();
    const logger = require('../utils/logger');
    logger.warn('test-warn-message');
    logger.error('test-error-message');
    logger.perf('test-perf-message');
    await new Promise(r => setTimeout(r, 200));
    const content = fs.readFileSync(logFile, 'utf-8');
    expect(content).toContain('[WARN] test-warn-message');
    expect(content).toContain('[ERROR] test-error-message');
    expect(content).toContain('[PERF] test-perf-message');
    delete process.env.LOG_FILE;
  });

  test('all log methods are callable without a log file', async () => {
    jest.resetModules();
    delete process.env.LOG_FILE;
    const logger = require('../utils/logger');
    expect(() => {
      logger.info('i');
      logger.warn('w');
      logger.error('e');
      logger.debug('d');
      logger.perf('p');
    }).not.toThrow();
  });
});

describe('fileStore corruption recovery', () => {
  test('a corrupted store file is reset and served as an empty list', async () => {
    fs.writeFileSync(path.join(dataDir, 'customers.json'), '{corrupted!!!', 'utf-8');
    const res = await request(server.app).get('/api/v1/customers');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.customers).toEqual([]);
    const repaired = JSON.parse(fs.readFileSync(path.join(dataDir, 'customers.json'), 'utf-8'));
    expect(repaired).toEqual({});
  });
});

describe('startup guards', () => {
  test('requiring server.js exports the Express app without listening', async () => {
    jest.resetModules();
    process.env.DIGITRONICS_DATA_DIR = dataDir;
    const app = require('../server.js');
    expect(typeof app).toBe('function');
    expect(typeof app.listen).toBe('function');
    expect(typeof app.use).toBe('function');
  });
});
