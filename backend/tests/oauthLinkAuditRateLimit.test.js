// Google linking — audit trail and rate limiting (HTTP level).
//
// Only the EXTERNAL Google token verification is stubbed; the endpoint, audit
// service, rate limiter and persistence all run for real. The stub also keeps
// the suite from ever making a network request.

jest.mock('../utils/googleIdentity', () => ({
  verifyIdToken: jest.fn(async (token) => {
    if (typeof global.__googleVerifier !== 'function') {
      return { error: 'Invalid Google token' };
    }
    return global.__googleVerifier(token);
  })
}));

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, readStore } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

let server;
let dataDir;
let auditUser;
let limitedUser;
let auditToken;
let limitedToken;

function auditEntries() {
  const store = readStore(dataDir, 'auditLog');
  return (store && store.entries) || [];
}

function linkEntries(action) {
  return auditEntries().filter((e) => e.action === action);
}

beforeAll(async () => {
  dataDir = makeTempDataDir('google-link-audit');
  server = await startServer(dataDir, { GOOGLE_CLIENT_ID: 'test-google-client-id' });

  auditUser = await createUser(server.app, {
    username: 'audit@example.com',
    password: 'Audit#123',
    fullName: 'Audit User',
    role: 'Cashier'
  });
  limitedUser = await createUser(server.app, {
    username: 'limited@example.com',
    password: 'Limit#123',
    fullName: 'Limited User',
    role: 'Cashier'
  });

  auditToken = (await login(server.app, 'audit@example.com', 'Audit#123')).accessToken;
  limitedToken = (await login(server.app, 'limited@example.com', 'Limit#123')).accessToken;
});

beforeEach(() => {
  global.__googleVerifier = async () => ({ error: 'Invalid Google token' });
});

afterAll(() => {
  delete global.__googleVerifier;
});

registerCleanup(() => [server], () => [dataDir]);

describe('Google linking audit events', () => {
  test('records a success event with requester, provider and timestamp', async () => {
    global.__googleVerifier = async () => ({ sub: 'audit-sub-1', email: 'audit@example.com' });

    const res = await request(server.app)
      .post('/api/v1/auth/link/google')
      .set(authHeader(auditToken))
      .send({ idToken: 'super-secret-id-token-success' });

    expect(res.statusCode).toBe(200);

    const events = linkEntries('USER_OAUTH_LINKED');
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event.userId).toBe(auditUser.id);
    expect(event.resource).toBe('user');
    expect(event.statusCode).toBe(200);
    expect(event.changes.provider).toBe('google');
    expect(event.changes.result).toBe('success');
    expect(typeof event.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
  });

  test('records a failure event with a generic reason and no secrets', async () => {
    global.__googleVerifier = async () => ({ error: 'Invalid Google token' });

    const res = await request(server.app)
      .post('/api/v1/auth/link/google')
      .set(authHeader(auditToken))
      .send({ idToken: 'super-secret-id-token-failure' });

    expect(res.statusCode).toBe(401);

    const events = linkEntries('USER_OAUTH_LINK_FAILED');
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event.userId).toBe(auditUser.id);
    expect(event.changes.provider).toBe('google');
    expect(event.changes.result).toBe('failure');
    expect(event.changes.reason).toBe('google_verification_failed');
  });

  test('never stores the ID token or credentials in the audit trail', async () => {
    const serialized = JSON.stringify(auditEntries());

    expect(serialized).not.toContain('super-secret-id-token-success');
    expect(serialized).not.toContain('super-secret-id-token-failure');
    expect(serialized.toLowerCase()).not.toContain('clientsecret');
    expect(serialized.toLowerCase()).not.toContain('client_secret');
  });
});

describe('Google linking rate limit', () => {
  test('blocks a burst of attempts by the same user with 429', async () => {
    global.__googleVerifier = async () => ({ error: 'Invalid Google token' });

    const statuses = [];
    for (let i = 0; i < 21; i++) {
      const res = await request(server.app)
        .post('/api/v1/auth/link/google')
        .set(authHeader(limitedToken))
        .send({ idToken: 'burst-token-' + i });
      statuses.push(res.statusCode);
    }

    // The quota (20 per window) allows the legitimate attempts and then
    // refuses the extra one instead of letting it reach verification.
    expect(statuses.slice(0, 20)).toEqual(new Array(20).fill(401));
    expect(statuses[20]).toBe(429);

    const store = readStore(dataDir, 'users');
    const limited = store.users.find((u) => u.id === limitedUser.id);
    expect(limited.oauth === undefined || limited.oauth.google === undefined).toBe(true);
  });

  test('the limiter is per user, so one user cannot exhaust another quota', async () => {
    global.__googleVerifier = async () => ({ error: 'Invalid Google token' });

    const res = await request(server.app)
      .post('/api/v1/auth/link/google')
      .set(authHeader(auditToken))
      .send({ idToken: 'after-burst-token' });

    expect(res.statusCode).toBe(401);
  });
});
