// API Key integration tests: full HTTP lifecycle via supertest.
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
  dataDir = makeTempDataDir('apikey');
  server = await startServer(dataDir);
  await createUser(server.app, { username: 'keyadmin', password: 'KeyAdmin#1', fullName: 'Key Admin', role: 'Admin' });
  const loginData = await login(server.app, 'keyadmin', 'KeyAdmin#1');
  accessToken = loginData.accessToken;
});

describe('API Key Endpoints', () => {
  let createdKeyId;
  let rawApiKey;

  test('POST /api/v1/api-keys generates a new key', async () => {
    const res = await request(server.app)
      .post('/api/v1/api-keys')
      .set(authHeader(accessToken))
      .send({ name: 'Test Integration Key', scopes: ['read', 'write'] });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.key).toMatch(/^dgv2_live_/);
    expect(res.body.data.name).toBe('Test Integration Key');
    expect(res.body.data.id).toBeTruthy();
    createdKeyId = res.body.data.id;
    rawApiKey = res.body.data.key;
  });

  test('GET /api/v1/api-keys lists all keys', async () => {
    const res = await request(server.app)
      .get('/api/v1/api-keys')
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    // Ensure no raw keys are leaked
    res.body.data.forEach(k => {
      expect(k.keyHash).toBeUndefined();
      expect(k.key).toBeUndefined();
    });
  });

  test('GET /api/v1/api-keys/:id returns a specific key', async () => {
    const res = await request(server.app)
      .get(`/api/v1/api-keys/${createdKeyId}`)
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(200);
    expect(res.body.data.id).toBe(createdKeyId);
    expect(res.body.data.name).toBe('Test Integration Key');
    expect(res.body.data.keyHash).toBeUndefined();
  });

  test('GET /api/v1/api-keys/:id returns 404 for nonexistent key', async () => {
    const { v4: uuidv4 } = require('uuid');
    const res = await request(server.app)
      .get(`/api/v1/api-keys/${uuidv4()}`)
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(404);
  });

  test('GET /api/v1/api-keys/stats returns statistics', async () => {
    const res = await request(server.app)
      .get('/api/v1/api-keys/stats')
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('total');
    expect(res.body.data).toHaveProperty('enabled');
    expect(res.body.data).toHaveProperty('revoked');
    expect(res.body.data).toHaveProperty('expired');
  });

  test('API key authentication works on validate endpoint', async () => {
    const res = await request(server.app)
      .get('/api/v1/api-keys/validate')
      .set('X-API-Key', rawApiKey);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.valid).toBe(true);
  });

  test('Invalid API key returns 401', async () => {
    const res = await request(server.app)
      .get('/api/v1/api-keys/stats')
      .set('X-API-Key', 'dgv2_live_' + '0'.repeat(64));

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/v1/api-keys/:id/disable disables the key', async () => {
    const res = await request(server.app)
      .post(`/api/v1/api-keys/${createdKeyId}/disable`)
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(200);
    expect(res.body.data.enabled).toBe(false);

    // Verify disabled key is rejected
    const authRes = await request(server.app)
      .get('/api/v1/api-keys/validate')
      .set('X-API-Key', rawApiKey);
    expect(authRes.statusCode).toBe(401);
  });

  test('POST /api/v1/api-keys/:id/enable re-enables the key', async () => {
    const res = await request(server.app)
      .post(`/api/v1/api-keys/${createdKeyId}/enable`)
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(200);
    expect(res.body.data.enabled).toBe(true);

    // Verify enabled key works again
    const authRes = await request(server.app)
      .get('/api/v1/api-keys/validate')
      .set('X-API-Key', rawApiKey);
    expect(authRes.statusCode).toBe(200);
  });

  test('POST /api/v1/api-keys/:id/revoke revokes the key', async () => {
    const res = await request(server.app)
      .post(`/api/v1/api-keys/${createdKeyId}/revoke`)
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(200);
    expect(res.body.data.revokedAt).toBeTruthy();
    expect(res.body.data.enabled).toBe(false);

    // Verify revoked key is rejected
    const authRes = await request(server.app)
      .get('/api/v1/api-keys/validate')
      .set('X-API-Key', rawApiKey);
    expect(authRes.statusCode).toBe(401);
  });

  test('DELETE /api/v1/api-keys/:id deletes the key permanently', async () => {
    // Generate a new key to delete
    const genRes = await request(server.app)
      .post('/api/v1/api-keys')
      .set(authHeader(accessToken))
      .send({ name: 'To Delete' });
    const deleteId = genRes.body.data.id;

    const res = await request(server.app)
      .delete(`/api/v1/api-keys/${deleteId}`)
      .set(authHeader(accessToken));

    expect(res.statusCode).toBe(200);

    // Verify deleted key is gone
    const getRes = await request(server.app)
      .get(`/api/v1/api-keys/${deleteId}`)
      .set(authHeader(accessToken));
    expect(getRes.statusCode).toBe(404);
  });

  test('POST /api/v1/api-keys without name returns 400', async () => {
    const res = await request(server.app)
      .post('/api/v1/api-keys')
      .set(authHeader(accessToken))
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('API key endpoints require JWT authentication', async () => {
    const res = await request(server.app)
      .get('/api/v1/api-keys');

    expect(res.statusCode).toBe(401);
  });

  test('GET /api/v1/api-keys/validate validates an API key', async () => {
    // Generate a fresh key
    const genRes = await request(server.app)
      .post('/api/v1/api-keys')
      .set(authHeader(accessToken))
      .send({ name: 'Validate Test' });
    const freshKey = genRes.body.data.key;

    const res = await request(server.app)
      .get('/api/v1/api-keys/validate')
      .set('X-API-Key', freshKey);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.valid).toBe(true);
  });

  test('GET /api/v1/api-keys/validate returns 400 without key', async () => {
    const res = await request(server.app)
      .get('/api/v1/api-keys/validate');

    expect(res.statusCode).toBe(400);
  });
});
