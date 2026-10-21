// Regression tests for the deploy health gate.
//
// The production false failure was: the on-host deploy script defaulted to
// /health (404), so a healthy service was reported as DEPLOY_RESULT=FAILED.
// These tests pin the documented contract (/api/v1/health + /api/v1/ready) and
// prove that /health is never consulted.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CLI = path.join(__dirname, 'health-check.js');

function startServer(routes) {
  return new Promise((resolve) => {
    const requests = [];
    const server = http.createServer((req, res) => {
      const route = req.url.split('?')[0];
      requests.push(route);
      const handler = routes[route];
      if (!handler) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      res.statusCode = handler.status || 200;
      res.setHeader('content-type', 'application/json');
      res.end(typeof handler.body === 'string' ? handler.body : JSON.stringify(handler.body));
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        requests,
        base: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

function runGate(base, extra = []) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [CLI, '--base', base, '--timeout-ms', '2000', ...extra],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), 15000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr: `${stderr}${err.message}` });
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

const HEALTHY = {
  '/api/v1/health': {
    body: { success: true, data: { version: '1.0', status: 'ok', uptimeSeconds: 1 } },
  },
  '/api/v1/ready': {
    body: { success: true, data: { status: 'ready', persistence: 'writable' } },
  },
};

let running = null;

test.afterEach(async () => {
  if (!running) return;
  const { server } = running;
  running = null;
  await new Promise((resolve) => server.close(resolve));
});

async function start(routes) {
  running = await startServer(routes);
  return running;
}

test('passes when /health is 404 but /api/v1/health and /api/v1/ready are healthy', async () => {
  const { base, requests } = await start(HEALTHY);

  const result = await runGate(base);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /HEALTH_CHECK=PASS/);
  assert.ok(requests.includes('/api/v1/health'));
  assert.ok(requests.includes('/api/v1/ready'));
  assert.ok(!requests.includes('/health'), '/health must not be consulted');
});

test('fails when /api/v1/health returns 500', async () => {
  const { base } = await start({
    ...HEALTHY,
    '/api/v1/health': { status: 500, body: { success: false } },
  });

  const result = await runGate(base);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /HEALTH_CHECK=FAIL/);
  assert.match(result.stdout, /HEALTH_CHECK=FAIL path=\/api\/v1\/health/);
});

test('fails when /api/v1/ready returns 503', async () => {
  const { base } = await start({
    ...HEALTHY,
    '/api/v1/ready': { status: 503, body: { success: false } },
  });

  const result = await runGate(base);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /READY_CHECK=FAIL/);
});

test('fails when /api/v1/health reports a non-ok payload', async () => {
  const { base } = await start({
    ...HEALTHY,
    '/api/v1/health': { body: { success: true, data: { status: 'degraded' } } },
  });

  const result = await runGate(base);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /HEALTH_CHECK=FAIL/);
});

test('fails when readiness is not writable', async () => {
  const { base } = await start({
    ...HEALTHY,
    '/api/v1/ready': { body: { success: true, data: { status: 'ready', persistence: 'readonly' } } },
  });

  const result = await runGate(base);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /READY_CHECK=FAIL/);
});

test('fails when /api/v1/health is missing even if /api/v1/ready is healthy', async () => {
  const { base } = await start({
    '/api/v1/ready': HEALTHY['/api/v1/ready'],
  });

  const result = await runGate(base);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /HEALTH_CHECK=FAIL/);
});

test('fails when a health response is not valid JSON', async () => {
  const { base } = await start({
    ...HEALTHY,
    '/api/v1/health': { body: 'not-json' },
  });

  const result = await runGate(base);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /HEALTH_CHECK=FAIL/);
});

test('fails when the service is unreachable', async () => {
  const result = await runGate('http://127.0.0.1:1', ['--timeout-ms', '500']);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /HEALTH_CHECK=FAIL/);
});

test('rejects an invalid base URL', async () => {
  const result = await runGate('not-a-url');

  assert.equal(result.status, 2);
  assert.match(result.stderr, /HEALTH_CHECK=FAIL/);
});
