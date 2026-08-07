// Graceful-shutdown and resource-lifecycle tests.
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
  dataDir = makeTempDataDir('shutdown');
  server = await startServer(dataDir);
});

describe('graceful shutdown', () => {
  test('server.js exports a gracefulShutdown helper', async () => {
    jest.resetModules();
    const app = require('../server.js');
    expect(typeof app.gracefulShutdown).toBe('function');
  });

  test('gracefulShutdown closes the HTTP server, flushes and closes the logger', async () => {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digitronics-shutdown-log-'));
    process.env.LOG_FILE = path.join(logDir, 'shutdown.log');
    jest.resetModules();
    const app = require('../server.js');
    const logger = require('../utils/logger');
    const fileStore = require('../utils/fileStore');

    logger.warn('before-shutdown');
    const httpServer = app.listen(0);
    await new Promise(r => httpServer.once('listening', r));

    // intercept process.exit so the test runner survives
    const realExit = process.exit;
    const exitCodes = [];
    process.exit = code => { exitCodes.push(code); };
    try {
      app.gracefulShutdown(httpServer, 0);
      await new Promise(r => setTimeout(r, 300));
    } finally {
      process.exit = realExit;
      delete process.env.LOG_FILE;
    }

    expect(exitCodes).toEqual([0]);
    // listener is closed: connecting now must fail
    const port = httpServer.address() ? httpServer.address().port : null;
    if (port) {
      await expect(fetch(`http://127.0.0.1:${port}/api/v1/health`)).rejects.toThrow();
    }
    // logger stream was flushed and closed: the log line is on disk
    const content = fs.readFileSync(path.join(logDir, 'shutdown.log'), 'utf-8');
    expect(content).toContain('before-shutdown');
    expect(content).toContain('Shutdown signal received');
    // fileStore flush hook is stable
    expect(fileStore.flushAll()).toBe(true);
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  test('flushAll reports no pending writes (write-through persistence)', async () => {
    await request(server.app).post('/api/v1/partners').send({ id: 'flush-p', name: 'Flush' });
    jest.resetModules();
    const fileStore = require('../utils/fileStore');
    expect(fileStore.flushAll()).toBe(true);
  });
});
