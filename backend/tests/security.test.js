// Security tests: JWT, bcrypt, rate limiting, validation,
// prototype pollution, malformed JSON, authorization.
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { startServer, TEST_JWT_SECRET } = require('./helpers/testServer');
const { makeTempDataDir, readStore, seed } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

let server;       // default posture (legacy: AUTH_REQUIRED off)
let authServer;   // hardened posture (AUTH_REQUIRED=true)
let limitedServer;// tiny rate limit to trigger 429
let dataDir;
let authDataDir;
let limitedDataDir;

registerCleanup(
  () => [server, authServer, limitedServer],
  () => [dataDir, authDataDir, limitedDataDir]
);

beforeAll(async () => {
  dataDir = makeTempDataDir('sec');
  server = await startServer(dataDir);
  await createUser(server.app, { username: 'sec-admin', password: 'Sec#12345', role: 'Admin' });

  authDataDir = makeTempDataDir('sec-auth');
  const bcrypt = require('bcryptjs');
  const seededHash = bcrypt.hashSync('password', 10);
  seed(authDataDir, 'users', {
    users: [{
      id: 'u-owner',
      username: 'sec-owner',
      password: seededHash,
      role: 'Owner',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, {
      id: 'u-cashier',
      username: 'sec-cashier',
      password: seededHash,
      role: 'Cashier',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }]
  });
  authServer = await startServer(authDataDir, { AUTH_REQUIRED: 'true' });

  limitedDataDir = makeTempDataDir('sec-limit');
  limitedServer = await startServer(limitedDataDir, { RATE_LIMIT_MAX: '5' });
});

describe('JWT', () => {
  test('a valid access token authenticates the request', async () => {
    const session = await login(server.app, 'sec-admin', 'Sec#12345');
    const res = await request(server.app).get('/api/v1/auth/me').set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.user.username).toBe('sec-admin');
  });

  test('a garbage token is not authenticated', async () => {
    const res = await request(server.app)
      .get('/api/v1/auth/me')
      .set(authHeader('garbage.token.value'));
    // falls through to the username-less branch → 400 (never 200)
    expect(res.statusCode).toBe(400);
  });

  test('a token signed with the wrong secret is rejected', async () => {
    const forged = jwt.sign({ sub: 'x', username: 'sec-admin', role: 'Admin' }, 'wrong-secret', { expiresIn: '5m' });
    const res = await request(server.app).get('/api/v1/auth/me').set(authHeader(forged));
    expect(res.statusCode).toBe(400);
  });

  test('an expired token is rejected', async () => {
    const expired = jwt.sign(
      { sub: 'x', username: 'sec-admin', role: 'Admin' },
      TEST_JWT_SECRET,
      { expiresIn: '-10s' }
    );
    const res = await request(server.app).get('/api/v1/auth/me').set(authHeader(expired));
    expect(res.statusCode).toBe(400);
  });

  test('a refresh token cannot be used as an access token', async () => {
    const session = await login(server.app, 'sec-admin', 'Sec#12345');
    const res = await request(server.app).get('/api/v1/auth/me').set(authHeader(session.refreshToken));
    expect(res.statusCode).toBe(400);
  });
});

describe('bcrypt password handling', () => {
  test('passwords are stored as bcrypt hashes, never plaintext', async () => {
    const store = readStore(dataDir, 'users');
    const u = store.users.find(x => x.username === 'sec-admin');
    expect(u.password).toMatch(/^\$2[aby]\$/);
    expect(u.password).not.toBe('Sec#12345');
  });

  test('password hashes never appear in any API response', async () => {
    const list = await request(server.app).get('/api/v1/users');
    expect(JSON.stringify(list.body)).not.toContain('$2');
    const session = await login(server.app, 'sec-admin', 'Sec#12345');
    expect(JSON.stringify(session)).not.toContain('$2');
  });

  test('legacy plaintext credentials are migrated to bcrypt on login', async () => {
    await request(server.app)
      .post('/api/v1/users')
      .send({ id: 'legacy-u', username: 'legacy-user', password: 'Plain#123', role: 'Cashier' });
    // simulate a legacy record by overwriting the hash with plaintext in the store
    const store = readStore(dataDir, 'users');
    const idx = store.users.findIndex(x => x.username === 'legacy-user');
    store.users[idx].password = 'Plain#123';
    seed(dataDir, 'users', store);

    const res = await request(server.app)
      .post('/api/v1/auth/login')
      .send({ username: 'legacy-user', password: 'Plain#123' });
    expect(res.statusCode).toBe(200);

    const after = readStore(dataDir, 'users');
    expect(after.users[idx].password).toMatch(/^\$2[aby]\$/);
  });
});

describe('rate limiting', () => {
  test('requests beyond the limit are rejected with 429', async () => {
    let last;
    for (let i = 0; i < 7; i++) {
      last = await request(limitedServer.app).get('/api/v1/health');
    }
    expect(last.statusCode).toBe(429);
  });

  test('rate-limited responses carry standard rate limit headers', async () => {
    const res = await request(limitedServer.app).get('/api/v1/health');
    expect(res.headers['ratelimit-limit']).toBeDefined();
  });
});

describe('validation', () => {
  test('wrong field types are rejected with 400', async () => {
    const res = await request(server.app)
      .post('/api/v1/treasury')
      .send({ type: 'in', amount: 'not-a-number' });
    expect(res.statusCode).toBe(400);
  });

  test('non-object JSON bodies are rejected with 400', async () => {
    const res = await request(server.app)
      .post('/api/v1/customers')
      .send([1, 2, 3]);
    expect(res.statusCode).toBe(400);
  });

  test('invalid enum values are rejected with 400', async () => {
    const res = await request(server.app)
      .post('/api/v1/treasury')
      .send({ type: 'sideways', amount: 5 });
    expect(res.statusCode).toBe(400);
  });
});

describe('prototype pollution and injection keys', () => {
  test('dangerous keys are stripped and Object.prototype stays clean', async () => {
    const res = await request(server.app)
      .post('/api/v1/customers')
      .send({ name: 'Pollution Attempt', '__proto__': { polluted: true }, 'constructor': 'x', '$where': '1' });
    expect(res.statusCode).toBe(201);
    expect({}.polluted).toBeUndefined();
    expect(res.body.data['$where']).toBeUndefined();
    const store = readStore(dataDir, 'customers');
    const rec = store.customers.find(c => c.name === 'Pollution Attempt');
    expect(Object.keys(rec)).not.toContain('__proto__');
    expect(Object.keys(rec)).not.toContain('$where');
  });
});

describe('malformed JSON', () => {
  test('unparseable JSON bodies return the standard 400 envelope', async () => {
    const res = await request(server.app)
      .post('/api/v1/customers')
      .set('Content-Type', 'application/json')
      .send('{"name": broken');
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Malformed JSON payload');
  });
});

describe('authorization (AUTH_REQUIRED=true)', () => {
  test('requests without a token are rejected with 401', async () => {
    const res = await request(authServer.app).get('/api/v1/customers');
    expect(res.statusCode).toBe(401);
  });

  test('requests with a valid token pass', async () => {
    const session = await login(authServer.app, 'sec-owner', 'password');
    const res = await request(authServer.app)
      .get('/api/v1/customers')
      .set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
  });

  test('writes from disallowed roles are rejected with 403', async () => {
    const session = await login(authServer.app, 'sec-cashier', 'password');
    const res = await request(authServer.app)
      .post('/api/v1/customers')
      .set(authHeader(session.accessToken))
      .send({ name: 'Forbidden Customer' });
    expect(res.statusCode).toBe(403);
  });

  test('writes from allowed roles pass', async () => {
    const session = await login(authServer.app, 'sec-owner', 'password');
    const res = await request(authServer.app)
      .post('/api/v1/customers')
      .set(authHeader(session.accessToken))
      .send({ name: 'Allowed Customer' });
    expect(res.statusCode).toBe(201);
  });
});
