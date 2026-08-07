// Webhook API integration tests.
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
  dataDir = makeTempDataDir('webhook');
  server = await startServer(dataDir);
  await createUser(server.app, { username: 'hookadmin', password: 'HookAdmin#1', fullName: 'Hook Admin', role: 'Admin' });
  const loginData = await login(server.app, 'hookadmin', 'HookAdmin#1');
  accessToken = loginData.accessToken;
});

describe('Webhook API Endpoints', () => {
  let createdId;

  test('POST /api/v1/webhooks registers a webhook', async () => {
    const res = await request(server.app)
      .post('/api/v1/webhooks')
      .set(authHeader(accessToken))
      .send({ url: 'https://example.com/hook', events: ['sale.created'], description: 'test' });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.secret).toBeUndefined();
    createdId = res.body.data.id;
  });

  test('GET /api/v1/webhooks lists webhooks without secrets', async () => {
    const res = await request(server.app)
      .get('/api/v1/webhooks')
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    res.body.data.forEach(h => expect(h.secret).toBeUndefined());
  });

  test('GET /api/v1/webhooks/:id returns webhook', async () => {
    const res = await request(server.app)
      .get(`/api/v1/webhooks/${createdId}`)
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(200);
    expect(res.body.data.id).toBe(createdId);
    expect(res.body.data.secret).toBeUndefined();
  });

  test('GET /api/v1/webhooks/:id returns 404 for missing', async () => {
    const res = await request(server.app)
      .get('/api/v1/webhooks/nonexistent')
      .set(authHeader(accessToken));
    expect(res.statusCode).toBe(404);
  });

  test('PUT /api/v1/webhooks/:id updates webhook', async () => {
    const res = await request(server.app)
      .put(`/api/v1/webhooks/${createdId}`)
      .set(authHeader(accessToken))
      .send({ active: false });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.active).toBe(false);
  });

  test('DELETE /api/v1/webhooks/:id removes webhook', async () => {
    const res = await request(server.app)
      .delete(`/api/v1/webhooks/${createdId}`)
      .set(authHeader(accessToken));
    expect(res.statusCode).toBe(200);

    const after = await request(server.app)
      .get(`/api/v1/webhooks/${createdId}`)
      .set(authHeader(accessToken));
    expect(after.statusCode).toBe(404);
  });

  test('POST /api/v1/webhooks rejects invalid URL', async () => {
    const res = await request(server.app)
      .post('/api/v1/webhooks')
      .set(authHeader(accessToken))
      .send({ url: 'not-a-url', events: ['sale.created'] });
    expect(res.statusCode).toBe(400);
  });

  test('Webhook endpoints require authentication', async () => {
    const res = await request(server.app).get('/api/v1/webhooks');
    expect(res.statusCode).toBe(401);
  });
});