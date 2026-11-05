'use strict';

// W3 — Email-based Google identity matching in usersService.linkOAuthProvider.
//
// Proves the adopted email-matching policy:
//   1. Google identity must be email-verified (enforced in googleIdentity.js,
//     covered by googleIdentity.test.js; asserted here too for completeness).
//   2. Email is trimmed + lowercased before comparison.
//   3. Match is searched in BOTH `email` and `username` fields.
//   4. Unique matching ACCOUNTS are counted, not fields:
//      - email + username within the same account = one account.
//      - email matching two different accounts = conflict.
//   5. Only the authenticated user's own account is linked; the caller's
//     own email/username is never a conflict (excluded by index).
//   6. Conflict => generic refusal (never reveals the conflicting account).
//   7. A Google `sub` already bound to another account cannot be transferred.
//   8. tenantId / tenantIds / role / tenantRoles / tenantPermissions /
//     permissions / tokenVersion are never changed by linking.
//   9. Repeat linking of the same subject to the same user is idempotent.
//
// No production module is mocked: the real users service, file lock and JSON
// persistence all run against an isolated temp data directory.

const fs = require('fs');
const { verifyIdToken } = require('../utils/googleIdentity');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');

let usersService;
let dataDir;

function resetService() {
  jest.resetModules();
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  process.env.NODE_ENV = 'test';
  usersService = require('../services/users.service');
}

function writeUsers(users) {
  seed(dataDir, 'users', { users });
}

function record(id) {
  return readStore(dataDir, 'users').users.find((u) => u.id === id);
}

function googleProfile(sub, email) {
  return { id: sub, emails: email ? [{ value: email }] : [], _json: { sub, email } };
}

beforeEach(() => {
  dataDir = makeTempDataDir('w3-email-match');
  resetService();
});

afterEach(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
});

describe('W3 — linkOAuthProvider email matching', () => {
  test('matches the Google email against the `email` field of another account', async () => {
    writeUsers([
      { id: 'u-a', username: 'alice', email: 'shared@example.com', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 },
      { id: 'u-b', username: 'bob', email: 'bob@example.com', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 }
    ]);

    // u-b (authenticated) links; Google email matches u-a's `email` field.
    const result = await usersService.linkOAuthProvider('u-b', 'google', 'sub-xyz', 'shared@example.com');

    expect(result.error).toMatch(/already linked/i);
    expect(result.conflict).toBe(true);
    expect(result.statusCode).toBe(409);
    expect(record('u-b').oauth).toBeUndefined();
    expect(record('u-a').oauth).toBeUndefined();
  });

  test('matches the Google email against the `username` field when it is an email', async () => {
    writeUsers([
      { id: 'u-a', username: 'alice@example.com', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 },
      { id: 'u-b', username: 'bob', email: 'bob@example.com', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 }
    ]);

    const result = await usersService.linkOAuthProvider('u-b', 'google', 'sub-xyz', 'alice@example.com');

    expect(result.error).toMatch(/already linked/i);
    expect(result.conflict).toBe(true);
    expect(result.statusCode).toBe(409);
    expect(record('u-b').oauth).toBeUndefined();
  });

  test('trims and lowercases the Google email before comparison', async () => {
    writeUsers([
      { id: 'u-a', username: ' Alice@Example.COM ', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 },
      { id: 'u-b', username: 'bob', email: 'bob@example.com', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 }
    ]);

    const result = await usersService.linkOAuthProvider('u-b', 'google', 'sub-xyz', 'alice@example.com');

    expect(result.error).toMatch(/already linked/i);
    expect(result.conflict).toBe(true);
    expect(result.statusCode).toBe(409);
  });

  test('email in both `email` and `username` of the same account is one account, not a conflict for its owner', async () => {
    writeUsers([
      { id: 'u-a', username: 'alice@example.com', email: 'alice@example.com', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 },
      { id: 'u-b', username: 'bob', email: 'bob@example.com', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 }
    ]);

    // u-a links with its own Google email (present in both fields) — must succeed, not conflict.
    const result = await usersService.linkOAuthProvider('u-a', 'google', 'sub-a', 'alice@example.com');

    expect(result.error).toBeUndefined();
    expect(record('u-a').oauth.google).toBe('sub-a');
  });

  test('the same email in two different accounts is a conflict', async () => {
    writeUsers([
      { id: 'u-a', username: 'alice', email: 'shared@example.com', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 },
      { id: 'u-b', username: 'shared@example.com', email: 'bob@example.com', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 },
      { id: 'u-c', username: 'carol', email: 'carol@example.com', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 }
    ]);

    // u-c (authenticated) links; Google email matches u-a's `email` AND u-b's `username`.
    const result = await usersService.linkOAuthProvider('u-c', 'google', 'sub-xyz', 'shared@example.com');

    expect(result.error).toMatch(/already linked/i);
    expect(result.conflict).toBe(true);
    expect(result.statusCode).toBe(409);
    expect(record('u-c').oauth).toBeUndefined();
  });

  test('the authenticated account cannot link Google onto another account', async () => {
    writeUsers([
      { id: 'u-a', username: 'alice@example.com', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 },
      { id: 'u-b', username: 'bob@example.com', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 }
    ]);

    // u-b tries to link; Google email belongs to u-a. Must be rejected even
    // though the request targets u-b (the authenticated user).
    const result = await usersService.linkOAuthProvider('u-b', 'google', 'sub-xyz', 'alice@example.com');

    expect(result.error).toMatch(/already linked/i);
    expect(result.conflict).toBe(true);
    expect(result.statusCode).toBe(409);
    expect(record('u-b').oauth).toBeUndefined();
    expect(record('u-a').oauth).toBeUndefined();
  });

  test('a Google `sub` already bound to another account cannot be transferred', async () => {
    writeUsers([
      { id: 'u-a', username: 'alice', oauth: { google: 'sub-x' }, oauthProvider: 'google', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 },
      { id: 'u-b', username: 'bob', email: 'bob@example.com', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 }
    ]);

    const result = await usersService.linkOAuthProvider('u-b', 'google', 'sub-x', 'bob@example.com');

    expect(result.error).toMatch(/already linked/i);
    expect(result.conflict).toBe(true);
    expect(result.statusCode).toBe(409);
    expect(record('u-b').oauth).toBeUndefined();
    expect(record('u-a').oauth.google).toBe('sub-x');
  });

  test('repeat linking of the same subject to the same user is idempotent', async () => {
    writeUsers([
      { id: 'u-a', username: 'alice@example.com', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 }
    ]);

    const first = await usersService.linkOAuthProvider('u-a', 'google', 'sub-a', 'alice@example.com');
    expect(first.error).toBeUndefined();
    expect(first.alreadyLinked).toBe(false);

    const second = await usersService.linkOAuthProvider('u-a', 'google', 'sub-a', 'alice@example.com');
    expect(second.error).toBeUndefined();
    expect(second.alreadyLinked).toBe(true);

    const bound = readStore(dataDir, 'users').users.filter((u) => u.oauth && u.oauth.google === 'sub-a');
    expect(bound).toHaveLength(1);
    expect(bound[0].id).toBe('u-a');
  });

  test('linking does not change tenant membership, role, permissions or tokenVersion', async () => {
    writeUsers([
      {
        id: 'u-a', username: 'alice@example.com', email: 'alice@example.com',
        role: 'Cashier', tenantIds: ['t1'], tenantRoles: { t1: 'Cashier' },
        tenantPermissions: { t1: ['sales.read'] }, permissions: ['sales.read'],
        tokenVersion: 3, status: 'active'
      }
    ]);

    const before = record('u-a');

    const result = await usersService.linkOAuthProvider('u-a', 'google', 'sub-a', 'alice@example.com');
    expect(result.error).toBeUndefined();

    const after = record('u-a');
    expect(after.role).toBe(before.role);
    expect(after.tenantIds).toEqual(before.tenantIds);
    expect(after.permissions).toEqual(before.permissions);
    expect(after.tenantRoles).toEqual(before.tenantRoles);
    expect(after.tenantPermissions).toEqual(before.tenantPermissions);
    expect(after.tokenVersion).toBe(before.tokenVersion);
    expect(after.status).toBe(before.status);
    expect(after.oauth.google).toBe('sub-a');
  });

  test('conflict error message is generic and reveals no account details', async () => {
    writeUsers([
      { id: 'u-a', username: 'alice@example.com', email: 'alice@example.com', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 },
      { id: 'u-b', username: 'bob@example.com', email: 'bob@example.com', role: 'Cashier', tenantIds: [], permissions: [], tokenVersion: 0 }
    ]);

    const result = await usersService.linkOAuthProvider('u-b', 'google', 'sub-xyz', 'alice@example.com');

    expect(result.conflict).toBe(true);
    expect(result.statusCode).toBe(409);
    // Must not reveal the conflicting account's id, username or email.
    expect(String(result.error)).not.toContain('u-a');
    expect(String(result.error)).not.toContain('alice');
    expect(String(result.error)).not.toContain('alice@example.com');
    expect(String(result.error)).not.toContain('bob');
  });
});

describe('W3 — googleIdentity email verification (guard)', () => {
  const ORIGINAL_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const ORIGINAL_FETCH = global.fetch;
  const fetchMock = jest.fn();
  let verifyIdToken;

  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    global.fetch = fetchMock;
    verifyIdToken = require('../utils/googleIdentity').verifyIdToken;
  });

  afterAll(() => {
    if (ORIGINAL_CLIENT_ID === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = ORIGINAL_CLIENT_ID;
    global.fetch = ORIGINAL_FETCH;
  });

  beforeEach(() => {
    fetchMock.mockReset();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
  });

  test('rejects a Google identity whose email is not verified', async () => {
    fetchMock.mockReturnValue(Promise.resolve({
      ok: true, status: 200,
      json: async () => ({
        sub: 'google-sub-1', email: 'user@example.com', email_verified: 'false',
        aud: 'test-client-id.apps.googleusercontent.com', iss: 'https://accounts.google.com',
        exp: String(Math.floor(Date.now() / 1000) + 3600)
      })
    }));

    const result = await verifyIdToken('tok');

    expect(result.error).toMatch(/verified/i);
    expect(result.sub).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('accepts a Google identity whose email is verified', async () => {
    fetchMock.mockReturnValue(Promise.resolve({
      ok: true, status: 200,
      json: async () => ({
        sub: 'google-sub-1', email: 'user@example.com', email_verified: true,
        aud: 'test-client-id.apps.googleusercontent.com', iss: 'https://accounts.google.com',
        exp: String(Math.floor(Date.now() / 1000) + 3600)
      })
    }));

    const result = await verifyIdToken('tok');

    expect(result.error).toBeUndefined();
    expect(result.sub).toBe('google-sub-1');
    expect(result.email).toBe('user@example.com');
  });
});
