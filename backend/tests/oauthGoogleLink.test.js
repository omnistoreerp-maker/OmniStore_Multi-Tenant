// Google account linking — HTTP-level tests.
//
// Only the EXTERNAL Google token verification is mocked. The endpoint, JWT
// middleware, linking service, cross-process lock and JSON persistence all run
// for real. No live Google request is made.
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

const ALICE_SUB = 'google-sub-alice-001';
const BOB_SUB = 'google-sub-bob-001';
const CAROL_SUB = 'google-sub-carol-001';
const DAVE_SUB = 'google-sub-dave-001';
const ANON_SUB = 'google-sub-anon-001';

let server;
let dataDir;
let alice;
let bob;
let carol;
let dave;
let aliceToken;
let bobToken;
let carolToken;
let daveToken;

const googleResponses = new Map();

function respondTo(token, sub, email) {
  googleResponses.set(token, { sub, email });
}

function usersOnDisk() {
  const db = readStore(dataDir, 'users');
  return (db && db.users) || [];
}

function bindingsFor(sub) {
  return usersOnDisk().filter((u) => u && u.oauth && String(u.oauth.google) === String(sub));
}

beforeAll(async () => {
  dataDir = makeTempDataDir('google-link');
  server = await startServer(dataDir, {
    GOOGLE_CLIENT_ID: 'test-google-client-id',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    GITHUB_CLIENT_ID: 'test-github-client-id',
    GITHUB_CLIENT_SECRET: 'test-github-client-secret',
    SESSION_SECRET: 'test-session-secret'
  });

  alice = await createUser(server.app, {
    username: 'alice@example.com',
    password: 'Alice#123',
    fullName: 'Alice Admin',
    role: 'Admin',
    extra: { tenantIds: ['tenant-a'], permissions: ['users.read'] }
  });
  bob = await createUser(server.app, {
    username: 'bob@example.com',
    password: 'Bob#12345',
    fullName: 'Bob Cashier',
    role: 'Cashier',
    extra: { tenantIds: ['tenant-b'], permissions: ['sales.read'] }
  });
  carol = await createUser(server.app, {
    username: 'carol@example.com',
    password: 'Carol#123',
    fullName: 'Carol Manager',
    role: 'Manager',
    extra: { tenantIds: ['tenant-c'], permissions: ['reports.read'] }
  });
  dave = await createUser(server.app, {
    username: 'dave@example.com',
    password: 'Dave#1234',
    fullName: 'Dave Cashier',
    role: 'Cashier',
    extra: { tenantIds: ['tenant-d'], permissions: ['sales.read'] }
  });

  aliceToken = (await login(server.app, 'alice@example.com', 'Alice#123')).accessToken;
  bobToken = (await login(server.app, 'bob@example.com', 'Bob#12345')).accessToken;
  carolToken = (await login(server.app, 'carol@example.com', 'Carol#123')).accessToken;
  daveToken = (await login(server.app, 'dave@example.com', 'Dave#1234')).accessToken;
});

beforeEach(() => {
  googleResponses.clear();
  global.__googleVerifier = async (token) => {
    if (googleResponses.has(token)) return googleResponses.get(token);
    return { error: 'Invalid Google token' };
  };
});

afterAll(async () => {
  delete global.__googleVerifier;
});

registerCleanup(() => [server], () => [dataDir]);

describe('POST /api/v1/auth/link/google', () => {
  test('links the authenticated user to their own Google identity', async () => {
    respondTo('tok-alice', ALICE_SUB, 'alice@example.com');

    const res = await request(server.app)
      .post('/api/v1/auth/link/google')
      .set(authHeader(aliceToken))
      .send({ idToken: 'tok-alice' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.linked).toBe(true);
    expect(res.body.data.user.id).toBe(alice.id);
    expect(res.body.data.user.username).toBe('alice@example.com');
    expect(res.body.data.user.password).toBeUndefined();
    expect(res.body.data.user.oauth).toBeUndefined();

    const bound = bindingsFor(ALICE_SUB);
    expect(bound).toHaveLength(1);
    expect(bound[0].id).toBe(alice.id);
  });

  test('rejects a missing bearer token', async () => {
    respondTo('tok-anon', ANON_SUB, 'anon@example.com');

    const res = await request(server.app)
      .post('/api/v1/auth/link/google')
      .send({ idToken: 'tok-anon' });

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
    expect(bindingsFor(ANON_SUB)).toHaveLength(0);
  });

  test('rejects an invalid bearer token', async () => {
    respondTo('tok-anon', ANON_SUB, 'anon@example.com');

    const res = await request(server.app)
      .post('/api/v1/auth/link/google')
      .set(authHeader('not-a-valid-jwt'))
      .send({ idToken: 'tok-anon' });

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
    expect(bindingsFor(ANON_SUB)).toHaveLength(0);
  });

  test('rejects an invalid Google ID token', async () => {
    respondTo('tok-google-invalid', ANON_SUB, 'anon@example.com');
    global.__googleVerifier = async () => ({ error: 'Invalid Google token' });

    const res = await request(server.app)
      .post('/api/v1/auth/link/google')
      .set(authHeader(aliceToken))
      .send({ idToken: 'tok-google-invalid' });

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
    expect(bindingsFor(ANON_SUB)).toHaveLength(0);
  });

  test('test harness forwards Google and GitHub OAuth credentials', () => {
    const oauthConfig = require('../config/oauth');

    expect(oauthConfig.providers.google.enabled).toBe(true);
    expect(oauthConfig.providers.google.clientID).toBe('test-google-client-id');
    expect(oauthConfig.providers.google.clientSecret).toBe('test-google-client-secret');

    expect(oauthConfig.providers.github.enabled).toBe(true);
    expect(oauthConfig.providers.github.clientID).toBe('test-github-client-id');
    expect(oauthConfig.providers.github.clientSecret).toBe('test-github-client-secret');
  });

  test('rejects a Google subject already linked to a different user', async () => {
    respondTo('tok-bob-alice-sub', ALICE_SUB, 'alice@example.com');

    const res = await request(server.app)
      .post('/api/v1/auth/link/google')
      .set(authHeader(bobToken))
      .send({ idToken: 'tok-bob-alice-sub' });

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/already linked/i);

    const bound = bindingsFor(ALICE_SUB);
    expect(bound).toHaveLength(1);
    expect(bound[0].id).toBe(alice.id);
    const bobOnDisk = usersOnDisk().find((u) => u.id === bob.id);
    expect(bobOnDisk.oauth && bobOnDisk.oauth.google).toBeUndefined();
  });

  test('repeat linking of the same identity is idempotent', async () => {
    respondTo('tok-alice-again', ALICE_SUB, 'alice@example.com');

    const res = await request(server.app)
      .post('/api/v1/auth/link/google')
      .set(authHeader(aliceToken))
      .send({ idToken: 'tok-alice-again' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.alreadyLinked).toBe(true);
    expect(bindingsFor(ALICE_SUB)).toHaveLength(1);
  });

  test('cannot redirect the link onto another account by changing the request body', async () => {
    respondTo('tok-bob', BOB_SUB, 'bob@example.com');

    const res = await request(server.app)
      .post('/api/v1/auth/link/google')
      .set(authHeader(bobToken))
      .send({
        idToken: 'tok-bob',
        userId: alice.id,
        id: alice.id,
        sub: ALICE_SUB,
        role: 'Owner',
        tenantIds: ['tenant-a'],
        permissions: ['*']
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.user.id).toBe(bob.id);

    const bobOnDisk = usersOnDisk().find((u) => u.id === bob.id);
    const aliceOnDisk = usersOnDisk().find((u) => u.id === alice.id);
    expect(bobOnDisk.oauth.google).toBe(BOB_SUB);
    expect(aliceOnDisk.oauth.google).toBe(ALICE_SUB);
    expect(bindingsFor(ALICE_SUB)).toHaveLength(1);
    expect(bindingsFor(BOB_SUB)).toHaveLength(1);
  });

  test('preserves tenant membership and permissions', async () => {
    respondTo('tok-carol', CAROL_SUB, 'carol@example.com');
    const before = usersOnDisk().find((u) => u.id === carol.id);

    const res = await request(server.app)
      .post('/api/v1/auth/link/google')
      .set(authHeader(carolToken))
      .send({
        idToken: 'tok-carol',
        userId: alice.id,
        role: 'Owner',
        tenantIds: ['tenant-a'],
        permissions: ['*']
      });

    expect(res.statusCode).toBe(200);

    const carolOnDisk = usersOnDisk().find((u) => u.id === carol.id);
    expect(carolOnDisk.oauth.google).toBe(CAROL_SUB);
    expect(carolOnDisk.role).toBe('Manager');
    expect(carolOnDisk.tenantIds).toEqual(['tenant-c']);
    expect(carolOnDisk.permissions).toEqual(['reports.read']);
    expect(carolOnDisk.tokenVersion).toBe(before.tokenVersion);
  });

  test('prevents privilege escalation through the linking payload', async () => {
    respondTo('tok-dave', DAVE_SUB, 'dave@example.com');

    const before = usersOnDisk().find((u) => u.id === dave.id);

    const res = await request(server.app)
      .post('/api/v1/auth/link/google')
      .set(authHeader(daveToken))
      .send({
        idToken: 'tok-dave',
        role: 'Owner',
        tenantIds: ['tenant-z'],
        tenantRoles: { 'tenant-z': 'Owner' },
        tenantPermissions: ['*'],
        permissions: ['*']
      });

    expect(res.statusCode).toBe(200);

    const after = usersOnDisk().find((u) => u.id === dave.id);
    expect(after.role).toBe('Cashier');
    expect(after.tenantIds).toEqual(['tenant-d']);
    expect(after.permissions).toEqual(['sales.read']);
    expect(after.tenantRoles).toEqual(before.tenantRoles);
    expect(after.tenantPermissions).toEqual(before.tenantPermissions);

    const me = await request(server.app)
      .get('/api/v1/auth/me')
      .set(authHeader(daveToken));
    expect(me.statusCode).toBe(200);
    expect(me.body.data.user.role).toBe('Cashier');
  });

  test('final store has exactly one correct binding per Google subject', async () => {
    const expected = [ALICE_SUB, BOB_SUB, CAROL_SUB, DAVE_SUB];
    const all = usersOnDisk();

    for (const sub of expected) {
      const bound = all.filter((u) => u && u.oauth && String(u.oauth.google) === String(sub));
      expect(bound).toHaveLength(1);
    }

    const googleBindings = all.filter((u) => u && u.oauth && u.oauth.google !== undefined);
    expect(googleBindings).toHaveLength(expected.length);

    const subjects = googleBindings.map((u) => u.oauth.google);
    expect(new Set(subjects).size).toBe(subjects.length);
  });
});
