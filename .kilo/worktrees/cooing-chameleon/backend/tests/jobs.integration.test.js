// Job system integration: enqueue via API, deep health, error tracker endpoints.
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;
let accessToken;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('jobs-it');
  server = await startServer(dataDir);
  await createUser(server.app, { username: 'jobadmin', password: 'JobAdmin#1', fullName: 'Job Admin', role: 'Admin' });
  const loginData = await login(server.app, 'jobadmin', 'JobAdmin#1');
  accessToken = loginData.accessToken;
});

describe('Deep Health Endpoints', () => {
  test('GET /api/v1/health/deep returns component checks', async () => {
    const res = await request(server.app).get('/api/v1/health/deep');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.checks).toHaveProperty('persistence');
    expect(res.body.data.checks).toHaveProperty('jobs');
    expect(res.body.data.checks).toHaveProperty('eventbus');
  });

  test('GET /api/v1/health/deep/:component returns single check', async () => {
    const res = await request(server.app).get('/api/v1/health/deep/persistence');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.persistence.status).toBe('ok');
  });

  test('GET /api/v1/health/deep/unknown returns 404', async () => {
    const res = await request(server.app).get('/api/v1/health/deep/nope');
    expect(res.statusCode).toBe(404);
  });
});

describe('Error Tracker Endpoints', () => {
  test('GET /api/v1/errors requires authentication', async () => {
    const res = await request(server.app).get('/api/v1/errors');
    expect(res.statusCode).toBe(401);
  });

  test('GET /api/v1/errors returns list', async () => {
    const res = await request(server.app)
      .get('/api/v1/errors')
      .set(authHeader(accessToken));
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/v1/errors/stats returns counts', async () => {
    const res = await request(server.app)
      .get('/api/v1/errors/stats')
      .set(authHeader(accessToken));
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('total');
    expect(res.body.data).toHaveProperty('open');
  });

  test('GET /api/v1/errors/:id returns 404 for missing', async () => {
    const res = await request(server.app)
      .get('/api/v1/errors/missing')
      .set(authHeader(accessToken));
    expect(res.statusCode).toBe(404);
  });
});

describe('Error capture via middleware', () => {
  test('serverError middleware captures errors into the store', async () => {
    // Isolate: the error handler is exercised through a dedicated Express app.
    const express = require('express');
    const { serverError } = require('../middleware/errorHandler');
    const probeApp = express();
    probeApp.get('/boom', () => { throw new Error('integration boom'); });
    probeApp.use(serverError);

    await request(probeApp).get('/boom');

    const res = await request(server.app)
      .get('/api/v1/errors?limit=10')
      .set(authHeader(accessToken));
    expect(res.statusCode).toBe(200);
    // serverError → errorTracker writes to the same data dir via fileStore
    const matches = res.body.data.filter(e => e.message === 'integration boom');
    expect(matches.length).toBe(1);
    expect(matches[0].occurrences).toBe(1);
  });
});