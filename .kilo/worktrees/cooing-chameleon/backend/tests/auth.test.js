// Authentication endpoint tests: login, refresh, logout, me, permissions, roles.
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  dataDir = makeTempDataDir('auth');
  server = await startServer(dataDir);
  await createUser(server.app, { username: 'alice', password: 'Alice#123', fullName: 'Alice A', role: 'Admin' });
  await createUser(server.app, {
    username: 'bob',
    password: 'Bob#12345',
    fullName: 'Bob B',
    role: 'Cashier',
    extra: { permissions: ['sales.read', 'sales.create'] }
  });
});

describe('POST /api/v1/auth/login', () => {
  test('login success returns tokens and a sanitized user', async () => {
    const res = await request(server.app)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'Alice#123' });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.user.username).toBe('alice');
    expect(res.body.data.user.role).toBe('Admin');
    expect(res.body.data.user.password).toBeUndefined();
  });

  test('login failure with wrong password returns 401', async () => {
    const res = await request(server.app)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'wrong' });
    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('login failure with unknown user returns 401', async () => {
    const res = await request(server.app)
      .post('/api/v1/auth/login')
      .send({ username: 'nobody', password: 'x' });
    expect(res.statusCode).toBe(401);
  });

  test('login without credentials returns 400', async () => {
    const res = await request(server.app).post('/api/v1/auth/login').send({});
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  test('refresh with a valid refresh token issues a new access token', async () => {
    const session = await login(server.app, 'alice', 'Alice#123');
    const res = await request(server.app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  test('refresh with an invalid token returns 401', async () => {
    const res = await request(server.app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'not-a-token' });
    expect(res.statusCode).toBe(401);
  });

  test('refresh without a token returns 400', async () => {
    const res = await request(server.app).post('/api/v1/auth/refresh').send({});
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/auth/logout', () => {
  test('logout revokes the refresh token', async () => {
    const session = await login(server.app, 'alice', 'Alice#123');
    const out = await request(server.app)
      .post('/api/v1/auth/logout')
      .set(authHeader(session.accessToken))
      .send({ refreshToken: session.refreshToken });
    expect(out.statusCode).toBe(200);
    const res = await request(server.app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(res.statusCode).toBe(401);
  });

  test('logout succeeds even without a token', async () => {
    const res = await request(server.app).post('/api/v1/auth/logout').send({});
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /api/v1/auth/me', () => {
  test('me with a bearer token returns the token user', async () => {
    const session = await login(server.app, 'bob', 'Bob#12345');
    const res = await request(server.app)
      .get('/api/v1/auth/me')
      .set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.user.username).toBe('bob');
    expect(res.body.data.user.password).toBeUndefined();
  });

  test('me with username query requires authentication (no more anonymous lookup)', async () => {
    const res = await request(server.app).get('/api/v1/auth/me?username=bob');
    expect(res.statusCode).toBe(401);
  });

  test('me with username query returns that user for an authenticated admin', async () => {
    const session = await login(server.app, 'alice', 'Alice#123');
    const res = await request(server.app)
      .get('/api/v1/auth/me?username=bob')
      .set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.user.username).toBe('bob');
    expect(res.body.data.user.password).toBeUndefined();
  });

  test('me with username query denies a non-admin querying another user', async () => {
    const session = await login(server.app, 'bob', 'Bob#12345');
    const res = await request(server.app)
      .get('/api/v1/auth/me?username=alice')
      .set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(403);
  });

  test('me without username returns 400', async () => {
    const res = await request(server.app).get('/api/v1/auth/me');
    expect(res.statusCode).toBe(400);
  });

  test('me with unknown username returns 404 for an authenticated admin', async () => {
    const session = await login(server.app, 'alice', 'Alice#123');
    const res = await request(server.app)
      .get('/api/v1/auth/me?username=ghost')
      .set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/v1/auth/permissions', () => {
  test('permissions requires authentication (no more anonymous lookup)', async () => {
    const res = await request(server.app).get('/api/v1/auth/permissions?username=bob');
    expect(res.statusCode).toBe(401);
  });

  test('permissions returns role and custom permissions for an authenticated admin', async () => {
    const session = await login(server.app, 'alice', 'Alice#123');
    const res = await request(server.app)
      .get('/api/v1/auth/permissions?username=bob')
      .set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.username).toBe('bob');
    expect(res.body.data.role).toBe('Cashier');
    expect(res.body.data.permissions).toEqual(['sales.read', 'sales.create']);
  });

  test('permissions for a non-admin querying another user is denied', async () => {
    const session = await login(server.app, 'bob', 'Bob#12345');
    const res = await request(server.app)
      .get('/api/v1/auth/permissions?username=alice')
      .set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(403);
  });

  test('permissions without username returns 400', async () => {
    const res = await request(server.app).get('/api/v1/auth/permissions');
    expect(res.statusCode).toBe(400);
  });

  test('permissions for unknown user returns 404 for an authenticated admin', async () => {
    const session = await login(server.app, 'alice', 'Alice#123');
    const res = await request(server.app)
      .get('/api/v1/auth/permissions?username=ghost')
      .set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/v1/auth/roles', () => {
  test('roles returns known roles plus roles present in the store', async () => {
    const res = await request(server.app).get('/api/v1/auth/roles');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.roles).toEqual(expect.arrayContaining(['Admin', 'Cashier', 'Owner']));
  });
});
